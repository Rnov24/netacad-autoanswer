const MAX_SCRAPE_ATTEMPTS = 10;
const SCRAPE_RETRY_DELAY_MS = 1500;

class LruCache {
  constructor(maxSize = 50) {
    this._max = maxSize;
    this._map = new Map();
  }
  has(key) { return this._map.has(key); }
  get(key) {
    if (!this._map.has(key)) return undefined;
    const val = this._map.get(key);
    this._map.delete(key);
    this._map.set(key, val);
    return val;
  }
  set(key, val) {
    if (this._map.has(key)) this._map.delete(key);
    this._map.set(key, val);
    if (this._map.size > this._max) {
      this._map.delete(this._map.keys().next().value);
    }
  }
}

let isAutonomousRunning = false;
let isAutonomousPaused = false;
let isScrapeInFlight = false;
let isCourseScrollerRunning = false;
const apiAnswerCache = new LruCache(50);

// Lightweight fingerprint: hash of question count + first chars of each question
function getQuestionsFingerprint(questionsDataArray) {
  if (!questionsDataArray || questionsDataArray.length === 0) return "";
  return questionsDataArray
    .map((q) => {
      const qSnippet = q.question.trim().slice(0, 80);
      const aSnippet = (q.answers || []).slice(0, 4).join("|").slice(0, 80);
      return `${qSnippet}::${aSnippet}`;
    })
    .join("||");
}

// Resolve a function from window/globalThis by name
function resolveFn(fnName) {
  try {
    if (typeof window !== "undefined" && typeof window[fnName] === "function") return window[fnName];
    if (typeof globalThis !== "undefined" && typeof globalThis[fnName] === "function") return globalThis[fnName];
  } catch (_) {}
  return null;
}

// Wait helper that respects pause/stop state
async function waitMs(ms) {
  const step = 100;
  let elapsed = 0;
  while (elapsed < ms) {
    if (!isAutonomousRunning) return;
    while (isAutonomousPaused && isAutonomousRunning) {
      await new Promise((r) => setTimeout(r, step));
    }
    await new Promise((r) => setTimeout(r, Math.min(step, ms - elapsed)));
    elapsed += step;
  }
}

function pauseAutonomousLoop() {
  isAutonomousPaused = true;
  console.log("NetAcad AutoAnswer: Auto-Pilot PAUSED ⏸️");
  return { isRunning: isAutonomousRunning, isPaused: isAutonomousPaused };
}

function resumeAutonomousLoop() {
  isAutonomousPaused = false;
  console.log("NetAcad AutoAnswer: Auto-Pilot RESUMED ▶️");
  return { isRunning: isAutonomousRunning, isPaused: isAutonomousPaused };
}

function toggleAutonomousPause() {
  return isAutonomousPaused ? resumeAutonomousLoop() : pauseAutonomousLoop();
}

function stopAutonomousLoop() {
  isAutonomousRunning = false;
  isAutonomousPaused = false;
  console.log("NetAcad AutoAnswer: Auto-Pilot STOPPED ⏹️");
  return { isRunning: false, isPaused: false };
}

function stopCourseScrollerLoop() {
  isCourseScrollerRunning = false;
  console.log("NetAcad AutoAnswer: Course Scroller STOPPED ⏹️");
  return { isRunning: false };
}

// ─────────────────────────────────────────────
// FUNCTION 1: QUIZ SCRAPER
// ─────────────────────────────────────────────
async function scrapeData(currentAttempt = 1) {
  if (isScrapeInFlight) {
    console.debug("NetAcad Scraper: Scrape already in flight. Skipping duplicate trigger.");
    return false;
  }

  isScrapeInFlight = true;

  try {
    console.debug(`NetAcad Scraper: scrapeData attempt #${currentAttempt} of ${MAX_SCRAPE_ATTEMPTS}`);

    const getCfgFn = resolveFn("getProviderConfig") || (typeof getProviderConfig === "function" ? getProviderConfig : null);
    const providerCfg = getCfgFn ? await getCfgFn() : { apiKey: "" };
    const apiKey = providerCfg.apiKey;

    const processSingleQuestionFn = resolveFn("processSingleQuestion") || (typeof processSingleQuestion === "function" ? processSingleQuestion : null);
    const extractMatchingQuestionFn = resolveFn("extractMatchingQuestion") || (typeof extractMatchingQuestion === "function" ? extractMatchingQuestion : null);
    const extractQuestionAndAnswersFn = resolveFn("extractQuestionAndAnswers") || (typeof extractQuestionAndAnswers === "function" ? extractQuestionAndAnswers : null);
    const processAnswerElementsFn = resolveFn("processAnswerElements") || (typeof processAnswerElements === "function" ? processAnswerElements : null);
    const getAiAnswersForBatchFn = resolveFn("getAiAnswersForBatch") || (typeof getAiAnswersForBatch === "function" ? getAiAnswersForBatch : null);

    if (!processSingleQuestionFn) {
      console.error("NetAcad Scraper: processSingleQuestion function not found.");
      return false;
    }

    // --- Shadow DOM Traversal ---
    let mcqViewElements = [];
    let earlyExitReason = "";

    try {
      const appRoot = document.querySelector("app-root");
      if (appRoot && appRoot.shadowRoot) {
        const pageView = appRoot.shadowRoot.querySelector("page-view");
        if (pageView && pageView.shadowRoot) {
          const articleViews = pageView.shadowRoot.querySelectorAll("article-view");
          if (articleViews && articleViews.length > 0) {
            articleViews.forEach((articleView) => {
              if (articleView.shadowRoot) {
                articleView.shadowRoot.querySelectorAll("block-view").forEach((blockView) => {
                  if (blockView.shadowRoot) {
                    const mcqView = blockView.shadowRoot.querySelector("mcq-view");
                    if (mcqView) mcqViewElements.push(mcqView);
                    const omv = blockView.shadowRoot.querySelector("object-matching-view");
                    if (omv) mcqViewElements.push(omv);
                  }
                });
              }
            });
            if (mcqViewElements.length === 0) earlyExitReason = "No mcq-view or object-matching-view inside article-view(s).";
          } else earlyExitReason = "No article-view elements inside page-view.";
        } else earlyExitReason = "page-view not found or has no shadowRoot.";
      } else earlyExitReason = "app-root not found or has no shadowRoot.";
    } catch (e) {
      earlyExitReason = "Exception during shadow DOM traversal.";
      console.error(`NetAcad Scraper: ${earlyExitReason}`, e);
    }

    // Clean up stale UI panels on fresh scrape
    if (currentAttempt === 1 && !isAutonomousRunning) {
      document.querySelectorAll(".netacad-ai-assistant-ui[id^='netacad-ai-q-']").forEach((el) => el.remove());
      mcqViewElements.forEach((mcqView) => {
        if (mcqView?.shadowRoot) {
          mcqView.shadowRoot.querySelectorAll(".netacad-ai-assistant-ui[id^='netacad-ai-q-']").forEach((el) => el.remove());
        }
      });
    }

    if (mcqViewElements.length === 0) {
      console.debug(`NetAcad Scraper: Attempt #${currentAttempt} — ${earlyExitReason}`);
      if (currentAttempt < MAX_SCRAPE_ATTEMPTS) {
        isScrapeInFlight = false;
        await new Promise((r) => setTimeout(r, SCRAPE_RETRY_DELAY_MS));
        return scrapeData(currentAttempt + 1);
      }
      console.warn("NetAcad Scraper: Max retry attempts reached. No questions found.");
      return false;
    }

    console.debug(`NetAcad Scraper: Found ${mcqViewElements.length} question element(s).`);

    if (!apiKey) {
      for (const [index, mcqViewElement] of mcqViewElements.entries()) {
        await processSingleQuestionFn(mcqViewElement, index, null,
          `Error: API Key for ${providerCfg.provider || "selected provider"} is not set in extension popup.`);
      }
      return true;
    }

    // --- Extract question data ---
    const allQuestionsData = [];
    for (const [index, mcqViewElement] of mcqViewElements.entries()) {
      const isMatching = mcqViewElement.tagName?.toLowerCase() === "object-matching-view";

      if (isMatching) {
        if (!extractMatchingQuestionFn) {
          await processSingleQuestionFn(mcqViewElement, index, apiKey, "Error: extractMatchingQuestion missing.");
          continue;
        }
        const m = extractMatchingQuestionFn(mcqViewElement, index);
        if (m.questionText && !m.questionText.startsWith("Error") && m.categories.length > 0 && m.options.length > 0) {
          const formattedQuestion = `MATCHING QUESTION. ${m.questionText}
Category circles (you must match each letter):
${m.categories.map((c) => `  ${c.letter}: ${c.text}`).join("\n")}
Available option items (match each circle to one of these):
${m.options.map((o) => `  - ${o.text}`).join("\n")}`;
          allQuestionsData.push({
            question: formattedQuestion,
            answers: m.options.map((o) => o.text),
            mcqViewElement,
            originalIndex: index,
          });
        } else {
          await processSingleQuestionFn(mcqViewElement, index, apiKey, m.questionText);
        }
        continue;
      }

      if (!extractQuestionAndAnswersFn || !processAnswerElementsFn) {
        await processSingleQuestionFn(mcqViewElement, index, apiKey, "Error: extraction functions missing.");
        continue;
      }

      const extracted = extractQuestionAndAnswersFn(mcqViewElement, index);
      const answerTexts = processAnswerElementsFn(extracted.answerElements, index);

      if (extracted.questionText && !extracted.questionText.startsWith("Error") && answerTexts.length > 0) {
        allQuestionsData.push({
          question: extracted.questionText,
          answers: answerTexts,
          mcqViewElement,
          originalIndex: index,
        });
      } else {
        await processSingleQuestionFn(mcqViewElement, index, apiKey, extracted.questionText);
      }
    }

    if (allQuestionsData.length === 0) return true;

    // --- Cache check ---
    const fingerprint = `${providerCfg.provider}:${getQuestionsFingerprint(allQuestionsData)}`;
    if (apiAnswerCache.has(fingerprint)) {
      console.debug("NetAcad Scraper: Cache hit — skipping API call.");
      const cached = apiAnswerCache.get(fingerprint);
      for (let i = 0; i < allQuestionsData.length; i++) {
        await processSingleQuestionFn(allQuestionsData[i].mcqViewElement, allQuestionsData[i].originalIndex, apiKey, cached[i]);
      }
      return true;
    }

    // --- Batch API call ---
    for (const qd of allQuestionsData) {
      await processSingleQuestionFn(qd.mcqViewElement, qd.originalIndex, apiKey, "BATCH_PROCESSING_STARTED");
    }

    const questionsForPrompt = allQuestionsData.map((q) => ({ question: q.question, answers: q.answers }));
    const batchApiResponse = getAiAnswersForBatchFn
      ? await getAiAnswersForBatchFn(questionsForPrompt, apiKey)
      : { error: "getAiAnswersForBatch function not found" };

    if (batchApiResponse.error) {
      console.error("NetAcad Scraper: Batch API Error:", batchApiResponse.error);
      for (let i = 0; i < allQuestionsData.length; i++) {
        await processSingleQuestionFn(allQuestionsData[i].mcqViewElement, allQuestionsData[i].originalIndex, apiKey, batchApiResponse.error);
      }
    } else {
      const answers = batchApiResponse.answers;
      apiAnswerCache.set(fingerprint, answers);
      for (let i = 0; i < allQuestionsData.length; i++) {
        const answer = answers[i] || "Error: No answer for this question in batch response.";
        await processSingleQuestionFn(allQuestionsData[i].mcqViewElement, allQuestionsData[i].originalIndex, apiKey, answer);
      }
    }

    return true;
  } finally {
    isScrapeInFlight = false;
  }
}

// ─────────────────────────────────────────────
// FUNCTION 2: QUIZ AUTO-PILOT LOOP
// ─────────────────────────────────────────────
// ─────────────────────────────────────────────
// FUNCTION 2: EFFICIENT QUIZ AUTO-PILOT LOOP
// ─────────────────────────────────────────────
async function runAutonomousLoop() {
  if (isAutonomousRunning) {
    if (isAutonomousPaused) resumeAutonomousLoop();
    else console.debug("NetAcad AutoAnswer: Quiz Auto-Pilot already active.");
    return;
  }

  isAutonomousRunning = true;
  isAutonomousPaused = false;
  console.log("NetAcad AutoAnswer: Starting Efficient Quiz Auto-Pilot...");

  let loopIteration = 0;
  const maxLoops = 60;

  try {
    while (isAutonomousRunning && loopIteration < maxLoops) {
      await waitMs(0); // respect pause/stop
      if (!isAutonomousRunning) break;

      console.debug(`NetAcad AutoAnswer: Quiz step #${loopIteration + 1}`);

      const detectFn = resolveFn("detectFinalSubmitPage");
      const confirmFn = resolveFn("confirmAndSubmitFinalAssessment");

      // 1. Check for final submit page immediately
      if (detectFn && detectFn()) {
        console.log("NetAcad AutoAnswer: Final submit page detected — confirming & submitting.");
        if (confirmFn) confirmFn();
        break;
      }

      // 2. Answer current question (scrapeData auto-selects and auto-submits synchronously)
      await scrapeData();
      await waitMs(300);

      if (!isAutonomousRunning) break;

      // 3. Re-verify submit page
      if (detectFn && detectFn()) {
        if (confirmFn) confirmFn();
        break;
      }

      // 4. Click Next Question Navigation Button immediately
      loopIteration++;
      const nextBtnFn = resolveFn("clickNextQuestionButton") || resolveFn("clickNextQuestionTab");
      let moved = nextBtnFn ? nextBtnFn() : false;

      if (!moved) {
        if (detectFn && detectFn()) {
          if (confirmFn) confirmFn();
          break;
        }
        await waitMs(500);
      } else {
        // Wait for next question view to render in DOM
        await waitMs(650);
      }
    }
  } finally {
    isAutonomousRunning = false;
    isAutonomousPaused = false;
    console.log("NetAcad AutoAnswer: Quiz Auto-Pilot finished.");
  }
}

// ─────────────────────────────────────────────
// FUNCTION 3: EFFICIENT COURSE SCROLLER LOOP
// ─────────────────────────────────────────────
async function runCourseScrollerLoop() {
  if (isCourseScrollerRunning) {
    console.debug("NetAcad AutoAnswer: Course Scroller already running.");
    return;
  }

  isCourseScrollerRunning = true;
  console.log("NetAcad AutoAnswer: Starting Efficient Course Scroller...");

  const maxSubTopics = 250;
  let iterations = 0;

  try {
    while (isCourseScrollerRunning && iterations < maxSubTopics) {
      if (!isCourseScrollerRunning) break;

      console.log(`NetAcad AutoAnswer: Course Scroller processing section #${iterations + 1}`);

      // 1. Cohesive Sweep: Fast-forward videos + click interactive check/flipcard buttons
      const videoFn = resolveFn("autoCompleteVideosOnPage");
      if (videoFn) videoFn();

      const checkBtnFn = resolveFn("autoClickAllCheckButtonsOnPage");
      if (checkBtnFn) checkBtnFn();

      // Record page data into local storage database
      recordPageData();

      // 2. Auto-Solve any "Check Your Understanding" / Quiz widgets on page
      const hasQuizFn = resolveFn("detectQuizOrCheckYourUnderstandingOnPage");
      const scrapeFn = resolveFn("scrapeData");
      if (hasQuizFn && hasQuizFn()) {
        if (scrapeFn) {
          await scrapeFn();
          const submitQuestionFn = resolveFn("autoSubmitQuestion");
          if (submitQuestionFn) submitQuestionFn();
        }
      }

      // 3. One-Pass Fast Page Scroll
      const scrollFn = resolveFn("autoScrollModulePage");
      if (scrollFn) await scrollFn();

      if (!isCourseScrollerRunning) break;

      // 4. Instant ToC Advancement to next incomplete section
      const navFn = resolveFn("navigateToFirstIncompleteLevel3Item");
      const fallbackNavFn = resolveFn("navigateToNextSubModule");

      let navigated = navFn ? navFn() : false;
      if (!navigated && fallbackNavFn) {
        navigated = fallbackNavFn();
      }

      if (!navigated) {
        console.log("NetAcad AutoAnswer: Course Scroller — all course topics 100% completed! 🎉");
        break;
      }

      // Wait for next section DOM to render
      await new Promise((r) => setTimeout(r, 1200));
      iterations++;
    }
  } finally {
    isCourseScrollerRunning = false;
    console.log("NetAcad AutoAnswer: Course Scroller finished.");
  }
}

// ─────────────────────────────────────────────
// FUNCTION 4: FULL COURSE DATA SCRAPER & EXPORTER
// ─────────────────────────────────────────────
async function recordPageData() {
  try {
    const pageTitle = (document.title || "").replace(/- NetAcad/i, "").trim();
    const roots = [document, ...(typeof getShadowRoots === "function" ? getShadowRoots(document) : [])];

    let headingTexts = [];
    let paragraphTexts = [];
    let codeBlocks = [];
    let questionsData = [];

    // Helper: filter out navigation / sidebar elements
    function isSidebarOrNav(el) {
      if (!el) return false;
      let curr = el;
      while (curr && curr !== document && curr !== window) {
        const cls = (curr.className || "").toString().toLowerCase();
        const id = (curr.id || "").toString().toLowerCase();
        const tag = (curr.tagName || "").toLowerCase();
        if (
          cls.includes("outline") || cls.includes("sidebar") || cls.includes("toc") ||
          cls.includes("menu") || cls.includes("nav") || tag === "nav" || tag === "header" || tag === "aside" ||
          id.includes("sidebar") || id.includes("outline") || id.includes("nav")
        ) {
          return true;
        }
        curr = curr.parentElement || (curr.getRootNode ? curr.getRootNode().host : null);
      }
      return false;
    }

    roots.forEach((root) => {
      // 1. Headings in main content
      const hEls = Array.from(root.querySelectorAll("h1, h2, h3, h4, .component__title, [class*='section-title']"));
      hEls.forEach((h) => {
        if (isSidebarOrNav(h)) return;
        const txt = (h.innerText || h.textContent || "").trim();
        if (txt && txt.length > 2 && !txt.toLowerCase().includes("course outline")) headingTexts.push(txt);
      });

      // 2. Paragraphs / Article text
      const pEls = Array.from(root.querySelectorAll("p, article, .component__content, [class*='article'], [class*='content']"));
      pEls.forEach((p) => {
        if (isSidebarOrNav(p)) return;
        const txt = (p.innerText || p.textContent || "").trim();
        if (txt && txt.length > 15 && !txt.startsWith("<") && !txt.includes("Course Outline")) {
          paragraphTexts.push(txt);
        }
      });

      // 3. Code Blocks & Terminal Snippets
      const cEls = Array.from(root.querySelectorAll("pre, code, [class*='code'], [class*='terminal'], [class*='snippet'], [class*='editor']"));
      cEls.forEach((c) => {
        if (isSidebarOrNav(c)) return;
        const txt = (c.innerText || c.textContent || "").trim();
        if (txt && txt.length > 5) codeBlocks.push(txt);
      });

      // 4. Questions & Answers on page
      const mcqElements = Array.from(root.querySelectorAll("mcq-view, object-matching-view, fill-blank-view"));
      mcqElements.forEach((mcqEl) => {
        const qFn = resolveFn("extractQuestionAndAnswers");
        if (qFn) {
          const parsed = qFn(mcqEl);
          if (parsed && parsed.questionText) {
            questionsData.push({
              question: parsed.questionText,
              options: parsed.answerTexts || [],
            });
          }
        }
      });
    });

    const uniqueHeadings = [...new Set(headingTexts)].slice(0, 5);
    const uniqueParagraphs = [...new Set(paragraphTexts)].slice(0, 40);
    const uniqueCodeBlocks = [...new Set(codeBlocks)].slice(0, 15);

    // Determine active section title & completion status from ToC
    let activeSectionTitle = "";
    let sectionStatus = "UNDONE ⏳";
    let isCompleted = false;
    const tocFn = resolveFn("parseThreeLevelCourseToC");
    let allSubTopicsList = [];

    if (tocFn) {
      const { allSubTopics } = tocFn();
      allSubTopicsList = allSubTopics || [];

      // Find active node in ToC sidebar
      roots.forEach((root) => {
        const activeNode = root.querySelector(".active, .current, .selected, .active-item, [aria-current='page']");
        if (activeNode) {
          const txt = (activeNode.innerText || activeNode.textContent || "").split("\n")[0].trim();
          if (txt && /^\d+\.\d+/i.test(txt)) activeSectionTitle = txt;
        }
      });

      const rawTitle = uniqueHeadings.length > 0 ? uniqueHeadings[0] : pageTitle;
      const matched = allSubTopicsList.find((t) => {
        if (activeSectionTitle && (t.title.includes(activeSectionTitle) || activeSectionTitle.includes(t.title))) return true;
        const tNum = (t.title.match(/^\d+\.\d+(\.\d+)?/) || [])[0];
        const rNum = (rawTitle.match(/^\d+\.\d+(\.\d+)?/) || [])[0];
        return tNum && rNum && tNum === rNum;
      });

      if (matched) {
        if (!activeSectionTitle) activeSectionTitle = matched.title;
        isCompleted = matched.isCompleted;
        sectionStatus = matched.isCompleted ? "DONE ✔" : "UNDONE ⏳";
      }
    }

    const finalTitle = activeSectionTitle || (uniqueHeadings.length > 0 ? uniqueHeadings.join(" | ") : pageTitle);

    // Avoid recording empty / sidebar-only pages
    if (uniqueParagraphs.length === 0 && uniqueCodeBlocks.length === 0 && questionsData.length === 0) {
      console.debug("NetAcad Data Exporter: Skipping page with no main article content yet.");
      return;
    }

    const entry = {
      url: window.location.href,
      pageTitle,
      sectionTitle: finalTitle,
      status: sectionStatus,
      isCompleted: isCompleted,
      timestamp: new Date().toISOString(),
      paragraphs: uniqueParagraphs,
      codeBlocks: uniqueCodeBlocks,
      questions: questionsData,
    };

    if (typeof chrome !== "undefined" && chrome.storage && chrome.storage.local) {
      const res = await chrome.storage.local.get(["scrapedCourseDb"]);
      const db = res.scrapedCourseDb || [];
      const existingIdx = db.findIndex((e) => e.sectionTitle === entry.sectionTitle);
      if (existingIdx >= 0) {
        db[existingIdx] = entry; // update with latest status & data
      } else {
        db.push(entry);
      }
      await chrome.storage.local.set({ scrapedCourseDb: db });
      console.log(`NetAcad Data Exporter: Recorded section "${finalTitle}" [${sectionStatus}] (${db.length} total).`);
    }
  } catch (err) {
    console.error("NetAcad Data Exporter error:", err);
  }
}

async function exportScrapedCourseData(format = "markdown") {
  if (typeof chrome === "undefined" || !chrome.storage || !chrome.storage.local) return;

  const res = await chrome.storage.local.get(["scrapedCourseDb"]);
  const db = res.scrapedCourseDb || [];

  // Merge full ToC outline if available
  const tocFn = resolveFn("parseThreeLevelCourseToC");
  let allTocTopics = [];
  if (tocFn) {
    const { allSubTopics } = tocFn();
    allTocTopics = allSubTopics || [];
  }

  // Combine ToC topics with scraped database
  const fullCourseItems = [];
  if (allTocTopics.length > 0) {
    allTocTopics.forEach((t) => {
      const scraped = db.find(
        (e) => e.sectionTitle.includes(t.title) || t.title.includes(e.sectionTitle) || (e.pageTitle && e.pageTitle.includes(t.title))
      );
      if (scraped) {
        scraped.status = t.isCompleted ? "DONE ✔" : "UNDONE ⏳";
        scraped.isCompleted = t.isCompleted;
        fullCourseItems.push(scraped);
      } else {
        fullCourseItems.push({
          sectionTitle: t.title,
          status: t.isCompleted ? "DONE ✔" : "UNDONE ⏳",
          isCompleted: t.isCompleted,
          url: window.location.href,
          paragraphs: [],
          codeBlocks: [],
          questions: [],
        });
      }
    });
  } else {
    fullCourseItems.push(...db);
  }

  if (fullCourseItems.length === 0) {
    alert("No course data recorded yet! Run 'Auto-Scroll & Complete Module' or navigate through course pages first.");
    return;
  }

  let content = "";
  let filename = `netacad_course_export_${Date.now()}`;
  let mimeType = "text/plain";

  const doneCount = fullCourseItems.filter((item) => item.isCompleted || (item.status && item.status.includes("DONE"))).length;
  const undoneCount = fullCourseItems.length - doneCount;

  if (format === "json") {
    const jsonOutput = {
      meta: {
        exportedAt: new Date().toISOString(),
        totalSectionsInCourse: fullCourseItems.length,
        doneSectionsCount: doneCount,
        undoneSectionsCount: undoneCount,
      },
      sections: fullCourseItems,
    };
    content = JSON.stringify(jsonOutput, null, 2);
    filename += ".json";
    mimeType = "application/json";
  } else {
    filename += ".md";
    mimeType = "text/markdown";
    content = `# NetAcad Course Full Data Export & Audit Report\n\n`;
    content += `*Exported on ${new Date().toLocaleString()} | ${fullCourseItems.length} Sections Total (${doneCount} DONE ✔ | ${undoneCount} UNDONE ⏳)*\n\n`;

    content += `## Course Section Audit Summary\n\n`;
    content += `| # | Section Title | Completion Status |\n`;
    content += `|---|---|---|\n`;
    fullCourseItems.forEach((item, idx) => {
      const statusLabel = item.isCompleted || (item.status && item.status.includes("DONE")) ? "DONE ✔" : "UNDONE ⏳";
      content += `| ${idx + 1} | ${item.sectionTitle || item.pageTitle} | ${statusLabel} |\n`;
    });
    content += `\n---\n\n`;

    fullCourseItems.forEach((item, idx) => {
      const statusLabel = item.isCompleted || (item.status && item.status.includes("DONE")) ? "DONE ✔" : "UNDONE ⏳";
      content += `## ${idx + 1}. ${item.sectionTitle || item.pageTitle} [${statusLabel}]\n\n`;
      content += `**Status**: \`${statusLabel}\` | **Source URL**: ${item.url || "N/A"}\n\n`;

      if (item.paragraphs && item.paragraphs.length > 0) {
        content += `### Course Content\n\n`;
        item.paragraphs.forEach((p) => {
          content += `${p}\n\n`;
        });
      }

      if (item.codeBlocks && item.codeBlocks.length > 0) {
        content += `### Code Snippets\n\n`;
        item.codeBlocks.forEach((code) => {
          content += "```python\n" + code + "\n```\n\n";
        });
      }

      if (item.questions && item.questions.length > 0) {
        content += `### Questions & Answers\n\n`;
        item.questions.forEach((q, qIdx) => {
          content += `**Q${qIdx + 1}: ${q.question}**\n`;
          (q.options || []).forEach((opt) => (content += `- ${opt}\n`));
          content += "\n";
        });
      }

      content += `---\n\n`;
    });
  }

  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  console.log(`NetAcad Data Exporter: Downloaded ${filename}!`);
}

const scraperExports = {
  scrapeData,
  runAutonomousLoop,
  runCourseScrollerLoop,
  recordPageData,
  exportScrapedCourseData,
  pauseAutonomousLoop,
  resumeAutonomousLoop,
  toggleAutonomousPause,
  stopAutonomousLoop,
  stopCourseScrollerLoop,
};

if (typeof window !== "undefined") {
  Object.assign(window, scraperExports);
}
if (typeof globalThis !== "undefined") {
  Object.assign(globalThis, scraperExports);
}