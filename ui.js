function getShadowRoots(root = document) {
  const shadowRoots = [];
  function traverse(node) {
    if (!node) return;
    if (node.shadowRoot) {
      shadowRoots.push(node.shadowRoot);
      traverse(node.shadowRoot);
    }
    const children = node.children || [];
    for (let i = 0; i < children.length; i++) {
      traverse(children[i]);
    }
  }
  traverse(root);
  return shadowRoots;
}

function buildAnswerNode(labelText, answers) {
  const wrapper = document.createDocumentFragment();
  const label = document.createElement("b");
  label.textContent = labelText;
  wrapper.appendChild(label);

  if (answers.length === 1) {
    wrapper.appendChild(document.createTextNode(" " + answers[0]));
  } else {
    answers.forEach((ans) => {
      wrapper.appendChild(document.createElement("br"));
      wrapper.appendChild(document.createTextNode("- " + ans));
    });
  }
  return wrapper;
}

function createAiAssistantUI(uiContainerId, index) {
  const uiContainer = document.createElement("div");
  uiContainer.id = uiContainerId;
  uiContainer.className = "netacad-ai-assistant-ui";
  Object.assign(uiContainer.style, {
    marginTop: "12px",
    marginBottom: "12px",
    padding: "12px 14px",
    border: "1px solid #3b82f6",
    borderRadius: "8px",
    backgroundColor: "#1e293b",
    color: "#f8fafc",
    fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
    fontSize: "13px",
    boxShadow: "0 4px 12px rgba(0, 0, 0, 0.25)",
  });

  const headerDiv = document.createElement("div");
  Object.assign(headerDiv.style, {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: "8px",
  });

  const titleElement = document.createElement("span");
  titleElement.textContent = "AI Assistant";
  Object.assign(titleElement.style, {
    fontWeight: "700",
    color: "#38bdf8",
    fontSize: "13px",
  });

  const badge = document.createElement("span");
  badge.className = "ai-status-badge";
  badge.textContent = "Analyzing...";
  Object.assign(badge.style, {
    fontSize: "11px",
    padding: "2px 8px",
    borderRadius: "12px",
    backgroundColor: "rgba(56, 189, 248, 0.15)",
    color: "#38bdf8",
    border: "1px solid rgba(56, 189, 248, 0.3)",
  });

  headerDiv.appendChild(titleElement);
  headerDiv.appendChild(badge);
  uiContainer.appendChild(headerDiv);

  const runningBanner = document.createElement("div");
  runningBanner.className = "ai-running-banner";
  runningBanner.style.display = "none";
  runningBanner.innerHTML = `<span class="netacad-running-dot"></span> ⚡ Quiz Auto-Pilot is Running... Please do not switch or close this tab!`;
  uiContainer.appendChild(runningBanner);

  const aiAnswerDisplay = document.createElement("div");
  aiAnswerDisplay.className = "ai-answer-display";
  Object.assign(aiAnswerDisplay.style, {
    margin: "8px 0",
    padding: "8px 10px",
    backgroundColor: "rgba(15, 23, 42, 0.6)",
    borderRadius: "6px",
    borderLeft: "3px solid #38bdf8",
    lineHeight: "1.5",
    wordBreak: "break-word",
    color: "#e2e8f0",
  });
  aiAnswerDisplay.textContent = "Initializing...";
  uiContainer.appendChild(aiAnswerDisplay);

  const btnRow = document.createElement("div");
  Object.assign(btnRow.style, {
    display: "flex",
    gap: "8px",
    marginTop: "10px",
  });

  const refreshButton = document.createElement("button");
  refreshButton.className = "ai-refresh-button";
  refreshButton.textContent = "Refresh";
  Object.assign(refreshButton.style, {
    padding: "5px 10px",
    border: "none",
    borderRadius: "4px",
    backgroundColor: "#2563eb",
    color: "white",
    cursor: "pointer",
    fontSize: "11px",
    fontWeight: "600",
  });

  const autoSelectButton = document.createElement("button");
  autoSelectButton.className = "ai-autoselect-button";
  autoSelectButton.textContent = "Auto-Select";
  Object.assign(autoSelectButton.style, {
    padding: "5px 10px",
    border: "none",
    borderRadius: "4px",
    backgroundColor: "#059669",
    color: "white",
    cursor: "pointer",
    fontSize: "11px",
    fontWeight: "600",
  });

  const copyButton = document.createElement("button");
  copyButton.className = "ai-copy-button";
  copyButton.textContent = "Copy";
  Object.assign(copyButton.style, {
    padding: "5px 10px",
    border: "1px solid #475569",
    borderRadius: "4px",
    backgroundColor: "#334155",
    color: "#cbd5e1",
    cursor: "pointer",
    fontSize: "11px",
  });

  btnRow.appendChild(refreshButton);
  btnRow.appendChild(autoSelectButton);
  btnRow.appendChild(copyButton);
  uiContainer.appendChild(btnRow);

  return { uiContainer, aiAnswerDisplay, refreshButton, autoSelectButton, copyButton, badge };
}

function zoomOutExtractContext(element, promptText) {
  const codeSnippets = [];

  const allRoots = [
    element ? element.shadowRoot : null,
    element && element.getRootNode ? element.getRootNode() : null,
    ...(typeof getShadowRoots === "function" ? getShadowRoots(document) : []),
    document,
  ].filter((r) => r && r instanceof Node);

  allRoots.forEach((root) => {
    const codeSelectors = [
      "pre",
      "code",
      "[class*='code']",
      "[class*='snippet']",
      "[class*='terminal']",
      "[class*='editor']",
      "[class*='syntax']",
      ".code-block",
      ".syntax-highlighter",
      ".formatted-code",
      "table",
      "textarea",
      "figure",
    ].join(", ");

    const elements = Array.from(root.querySelectorAll(codeSelectors));
    elements.forEach((el) => {
      // Ignore AI Assistant panel and MCQ choice options
      if (el.closest && (el.closest(".ai-assistant-panel") || el.closest(".mcq__item") || el.closest("mat-radio-button") || el.closest("mat-checkbox"))) {
        return;
      }

      const text = (el.innerText || el.textContent || "").trim();
      const isCodeLike =
        text.includes("\n") ||
        /\b(class|def|return|print|import|from|if|else|elif|for|while|try|except|pass|var|let|const|function|issubclass)\b/.test(text) ||
        /[\{\}\(\)\[\];\=]/.test(text);

      if (text.length > 5 && isCodeLike && !promptText.includes(text) && !codeSnippets.some((s) => s.includes(text) || text.includes(s))) {
        codeSnippets.push(text);
      }
    });

    const imgEls = Array.from(root.querySelectorAll("img[alt]"));
    imgEls.forEach((img) => {
      const alt = (img.getAttribute("alt") || "").trim();
      if (alt && alt.length > 3 && !promptText.includes(alt) && !codeSnippets.includes(`[Image Description: ${alt}]`)) {
        codeSnippets.push(`[Image Description: ${alt}]`);
      }
    });
  });

  return codeSnippets;
}

function extractQuestionAndAnswers(mcqViewElement, index) {
  let questionText = "Question text not found";
  let answerElements = [];
  let questionTextElement = null;

  try {
    if (mcqViewElement && mcqViewElement.shadowRoot) {
      const baseView = mcqViewElement.shadowRoot.querySelector('base-view[type="component"]');
      const root = (baseView && baseView.shadowRoot) ? baseView.shadowRoot : mcqViewElement.shadowRoot;

      questionTextElement =
        root.querySelector("div.component__body-inner.mcq__body-inner") ||
        root.querySelector("div.component__body") ||
        root.querySelector(".mcq__prompt") ||
        root.querySelector(".prompt");

      let promptText = "";
      if (questionTextElement) {
        promptText = questionTextElement.innerText.trim();
      } else {
        const potentialElements = Array.from(root.querySelectorAll("div, p, span"));
        for (const el of potentialElements) {
          const text = el.innerText.trim();
          if (text.length > 20) {
            promptText = text;
            questionTextElement = el;
            break;
          }
        }
      }

      // Zoom out search scope to extract all code blocks, syntax highlighters & context across document & shadow DOMs
      const codeSnippets = zoomOutExtractContext(mcqViewElement, promptText);

      if (codeSnippets.length > 0) {
        questionText = `${promptText}\n\nCode / Context:\n${codeSnippets.join("\n\n")}`;
      } else {
        questionText = promptText || "Question text not found";
      }

      answerElements = mcqViewElement.shadowRoot.querySelectorAll(".mcq__item-label.js-item-label, .mcq__item, label");
      if (answerElements.length === 0 && baseView && baseView.shadowRoot) {
        answerElements = baseView.shadowRoot.querySelectorAll(".mcq__item-label.js-item-label, .mcq__item, label");
      }
    } else {
      questionText = "Error: MCQ View element not accessible.";
    }
  } catch (e) {
    console.error(`NetAcad UI: Error extracting Q&A for question ${index + 1}:`, e);
    questionText = `Error extracting data. Check console.`;
  }
  return { questionText, answerElements, questionTextElement };
}

function extractMatchingQuestion(omvElement, index) {
  let questionText = "Question text not found";
  let categories = [];
  let options = [];
  let questionTextElement = null;

  try {
    if (!omvElement || !omvElement.shadowRoot) {
      return { questionText: "Error: object-matching-view shadowRoot missing.", categories, options, questionTextElement };
    }
    const sr = omvElement.shadowRoot;
    const baseView = sr.querySelector('base-view[type="component"]');
    const root = (baseView && baseView.shadowRoot) ? baseView.shadowRoot : sr;

    questionTextElement =
      root.querySelector("div.component__body-inner") ||
      root.querySelector(".objectMatching__prompt") ||
      root.querySelector(".prompt") ||
      sr.querySelector(".objectMatching__title") ||
      sr.querySelector(".component__title");

    if (questionTextElement) questionText = questionTextElement.innerText.trim();

    const categoryEls = Array.from(
      sr.querySelectorAll(".objectMatching-category-item, .objectMatching__category-item, .category-item, [class*='category']")
    );

    categoryEls.forEach((btn, i) => {
      const textEl = btn.querySelector(
        ".category-item-text, [class*='text']:not([class*='number']):not([class*='letter'])"
      ) || btn;

      let rawLetter = "";
      const numEl = btn.querySelector(
        ".category-item-number, .category-number, .category-letter, " +
        "[class*='number'], [class*='letter'], [class*='circle']"
      );
      if (numEl) {
        rawLetter = numEl.innerText.trim();
      }

      rawLetter = rawLetter.replace(/[^A-Za-z0-9]/g, "").trim();

      if (!rawLetter || rawLetter.length > 2) {
        const leaves = Array.from(btn.querySelectorAll("*")).filter(
          (el) => el.children.length === 0 && /^[A-Z]$/i.test((el.innerText || "").trim())
        );
        rawLetter = leaves.length > 0 ? leaves[0].innerText.trim().toUpperCase() : String.fromCharCode(65 + i);
      }

      const letter = rawLetter.toUpperCase();
      const text = textEl.innerText.trim();

      if (text && !categories.some((c) => c.letter === letter)) {
        categories.push({ text, letter, element: btn });
      }
    });

    const optionEls = Array.from(
      sr.querySelectorAll(".objectMatching-option-item, .objectMatching__option-item, .option-item, [class*='option']")
    );

    optionEls.forEach((btn) => {
      const text = btn.innerText.trim();
      if (text && !options.some((o) => o.text === text)) {
        options.push({ text, element: btn });
      }
    });
  } catch (e) {
    console.error(`NetAcad UI: Error extracting matching Q ${index + 1}:`, e);
    questionText = "Error extracting matching data. Check console.";
  }
  return { questionText, categories, options, questionTextElement };
}

function processAnswerElements(answerElements, index) {
  const answerTexts = [];
  const seen = new Set();
  answerElements.forEach((answer) => {
    const ansText = answer.innerText.trim();
    if (ansText && !seen.has(ansText)) {
      seen.add(ansText);
      answerTexts.push(ansText);
    }
  });
  return answerTexts;
}

function dispatchFullClickSequence(targetElement) {
  if (!targetElement) return;
  try {
    const opts = { bubbles: true, cancelable: true, view: window, buttons: 1 };
    targetElement.dispatchEvent(new PointerEvent("pointerdown", opts));
    targetElement.dispatchEvent(new MouseEvent("mousedown", opts));
    if (typeof targetElement.focus === "function") targetElement.focus();
    targetElement.dispatchEvent(new MouseEvent("mouseup", opts));
    targetElement.dispatchEvent(new PointerEvent("pointerup", opts));
    targetElement.click();
    targetElement.dispatchEvent(new MouseEvent("click", opts));
  } catch (err) {
    targetElement.click();
  }
}

function findExactMatchingElements(sr, categoryLetter, targetOptionText) {
  let exactCategoryNode = null;
  let exactCategoryClickTarget = null;
  let exactOptionNode = null;
  let exactOptionClickTarget = null;

  const catCards = Array.from(
    sr.querySelectorAll(".objectMatching-category-item, .objectMatching__category-item, .category-item, [class*='category']")
  );

  for (const catCard of catCards) {
    const letterCircleNode = catCard.querySelector(
      ".category-item-number, .category-number, [class*='number'], [class*='letter'], [class*='circle'], .circle"
    );
    const textStr = (letterCircleNode ? letterCircleNode.innerText : catCard.innerText || "").trim().toUpperCase();

    if (textStr === categoryLetter || textStr.startsWith(categoryLetter) || catCard.dataset?.id === categoryLetter) {
      exactCategoryNode = catCard;
      exactCategoryClickTarget = letterCircleNode || catCard;
      break;
    }
  }

  if (!exactCategoryNode) {
    const allEls = Array.from(sr.querySelectorAll("*"));
    const catCircleEl = allEls.find((el) => {
      const txt = (el.innerText || "").trim().toUpperCase();
      return txt === categoryLetter && el.children.length === 0;
    });
    if (catCircleEl) {
      exactCategoryClickTarget = catCircleEl;
      exactCategoryNode = catCircleEl.closest("[class*='category']") || catCircleEl.parentElement || catCircleEl;
    }
  }

  const optCards = Array.from(
    sr.querySelectorAll(".objectMatching-option-item, .objectMatching__option-item, .option-item, [class*='option']")
  );

  for (const optCard of optCards) {
    const fullText = (optCard.innerText || "").trim().toLowerCase();
    if (!fullText) continue;

    const isExact = fullText === targetOptionText;
    const isPrefix = fullText.startsWith(targetOptionText);
    const isContained = fullText.length >= 6 && targetOptionText.includes(fullText);

    if (isExact || isPrefix || isContained) {
      exactOptionNode = optCard;
      const circleNode = optCard.querySelector(
        ".option-item-circle, .option-circle, .option-target, " +
        "[class*='circle'], [class*='target']"
      );
      exactOptionClickTarget = circleNode || optCard;
      break;
    }
  }

  if (!exactOptionNode) {
    const candidates = Array.from(sr.querySelectorAll("div, p, span, button, label"));
    for (const el of candidates) {
      const txt = (el.innerText || "").trim().toLowerCase();
      if (!txt) continue;
      const isExact = txt === targetOptionText;
      const isPrefix = txt.startsWith(targetOptionText);
      const isContained = txt.length >= 6 && targetOptionText.includes(txt);
      if (isExact || isPrefix || isContained) {
        exactOptionNode = el.closest("[class*='option']") || el.parentElement || el;
        const circleNode = exactOptionNode.querySelector(
          ".option-item-circle, .option-circle, .option-target, [class*='circle'], [class*='target']"
        );
        exactOptionClickTarget = circleNode || exactOptionNode;
        break;
      }
    }
  }

  return { exactCategoryNode, exactCategoryClickTarget, exactOptionNode, exactOptionClickTarget };
}

async function processMatchingPairsSequentially(sr, pairs) {
  for (const pair of pairs) {
    const parts = pair.split(":");
    if (parts.length < 2) continue;

    const categoryLetter = parts[0].trim().toUpperCase();
    const targetOptionText = parts.slice(1).join(":").trim().toLowerCase();

    const { exactCategoryNode, exactCategoryClickTarget, exactOptionNode, exactOptionClickTarget } =
      findExactMatchingElements(sr, categoryLetter, targetOptionText);

    if (exactCategoryClickTarget && exactOptionClickTarget) {
      console.debug(`NetAcad AutoAnswer: Exact DOM match '${categoryLetter}' → '${targetOptionText}'`);

      // --- Click category circle ---
      dispatchFullClickSequence(exactCategoryClickTarget);
      if (exactCategoryNode && exactCategoryNode !== exactCategoryClickTarget) {
        dispatchFullClickSequence(exactCategoryNode);
      }
      exactCategoryNode.style.outline = "2px solid #38bdf8";

      await new Promise((res) => setTimeout(res, 350));

      // --- Click option ---
      dispatchFullClickSequence(exactOptionClickTarget);
      if (exactOptionNode && exactOptionNode !== exactOptionClickTarget) {
        dispatchFullClickSequence(exactOptionNode);
      }

      await new Promise((res) => setTimeout(res, 400));

      // --- Verify the connection was registered ---
      const connectedSignals = ["is-connected", "selected", "matched", "active", "correct", "answered"];
      const isConnected =
        connectedSignals.some((cls) => exactCategoryNode.classList.contains(cls) || exactOptionNode.classList.contains(cls)) ||
        exactCategoryNode.getAttribute("aria-pressed") === "true" ||
        exactOptionNode.getAttribute("aria-pressed") === "true" ||
        exactCategoryNode.getAttribute("aria-selected") === "true" ||
        exactOptionNode.getAttribute("aria-selected") === "true";

      if (!isConnected) {
        console.debug(`NetAcad AutoAnswer: No connection signal detected for '${categoryLetter}'; retrying...`);
        await new Promise((res) => setTimeout(res, 500));
        dispatchFullClickSequence(exactCategoryClickTarget);
        await new Promise((res) => setTimeout(res, 400));
        dispatchFullClickSequence(exactOptionClickTarget);
        await new Promise((res) => setTimeout(res, 400));
      }

      exactOptionNode.style.outline = "2px solid #10b981";
      exactCategoryNode.style.outline = "2px solid #10b981";
      exactOptionNode.style.backgroundColor = "rgba(16, 185, 129, 0.15)";
      exactCategoryNode.style.backgroundColor = "rgba(16, 185, 129, 0.15)";

      await new Promise((res) => setTimeout(res, 200));
    } else {
      console.warn(
        `NetAcad AutoAnswer: Could not find DOM targets for '${categoryLetter}' → '${targetOptionText}'` +
        ` | categoryFound=${!!exactCategoryClickTarget} | optionFound=${!!exactOptionClickTarget}`
      );
    }
  }
}

// --- Interactive "Check" / Flipcard Button Clicker Feature ---
function autoClickAllCheckButtonsOnPage() {
  const roots = [document, ...(typeof getShadowRoots === "function" ? getShadowRoots(document) : [])];
  let clickedCount = 0;

  roots.forEach((root) => {
    const candidateBtns = Array.from(
      root.querySelectorAll("button, input[type='button'], mat-button, .flip-card, [class*='check'], [class*='flip'], [class*='reveal'], [class*='card']")
    );

    candidateBtns.forEach((btn) => {
      try {
        const text = (btn.innerText || btn.value || btn.getAttribute("aria-label") || btn.title || "").trim().toLowerCase();
        const isNavBtn = text.includes("next") || text.includes("prev") || text.includes("submit my assessment") || text.includes("lanjut");

        if (isNavBtn || btn.disabled || btn.offsetParent === null) return;

        const isCheckTarget =
          text === "check" ||
          text === "check answer" ||
          text === "check answers" ||
          text === "show answer" ||
          text === "flip" ||
          text === "reveal" ||
          text === "verify" ||
          text === "periksa" ||
          text === "jawab" ||
          text.includes("check") ||
          text.includes("flip") ||
          btn.classList.contains("flip-card") ||
          btn.classList.contains("check-btn");

        if (isCheckTarget) {
          dispatchFullClickSequence(btn);
          clickedCount++;
          console.debug(`NetAcad AutoAnswer: Clicked interactive check/flipcard button ("${text}")`);
        }
      } catch (err) {
        console.error("NetAcad UI: Error clicking check button:", err);
      }
    });
  });

  return clickedCount;
}

// --- Quiz / "Check Your Understanding" Section Detector ---
function detectQuizOrCheckYourUnderstandingOnPage() {
  const roots = [document, ...(typeof getShadowRoots === "function" ? getShadowRoots(document) : [])];

  for (const root of roots) {
    const quizViews = root.querySelectorAll("mcq-view, object-matching-view, fill-blank-view, [class*='mcq'], [class*='matching']");
    if (quizViews.length > 0) return true;

    const headings = Array.from(root.querySelectorAll("h1, h2, h3, h4, .component__title, [class*='title'], [class*='prompt']"));
    const hasQuizHeading = headings.some((h) => {
      const txt = (h.innerText || h.textContent || "").toLowerCase();
      return txt.includes("check your understanding") || txt.includes("section quiz") || txt.includes("module test") || txt.includes("quiz");
    });
    if (hasQuizHeading) return true;
  }
  return false;
}

// --- Video Auto-Completer Feature (Fast-forward to last second) ---
function autoCompleteVideosOnPage() {
  const roots = [document, ...(typeof getShadowRoots === "function" ? getShadowRoots(document) : [])];
  let videosProcessed = 0;

  roots.forEach((root) => {
    const videos = Array.from(root.querySelectorAll("video"));
    videos.forEach((video) => {
      try {
        if (video.duration && !isNaN(video.duration) && video.duration > 0) {
          video.currentTime = Math.max(0, video.duration - 0.2);
          video.play().catch(() => {});
          video.dispatchEvent(new Event("timeupdate", { bubbles: true }));
          video.dispatchEvent(new Event("ended", { bubbles: true }));
          videosProcessed++;
          console.debug(`NetAcad AutoAnswer: Video completion triggered at ${video.currentTime}s.`);
        } else {
          video.play().catch(() => {});
          video.dispatchEvent(new Event("ended", { bubbles: true }));
          videosProcessed++;
        }
      } catch (err) {
        console.error("NetAcad UI: Video fast-forward error:", err);
      }
    });
  });

  return videosProcessed;
}

// --- Module Smooth Auto-Scroller Feature across Level-3 Sub-Headings ---
async function autoScrollModulePage() {
  console.debug("NetAcad AutoAnswer: Starting module smooth auto-scroll...");

  // 1. One-pass fast video & interactive check button sweep
  autoCompleteVideosOnPage();
  autoClickAllCheckButtonsOnPage();

  // 2. Fast fluid scroll to page bottom to hit 100% reading completion trackers
  const maxScroll = Math.max(
    document.body.scrollHeight,
    document.documentElement.scrollHeight,
    window.innerHeight * 3
  );
  window.scrollTo({ top: Math.floor(maxScroll / 2), behavior: "smooth" });
  await new Promise((res) => setTimeout(res, 150));

  window.scrollTo({ top: maxScroll, behavior: "smooth" });
  await new Promise((res) => setTimeout(res, 200));
}

function isTocItemCompleted(item) {
  if (!item) return false;

  const itemText = (item.innerText || item.textContent || "").trim();

  // 1. ABSOLUTE TRUTH: Fraction Ratio (e.g. "0/5", "3/10", "10/10", "11/11")
  const fractionMatch = itemText.match(/(\d+)\s*\/\s*(\d+)/);
  if (fractionMatch) {
    const current = parseInt(fractionMatch[1], 10);
    const total = parseInt(fractionMatch[2], 10);
    if (total > 0) {
      // If current count is less than total, it is UNDONE (incomplete)
      if (current < total) return false;
      // If current count equals or exceeds total, it is DONE (completed)
      if (current >= total) return true;
    }
  }

  // 2. SECONDARY TRUTH: Explicit Completion Classes on element
  const classListStr = (item.className || "").toString().toLowerCase();
  if (classListStr.includes("is-completed") || classListStr.includes("status-done")) {
    return true;
  }

  // 3. TERTIARY TRUTH: Explicit Green Checkmark Icons (only if no 0/X fraction was present)
  const greenCheckIcon = item.querySelector(
    "svg.green, .green-check, .icon-check, .completed-icon, .fa-check-circle, [data-icon='check-circle'], mat-icon[fonticon='check']"
  );
  if (greenCheckIcon && !itemText.includes("0/")) return true;

  // 4. SVG fill color check (#10b981, #059669, #22c55e)
  const svgs = item.querySelectorAll("svg");
  for (const svg of svgs) {
    const fill = (svg.getAttribute("fill") || "").toLowerCase();
    const style = (svg.getAttribute("style") || "").toLowerCase();
    if (
      fill.includes("#10b981") || fill.includes("#059669") || fill.includes("#22c55e") || style.includes("#10b981")
    ) {
      if (!itemText.includes("0/")) return true;
    }
  }

  return false;
}

// --- Parse 3-Level Table of Contents in Strict Sequential Top-to-Bottom Order ---
function parseThreeLevelCourseToC() {
  const roots = [document, ...(typeof getShadowRoots === "function" ? getShadowRoots(document) : [])];
  const allSubTopics = [];

  roots.forEach((root) => {
    // 1. Expand all collapsed accordions in ToC sidebar
    const expandButtons = Array.from(
      root.querySelectorAll(
        ".accordion-toggle, .expand-btn, [class*='expand'], [class*='accordion'], [aria-expanded='false']"
      )
    );
    expandButtons.forEach((btn) => {
      try {
        if (btn.getAttribute("aria-expanded") === "false" || btn.classList.contains("collapsed")) {
          btn.click();
        }
      } catch (_) {}
    });

    // 2. Query all candidate ToC items in strict DOM document order
    const items = Array.from(
      root.querySelectorAll(
        "app-course-outline-item, li, .tree-node, .subtopic-item, .topic-item, .section-item, [class*='outline-item'], [class*='subtopic'], [class*='tree-item'], [class*='leaf'], [class*='topic']"
      )
    );

    items.forEach((item, index) => {
      const text = (item.innerText || item.textContent || "").trim();
      if (!text) return;

      const firstLine = text.split("\n")[0].trim();
      const lowerFirst = firstLine.toLowerCase();

      // Exclude Final Exam, PCAP, and End of Course Survey items
      if (
        lowerFirst.includes("pcap") ||
        lowerFirst.includes("final exam") ||
        lowerFirst.includes("survey") ||
        lowerFirst.includes("certification")
      ) {
        return;
      }

      const isLevel3Pattern = /^\d+\.\d+\.\d+/i.test(firstLine);
      const isLevel2Pattern = /^\d+\.\d+/i.test(firstLine);

      if (!isLevel3Pattern && !isLevel2Pattern) return;

      const title = firstLine;
      const isCompleted = isTocItemCompleted(item);

      if (!allSubTopics.some((t) => t.title === title)) {
        allSubTopics.push({
          index,
          title,
          isCompleted,
          element: item,
        });
      }
    });
  });

  const completedCount = allSubTopics.filter((t) => t.isCompleted).length;
  const incompleteSubTopics = allSubTopics.filter((t) => !t.isCompleted);

  console.log(`NetAcad ToC Sequential Progress: ${completedCount}/${allSubTopics.length} topics completed.`);
  return { allSubTopics, completedCount, incompleteSubTopics };
}

// --- Navigate to First Incomplete Section in Strict Top-to-Bottom Order ---
function navigateToFirstIncompleteLevel3Item() {
  const { allSubTopics, incompleteSubTopics } = parseThreeLevelCourseToC();

  if (allSubTopics.length > 0) {
    console.group("NetAcad ToC Audit Trace");
    allSubTopics.forEach((topic, i) => {
      console.log(`[ToC #${i + 1}] "${topic.title}" -> ${topic.isCompleted ? "DONE ✔" : "UNDONE ⏳"}`);
    });
    console.groupEnd();
  }

  if (incompleteSubTopics.length > 0) {
    const firstIncomplete = incompleteSubTopics[0];
    console.log(`NetAcad ToC Navigation: Advancing to FIRST UNDONE topic in order: "${firstIncomplete.title}"`);
    dispatchFullClickSequence(firstIncomplete.element);
    return true;
  }

  console.log("NetAcad ToC Navigation: All course sections & topics are 100% completed! 🎉");
  return false;
}

// --- Strictly ToC-Based Module Navigation ---
function navigateToNextSubModule() {
  // Rely strictly on Table of Contents (ToC) to prevent footer link jumping to Final Exam / PCAP
  return navigateToFirstIncompleteLevel3Item();
}

function cleanOptionTextForMatch(text) {
  if (!text || typeof text !== "string") return "";
  let clean = text.trim();
  const stripped = clean.replace(/^(?:[0-9]+|[a-zA-Z])[\.\)\:\-]\s*/, "").replace(/^[\-\*]\s*/, "").trim();
  const result = (stripped.length > 0 ? stripped : clean).toLowerCase();
  return result;
}

function stripNonAlphanumeric(text) {
  return (text || "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

async function autoSelectOptionsInDom(mcqViewElement, answerText) {
  if (!mcqViewElement || !answerText || answerText.toLowerCase().startsWith("error:")) return;

  try {
    const sr = mcqViewElement ? mcqViewElement.shadowRoot : null;
    const isMatching = (mcqViewElement && mcqViewElement.tagName && mcqViewElement.tagName.toLowerCase() === "object-matching-view") ||
                       (answerText && answerText.includes(" /// ") && /^A:\s+/i.test(answerText.trim()));

    if (isMatching) {
      console.log("NetAcad UI: Object-matching question detected — suggesting answer in UI panel without auto-filling.");
      return;
    }

    const rawAnswers = answerText.split(" /// ").map((a) => a.trim()).filter(Boolean);
    const targetAnswers = rawAnswers.map((a) => cleanOptionTextForMatch(a));

    const baseView = sr ? sr.querySelector('base-view[type="component"]') : null;
    const searchRoots = [
      sr,
      baseView && baseView.shadowRoot ? baseView.shadowRoot : null,
      mcqViewElement && mcqViewElement.getRootNode ? mcqViewElement.getRootNode() : null,
      ...(typeof getShadowRoots === "function" ? getShadowRoots(document) : []),
      document,
    ].filter((r) => r && r instanceof Node);

    // Tier 1: Check for Text Input Fields (Fill-in-the-blank)
    for (const root of searchRoots) {
      const textInputs = Array.from(root.querySelectorAll("input[type='text'], input[type='search'], input:not([type]), textarea"));
      const visibleInputs = textInputs.filter((i) => !i.disabled && i.type !== "hidden" && i.type !== "radio" && i.type !== "checkbox" && i.type !== "button" && i.type !== "submit");
      if (visibleInputs.length > 0) {
        visibleInputs.forEach((inputEl, idx) => {
          const val = rawAnswers[idx] || rawAnswers[0];
          if (val) {
            inputEl.value = val;
            inputEl.dispatchEvent(new Event("input", { bubbles: true }));
            inputEl.dispatchEvent(new Event("change", { bubbles: true }));
            inputEl.style.outline = "2px solid #10b981";
            inputEl.style.backgroundColor = "rgba(16, 185, 129, 0.15)";
            console.log(`NetAcad UI: Auto-filled text input field with "${val}"`);
          }
        });
        return;
      }
    }

    // Tier 2: Gather Option Choice Nodes
    let optionNodes = [];
    searchRoots.forEach((root) => {
      const nodes = Array.from(
        root.querySelectorAll(
          "mat-radio-button, mat-checkbox, .component__option, .mcq__item, .mcq__option, label[for], .mcq__item-label, label, [class*='option'], [class*='choice'], [class*='item']"
        )
      );
      optionNodes.push(...nodes);
    });

    const uniqueNodes = Array.from(new Set(optionNodes));

    // Build candidate list with labels and inputs
    const parsedCandidates = uniqueNodes.map((node, index) => {
      const labelEl = node.querySelector(".mcq__item-label, .mat-radio-label, .mat-checkbox-label, .component__option-label, label, code, span") || node;
      const rawText = (labelEl.innerText || labelEl.textContent || "").trim();
      const cleanText = cleanOptionTextForMatch(rawText);
      const alphaText = stripNonAlphanumeric(cleanText);
      const inputEl = node.querySelector("input[type='checkbox'], input[type='radio']") || (node.tagName === "INPUT" ? node : null);
      return { index, node, labelEl, rawText, cleanText, alphaText, inputEl };
    });

    targetAnswers.forEach((targetAns, tIdx) => {
      if (!targetAns) return;

      const targetAlpha = stripNonAlphanumeric(targetAns);
      let bestMatch = null;
      let highestScore = 0;

      parsedCandidates.forEach((cand) => {
        let score = 0;
        const candRawLower = cand.rawText.trim().toLowerCase();

        if (cand.cleanText === targetAns || candRawLower === targetAns) {
          score = 100;
        } else if (cand.alphaText && cand.alphaText === targetAlpha) {
          score = 95;
        } else if (/^\d+$/.test(targetAns) && (cand.cleanText === targetAns || candRawLower.includes(targetAns))) {
          score = 90;
        } else {
          if (targetAlpha.length >= 2 && cand.alphaText.includes(targetAlpha)) {
            score = 85;
          } else if (cand.alphaText.length >= 2 && targetAlpha.includes(cand.alphaText)) {
            score = 80;
          }
        }

        if (score > highestScore) {
          highestScore = score;
          bestMatch = cand;
        }
      });

      // Tier 3: Positional Number & Letter Fallback
      if (!bestMatch || highestScore < 70) {
        if (/^[1-9]\d*$/.test(targetAns)) {
          const numIdx = parseInt(targetAns, 10) - 1;
          if (numIdx >= 0 && numIdx < parsedCandidates.length) {
            bestMatch = parsedCandidates[numIdx];
            highestScore = 75;
            console.log(`NetAcad UI: Positional number fallback matched target "${targetAns}" to option #${numIdx + 1} ("${bestMatch.rawText}")`);
          }
        } else if (/^[a-z]$/i.test(targetAns)) {
          const letterIdx = targetAns.toLowerCase().charCodeAt(0) - 97;
          if (letterIdx >= 0 && letterIdx < parsedCandidates.length) {
            bestMatch = parsedCandidates[letterIdx];
            highestScore = 75;
            console.log(`NetAcad UI: Positional letter fallback matched target "${targetAns}" to option #${letterIdx + 1} ("${bestMatch.rawText}")`);
          }
        }
      }

      // Tier 4: Direct Index Fallback
      if (!bestMatch && parsedCandidates.length > tIdx) {
        bestMatch = parsedCandidates[tIdx];
        highestScore = 50;
        console.log(`NetAcad UI: Direct index fallback matched target "${targetAns}" to option #${tIdx + 1}`);
      }

      if (bestMatch) {
        console.debug(`NetAcad UI: Auto-selecting option "${bestMatch.rawText}" for target "${targetAns}" (Score: ${highestScore})`);

        if (bestMatch.inputEl) {
          if (!bestMatch.inputEl.checked) {
            dispatchFullClickSequence(bestMatch.inputEl);
            bestMatch.inputEl.checked = true;
            bestMatch.inputEl.dispatchEvent(new Event("change", { bubbles: true }));
            bestMatch.inputEl.dispatchEvent(new Event("input", { bubbles: true }));
          }
        } else {
          dispatchFullClickSequence(bestMatch.node);
        }

        const highlightEl = bestMatch.node;
        highlightEl.style.outline = "2px solid #10b981";
        highlightEl.style.backgroundColor = "rgba(16, 185, 129, 0.15)";
        highlightEl.style.borderRadius = "6px";
        highlightEl.style.transition = "all 0.2s ease-in-out";
      } else {
        console.warn(`NetAcad UI: Could not find any candidate option in DOM for target answer: "${targetAns}"`);
      }
    });
  } catch (err) {
    console.error("NetAcad UI: Auto-select error:", err);
  }
}

function findSubmitButtonInRoots() {
  const roots = [document, ...getShadowRoots(document)];
  for (const root of roots) {
    const buttons = Array.from(root.querySelectorAll("button, input[type='button'], input[type='submit'], .button, mat-button, [role='button']"));
    const submitBtn = buttons.find((b) => {
      const txt = (b.innerText || b.value || b.getAttribute("aria-label") || b.title || "").trim().toLowerCase();
      const isSubmitText = (
        txt === "check" ||
        txt === "submit" ||
        txt === "check answer" ||
        txt === "verifikasi" ||
        txt === "kirim" ||
        txt === "periksa" ||
        txt === "jawab" ||
        txt === "submit answer" ||
        txt.includes("submit") ||
        txt.includes("check")
      );
      const isSubmitClass = (
        b.classList.contains("mcq__submit") ||
        b.classList.contains("js-submit-btn") ||
        b.classList.contains("component__submit") ||
        b.classList.contains("button--primary")
      );
      return (isSubmitText || isSubmitClass) && !b.disabled;
    });

    if (submitBtn) return submitBtn;
  }
  return null;
}

function autoSubmitQuestion(mcqViewElement) {
  try {
    let submitBtn = null;
    if (mcqViewElement && mcqViewElement.shadowRoot) {
      const sr = mcqViewElement.shadowRoot;
      const baseView = sr.querySelector('base-view[type="component"]');
      const searchRoots = [sr, baseView && baseView.shadowRoot ? baseView.shadowRoot : null].filter(Boolean);
      for (const root of searchRoots) {
        const buttons = Array.from(root.querySelectorAll("button, input[type='button'], input[type='submit'], .button, mat-button"));
        submitBtn = buttons.find((b) => {
          const txt = (b.innerText || b.value || b.getAttribute("aria-label") || "").trim().toLowerCase();
          return (
            txt === "check" || txt === "submit" || txt === "check answer" || txt === "verifikasi" || txt === "kirim" ||
            txt.includes("submit") || txt.includes("check") ||
            b.classList.contains("mcq__submit") || b.classList.contains("js-submit-btn") || b.classList.contains("component__submit")
          ) && !b.disabled;
        });
        if (submitBtn) break;
      }
    }

    if (!submitBtn) {
      submitBtn = findSubmitButtonInRoots();
    }

    if (submitBtn && !submitBtn.disabled) {
      dispatchFullClickSequence(submitBtn);
      console.log("NetAcad AutoAnswer: Synchronously submitted question!");
      return true;
    }
  } catch (err) {
    console.error("NetAcad UI: Auto-submit error:", err);
  }
  return false;
}

function autoSubmitCurrentQuestion() {
  return autoSubmitQuestion(null);
}

function detectFinalSubmitPage() {
  const roots = [document, ...getShadowRoots(document)];
  for (const root of roots) {
    const text = (root.innerText || root.textContent || "").toLowerCase();
    if (text.includes("submit my assessment") || text.includes("yes, confirm my submission")) {
      return root;
    }
  }
  return null;
}

function confirmAndSubmitFinalAssessment() {
  try {
    const finalRoot = detectFinalSubmitPage();
    if (!finalRoot) return false;

    const checkboxes = Array.from(finalRoot.querySelectorAll("input[type='checkbox'], mat-checkbox"));
    checkboxes.forEach((cb) => {
      if (!cb.checked) {
        dispatchFullClickSequence(cb);
        cb.checked = true;
        cb.dispatchEvent(new Event("change", { bubbles: true }));
        cb.dispatchEvent(new Event("input", { bubbles: true }));
      }
    });

    const buttons = Array.from(finalRoot.querySelectorAll("button, input[type='submit'], .button, mat-button"));
    const finalSubmitBtn = buttons.find((b) => {
      const txt = (b.innerText || b.value || "").trim().toLowerCase();
      return txt === "submit" || txt === "submit assessment" || txt === "kirim" || b.classList.contains("button--primary");
    });

    if (finalSubmitBtn) {
      setTimeout(() => {
        dispatchFullClickSequence(finalSubmitBtn);
        console.debug("NetAcad AutoAnswer: Confirmed and submitted final assessment!");
      }, 300);
      return true;
    }
  } catch (err) {
    console.error("NetAcad UI: Final submission error:", err);
  }
  return false;
}

function clickQuestionTabByIndex(targetIndex) {
  try {
    const roots = [document, ...getShadowRoots(document)];
    for (const root of roots) {
      const buttons = Array.from(root.querySelectorAll("button, a, input[type='button'], .q-tab, .button, [role='tab'], .mat-tab-label, .page-item"));
      const qTabs = buttons.filter((b) => {
        const txt = (b.innerText || b.textContent || "").trim();
        const ariaLabel = (b.getAttribute("aria-label") || "").trim();
        const isQFormat = /^Q\d+$/i.test(txt) || /^\d+$/.test(txt) || /^Question\s+\d+$/i.test(txt) || /^Q\d+$/i.test(ariaLabel) || /^Question\s+\d+$/i.test(ariaLabel);
        return isQFormat || txt.toLowerCase() === "submit page";
      });

      if (qTabs.length > 0) {
        if (typeof targetIndex === "number" && targetIndex >= 0 && targetIndex < qTabs.length) {
          dispatchFullClickSequence(qTabs[targetIndex]);
          console.debug(`NetAcad AutoAnswer: Clicked Q-tab index ${targetIndex}: ${qTabs[targetIndex].innerText || qTabs[targetIndex].textContent}`);
          return true;
        }

        const activeIdx = qTabs.findIndex((b) =>
          b.classList.contains("active") ||
          b.classList.contains("selected") ||
          b.classList.contains("current") ||
          b.getAttribute("aria-selected") === "true" ||
          b.getAttribute("aria-current") === "page" ||
          b.getAttribute("aria-current") === "true" ||
          b.disabled
        );

        if (activeIdx !== -1 && activeIdx < qTabs.length - 1) {
          dispatchFullClickSequence(qTabs[activeIdx + 1]);
          console.debug(`NetAcad AutoAnswer: Advanced from active Q-tab index ${activeIdx} to ${activeIdx + 1}`);
          return true;
        } else if (activeIdx === -1 && qTabs.length > 0) {
          dispatchFullClickSequence(qTabs[0]);
          return true;
        }
      }

      const nextArrow = buttons.find((b) => {
        const text = (b.innerText || b.value || b.getAttribute("aria-label") || b.getAttribute("title") || "").trim().toLowerCase();
        return text === ">" || text === "next" || text === "next question" || b.classList.contains("nav-next") || b.classList.contains("next-btn");
      });

      if (nextArrow && !nextArrow.disabled) {
        dispatchFullClickSequence(nextArrow);
        console.debug("NetAcad AutoAnswer: Clicked next arrow button.");
        return true;
      }
    }
  } catch (err) {
    console.error("NetAcad UI: Error clicking question tab by index:", err);
  }
  return false;
}

function clickNextQuestionButton() {
  try {
    const roots = [document, ...getShadowRoots(document)];
    for (const root of roots) {
      const buttons = Array.from(root.querySelectorAll("button, a, input[type='button'], .button, mat-button"));
      const nextBtn = buttons.find((b) => {
        const text = (b.innerText || b.value || b.getAttribute("aria-label") || b.getAttribute("title") || "").trim().toLowerCase();
        return (
          text === ">" ||
          text === "next" ||
          text === "next question" ||
          text === "lanjut" ||
          text === "berikutnya" ||
          b.classList.contains("nav-next") ||
          b.classList.contains("next-btn") ||
          b.classList.contains("js-next-btn")
        );
      });

      if (nextBtn && !nextBtn.disabled) {
        dispatchFullClickSequence(nextBtn);
        console.debug("NetAcad AutoAnswer: Clicked Next question button.");
        return true;
      }
    }
  } catch (err) {
    console.error("NetAcad UI: Error clicking Next question button:", err);
  }
  return false;
}

function clickNextQuestionTab() {
  return clickNextQuestionButton();
}

function updateUiAndLogsPostExtraction(aiAnswerDisplay, questionText, answerTexts, index) {
  if (answerTexts.length === 0 && questionText !== "Question text not found" && !questionText.startsWith("Error:")) {
    aiAnswerDisplay.textContent = "Question found, but no answer options detected.";
  } else if (questionText.startsWith("Error:") || questionText === "Question text not found") {
    aiAnswerDisplay.textContent = questionText;
  }
}

function injectUi(uiContainer, questionTextElement, mcqViewElement, uiContainerId, index) {
  let uiInjected = false;
  if (questionTextElement && questionTextElement.parentNode) {
    try {
      const oldUi = questionTextElement.parentNode.querySelector(`#${uiContainerId}`);
      if (oldUi) oldUi.remove();
      questionTextElement.parentNode.insertBefore(uiContainer, questionTextElement.nextSibling);
      uiInjected = true;
    } catch (e) {
      console.warn(`NetAcad UI: Failed injection after questionTextElement for Q${index + 1}`);
    }
  }

  if (!uiInjected && mcqViewElement && mcqViewElement.shadowRoot) {
    const oldUi = mcqViewElement.shadowRoot.querySelector(`#${uiContainerId}`);
    if (oldUi) oldUi.remove();
    mcqViewElement.shadowRoot.appendChild(uiContainer);
    uiInjected = true;
  }
  return uiInjected;
}

async function handleRefreshAction(questionText, answerTexts, apiKey, aiAnswerDisplay, badge, mcqViewElement, index) {
  if (!aiAnswerDisplay) return;

  if (questionText === "Question text not found" || questionText.startsWith("Error:")) {
    aiAnswerDisplay.textContent = questionText;
    return;
  }

  aiAnswerDisplay.textContent = "Asking AI assistant...";
  badge.textContent = "Processing";
  badge.style.color = "#f59e0b";
  badge.style.borderColor = "rgba(245, 158, 11, 0.3)";

  const fetchFn = typeof getAiAnswer === "function" ? getAiAnswer : (window.getAiAnswer || globalThis.getAiAnswer);
  const rawAiResponse = await fetchFn(questionText, answerTexts, apiKey);

  if (rawAiResponse && !rawAiResponse.toLowerCase().startsWith("error:")) {
    badge.textContent = "Ready";
    badge.style.color = "#10b981";
    badge.style.borderColor = "rgba(16, 185, 129, 0.3)";

    const multiAnswerSeparator = " /// ";
    aiAnswerDisplay.textContent = "";
    if (rawAiResponse.includes(multiAnswerSeparator)) {
      const individualAnswers = rawAiResponse.split(multiAnswerSeparator).map((a) => a.trim()).filter(Boolean);
      aiAnswerDisplay.appendChild(buildAnswerNode("AI Suggestions:", individualAnswers));
    } else {
      aiAnswerDisplay.appendChild(buildAnswerNode("AI Suggestion:", [rawAiResponse]));
    }

    const stored = await chrome.storage.sync.get(["autoSelect", "autoSubmit"]);
    if (stored.autoSelect !== false) {
      await autoSelectOptionsInDom(mcqViewElement, rawAiResponse);
    }
    if (stored.autoSubmit === true) {
      autoSubmitQuestion(mcqViewElement);
    }
  } else {
    badge.textContent = "Error";
    badge.style.color = "#f87171";
    badge.style.borderColor = "rgba(248, 113, 113, 0.3)";
    aiAnswerDisplay.textContent = rawAiResponse || "Error: No response from AI provider.";
  }
}

async function processSingleQuestion(mcqViewElement, index, apiKey, preFetchedAiAnswer = null) {
  const uiContainerId = `netacad-ai-q-${index}`;

  if (mcqViewElement && mcqViewElement.shadowRoot) {
    const existingUi = mcqViewElement.shadowRoot.querySelector(`#${uiContainerId}`);
    if (existingUi) existingUi.remove();
  }

  const { uiContainer, aiAnswerDisplay, refreshButton, autoSelectButton, copyButton, badge } = createAiAssistantUI(uiContainerId, index);

  const isMatching = mcqViewElement && mcqViewElement.tagName && mcqViewElement.tagName.toLowerCase() === "object-matching-view";
  let questionText, answerElements, questionTextElement, answerTexts;

  if (isMatching) {
    const m = extractMatchingQuestion(mcqViewElement, index);
    questionText = m.questionText;
    questionTextElement = m.questionTextElement;
    answerTexts = [
      ...m.categories.map((c) => `[CATEGORY CIRCLE ${c.letter}] ${c.text}`),
      ...m.options.map((o, i) => `[OPTION ${i + 1}] ${o.text}`),
    ];
    answerElements = [];
    if (questionText && !questionText.startsWith("Error") && m.categories.length && m.options.length) {
      questionText = `MATCHING QUESTION. ${questionText}\nCategories: ${m.categories
        .map((c) => `Circle ${c.letter}=${c.text}`)
        .join(" | ")}\nOptions: ${m.options.map((o, i) => `${i + 1}=${o.text}`).join(" | ")}`;
    }
  } else {
    const ex = extractQuestionAndAnswers(mcqViewElement, index);
    questionText = ex.questionText;
    answerElements = ex.answerElements;
    questionTextElement = ex.questionTextElement;
    answerTexts = processAnswerElements(answerElements, index);
  }

  updateUiAndLogsPostExtraction(aiAnswerDisplay, questionText, answerTexts, index);
  injectUi(uiContainer, questionTextElement, mcqViewElement, uiContainerId, index);

  refreshButton.addEventListener("click", () =>
    handleRefreshAction(questionText, answerTexts, apiKey, aiAnswerDisplay, badge, mcqViewElement, index)
  );

  autoSelectButton.addEventListener("click", async () => {
    const currentText = aiAnswerDisplay.innerText || "";
    await autoSelectOptionsInDom(mcqViewElement, currentText);
  });

  copyButton.addEventListener("click", () => {
    const textToCopy = aiAnswerDisplay.innerText.replace("AI Suggestions:", "").replace("AI Suggestion:", "").trim();
    navigator.clipboard.writeText(textToCopy).then(() => {
      copyButton.textContent = "Copied!";
      setTimeout(() => (copyButton.textContent = "Copy"), 1500);
    });
  });

  if (preFetchedAiAnswer === "BATCH_PROCESSING_STARTED") {
    aiAnswerDisplay.textContent = "Batch processing... Please wait.";
    badge.textContent = "Batching";
    badge.style.color = "#38bdf8";
  } else if (preFetchedAiAnswer) {
    if (preFetchedAiAnswer.toLowerCase().startsWith("error:")) {
      badge.textContent = "Error";
      badge.style.color = "#f87171";
      badge.style.borderColor = "rgba(248, 113, 113, 0.3)";
      aiAnswerDisplay.textContent = preFetchedAiAnswer;
    } else {
      badge.textContent = "Ready";
      badge.style.color = "#10b981";
      badge.style.borderColor = "rgba(16, 185, 129, 0.3)";

      const multiAnswerSeparator = " /// ";
      aiAnswerDisplay.textContent = "";
      if (preFetchedAiAnswer.includes(multiAnswerSeparator)) {
        const individualAnswers = preFetchedAiAnswer.split(multiAnswerSeparator).map((a) => a.trim()).filter(Boolean);
        aiAnswerDisplay.appendChild(buildAnswerNode("AI Suggestions:", individualAnswers));
      } else {
        aiAnswerDisplay.appendChild(buildAnswerNode("AI Suggestion:", [preFetchedAiAnswer]));
      }

      const stored = await chrome.storage.sync.get(["autoSelect", "autoSubmit"]);
      const isAutoPilot = (typeof isAutonomousRunning !== "undefined" && isAutonomousRunning) ||
                          (typeof window !== "undefined" && window.isAutonomousRunning) ||
                          (typeof globalThis !== "undefined" && globalThis.isAutonomousRunning);
      const shouldAutoSelect = isAutoPilot || stored.autoSelect !== false;
      const shouldAutoSubmit = isAutoPilot || stored.autoSubmit === true;

      if (!isMatching && shouldAutoSelect) {
        await autoSelectOptionsInDom(mcqViewElement, preFetchedAiAnswer);
      }
      if (!isMatching && shouldAutoSubmit) {
        autoSubmitQuestion(mcqViewElement);
      }
    }
  } else {
    if (questionText !== "Question text not found" && !questionText.startsWith("Error:") && answerTexts.length > 0) {
      await handleRefreshAction(questionText, answerTexts, apiKey, aiAnswerDisplay, badge, mcqViewElement, index);
    }
  }
}

const exportsList = {
  createAiAssistantUI,
  extractQuestionAndAnswers,
  extractMatchingQuestion,
  processAnswerElements,
  dispatchFullClickSequence,
  findExactMatchingElements,
  processMatchingPairsSequentially,
  autoClickAllCheckButtonsOnPage,
  detectQuizOrCheckYourUnderstandingOnPage,
  autoCompleteVideosOnPage,
  autoScrollModulePage,
  parseThreeLevelCourseToC,
  navigateToFirstIncompleteLevel3Item,
  checkModuleCompletionStatus,
  navigateToFirstIncompleteModule,
  navigateToNextSubModule,
  autoSelectOptionsInDom,
  autoSubmitQuestion,
  autoSubmitCurrentQuestion,
  detectFinalSubmitPage,
  confirmAndSubmitFinalAssessment,
  clickQuestionTabByIndex,
  clickNextQuestionButton,
  clickNextQuestionTab,
  updateUiAndLogsPostExtraction,
  injectUi,
  handleRefreshAction,
  processSingleQuestion,
};

if (typeof window !== "undefined") {
  Object.assign(window, exportsList);
}

if (typeof globalThis !== "undefined") {
  Object.assign(globalThis, exportsList);
}