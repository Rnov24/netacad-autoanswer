# Plan 011: Handle multi-question CYU pages and add scroller progress reporting

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat d395c7c..HEAD -- scraper.js content.js ui.js`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Status**: DONE
- **Priority**: P2
- **Effort**: M
- **Risk**: MED
- **Depends on**: 008 (await recordPageData), 010 (pause/waitMsScroller)
- **Category**: bug + direction
- **Planned at**: commit `d395c7c`, 2026-07-23

## Why this matters

**Multi-question CYU pages** — NetAcad "Check Your Understanding" (CYU) sections often contain 3–6 sequential questions on a single page, each requiring: answer → submit/check → view result → next question. The current Course Scroller calls `scrapeFn()` once and then `autoSubmitQuestion()` once, which handles at most the first question. The remaining 2–5 questions on the page remain unanswered before the scroller navigates away. This is the single biggest reason courses don't reach 100% completion.

The correct approach: when a quiz is detected on the current page, delegate to a bounded version of the Quiz Auto-Pilot loop (which already handles the Answer → Submit → Next sequence correctly) before continuing with the ToC navigation.

**Scroller progress reporting** — The popup displays "Course Scroller Active" with no indication of how many sections have been processed or remain. Adding a progress counter (`completedSections / totalSections`) to:
- The `getStatus` message response (content.js)
- The running banner text on the page (updated each iteration)
- The floating button tooltip

...gives users visibility into whether the scroller is making progress or stuck.

## Current state

**File**: `scraper.js`

```js
// scraper.js:383–392 (quiz handling inside runCourseScrollerLoop)
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
```

**File**: `content.js`

```js
// content.js:342–348 (getStatus response — no progress data)
  if (request.action === "getStatus") {
    const isAutoRunning = !!(window.isAutonomousRunning || globalThis.isAutonomousRunning);
    const isScrollRunning = !!(window.isCourseScrollerRunning || globalThis.isCourseScrollerRunning);
    const isPaused = !!(window.isAutonomousPaused || globalThis.isAutonomousPaused);
    sendResponse({ isAutoRunning, isScrollRunning, isPaused });
    return true;
  }
```

```js
// content.js:255–263 (running banner — static text)
    if (isAutoRunning || isScrollRunning) {
      banner.style.display = "flex";
      banner.innerHTML = `<span class="netacad-running-dot"></span> ${
        isAutoRunning ? "⚡ Quiz Auto-Pilot is Running... Please do not switch or close this tab!" : "📜 Course Scroller is Running... Please do not switch or close this tab!"
      }`;
```

Note: `banner.innerHTML` is used here for the dot spinner — this is a pre-existing XSS-safe pattern since the content is a static template literal with no user input. The running dot `<span>` is hardcoded. Do not change the innerHTML pattern; it is intentional.

**Quiz Auto-Pilot loop** (`runAutonomousLoop`, `scraper.js:286–350`): already handles the Answer → Submit → Next sequence correctly using `clickNextQuestionButton` / `detectFinalSubmitPage`. We can call it from the scroller after detecting a quiz page. But calling the full `runAutonomousLoop` sets `isAutonomousRunning = true`, which would conflict with scroller state UI. 

**Better approach**: inline a bounded quiz iteration directly in the scroller's quiz block (max 10 questions per page) using the existing helper functions `scrapeData`, `clickNextQuestionButton`, and `detectFinalSubmitPage`.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Syntax check | Load unpacked → `chrome://extensions` | No error |
| Multi-Q test | Open CYU page with 4 questions, run scroller | All 4 questions answered before navigation |
| Progress test | Open popup during scroller run | Shows e.g. "Course Scroller: 3/42 sections" |

## Scope

**In scope**:
- `scraper.js` — replace single-shot quiz block with bounded iteration loop; add progress counter state variables
- `content.js` — update `getStatus` to include progress; update running banner to show progress

**Out of scope** (do NOT touch):
- `ui.js` — no changes
- `popup.js` — the existing `pollTabStatus` function already polls `getStatus`; the new `scrollProgress` field will display automatically if popup.js renders it. Check `popup.js` before starting — if it renders `scrollProgress`, no change needed; if not, note it in a comment but do not modify popup.js (it is out of scope for this plan)
- `runAutonomousLoop` — do not modify; implement the bounded quiz loop inline in the scroller

## Git workflow

- Branch: `advisor/011-scroller-multi-question-and-progress`
- Commit message: `feat: handle multi-question CYU pages and add scroller progress reporting`

## Steps

### Step 1: Add scroller progress state variables to `scraper.js`

After the existing state flags (lines 26–30 in `scraper.js`), add two module-level state variables:

```js
let scrollerCurrentSection = 0;   // current section index being processed
let scrollerTotalSections = 0;    // total sections discovered from ToC
```

These will be updated during the loop and read by `content.js` for progress reporting.

**Verify**: `grep -n "scrollerCurrentSection\|scrollerTotalSections" scraper.js` — two matches at the declarations.

### Step 2: Populate progress state in `runCourseScrollerLoop`

Inside `runCourseScrollerLoop`, before the while loop begins, add a ToC query to get the total section count:

```js
  // Discover total sections for progress reporting
  const tocFn = resolveFn("parseThreeLevelCourseToC");
  if (tocFn) {
    const { allSubTopics } = tocFn();
    scrollerTotalSections = allSubTopics.length;
  }
  scrollerCurrentSection = 0;
```

At the top of each loop iteration (after the pause check, before section processing), update the current section:

```js
      scrollerCurrentSection = iterations + 1;
```

At the end of the loop (in the `finally` block), reset both counters:

```js
  } finally {
    isCourseScrollerRunning = false;
    scrollerCurrentSection = 0;
    scrollerTotalSections = 0;
    console.log("NetAcad AutoAnswer: Course Scroller finished.");
  }
```

Export the new variables alongside the existing exports at the bottom of `scraper.js` (in the `scraperExports` object):

```js
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
  // Progress state (read-only from outside — content.js uses these for getStatus)
  get scrollerCurrentSection() { return scrollerCurrentSection; },
  get scrollerTotalSections()  { return scrollerTotalSections;  },
};
```

Note: Using property getters ensures `window.scrollerCurrentSection` always returns the live value, not a snapshot copy.

**Verify**: `grep -n "scrollerCurrentSection" scraper.js` shows at minimum 4 matches: declaration, loop update, finally reset, and export getter.

### Step 3: Replace single-shot quiz block with bounded multi-question loop

Find the quiz handling block in `runCourseScrollerLoop` (current lines ~383–392):

```js
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
```

Replace it with:

```js
      // 2. Auto-Solve any "Check Your Understanding" / Quiz widgets on page
      // Handles multi-question pages (up to 10 questions per page)
      const hasQuizFn = resolveFn("detectQuizOrCheckYourUnderstandingOnPage");
      const scrapeFn = resolveFn("scrapeData");
      const detectFinalFn = resolveFn("detectFinalSubmitPage");
      const nextBtnFn = resolveFn("clickNextQuestionButton") || resolveFn("clickNextQuestionTab");

      if (hasQuizFn && hasQuizFn() && scrapeFn) {
        const MAX_QUESTIONS_PER_PAGE = 10;
        let qStep = 0;
        while (isCourseScrollerRunning && qStep < MAX_QUESTIONS_PER_PAGE) {
          // Stop if we hit the final assessment submit page (should not happen in CYU, but guard)
          if (detectFinalFn && detectFinalFn()) break;

          await scrapeFn();          // answer + auto-select current question
          await waitMsScroller(300); // allow selection to register

          if (!isCourseScrollerRunning) break;

          // Try to advance to next question on this page
          const moved = nextBtnFn ? nextBtnFn() : false;
          if (!moved) {
            // No more questions on this page
            break;
          }
          await waitMsScroller(650); // wait for next question to render
          qStep++;

          // Re-check if we still have a quiz — exit if navigated to a different section
          if (!hasQuizFn || !hasQuizFn()) break;
        }
        console.debug(`NetAcad AutoAnswer: Course Scroller — processed ${qStep + 1} question(s) on CYU page.`);
      }
```

Key design decisions:
- `MAX_QUESTIONS_PER_PAGE = 10` prevents infinite loops if navigation logic misbehaves
- The loop reads `isCourseScrollerRunning` at each step so Stop still works
- Uses `waitMsScroller` (from plan 010) for pause-aware delays
- `nextBtnFn` is the same function used by `runAutonomousLoop` — if it returns `false`, there are no more questions on this page

**STOP condition for this step**: If `waitMsScroller` is not available (plan 010 not yet executed), substitute `await new Promise(r => setTimeout(r, 300))` and `await new Promise(r => setTimeout(r, 650))` as temporary replacements, and note this in your report.

**Verify**: `grep -n "MAX_QUESTIONS_PER_PAGE\|qStep" scraper.js` — both appear inside the updated quiz block.

### Step 4: Update `getStatus` response in `content.js` to include progress

Find the `getStatus` handler in `content.js` (lines ~342–348):

```js
  if (request.action === "getStatus") {
    const isAutoRunning = !!(window.isAutonomousRunning || globalThis.isAutonomousRunning);
    const isScrollRunning = !!(window.isCourseScrollerRunning || globalThis.isCourseScrollerRunning);
    const isPaused = !!(window.isAutonomousPaused || globalThis.isAutonomousPaused);
    sendResponse({ isAutoRunning, isScrollRunning, isPaused });
    return true;
  }
```

Replace with:

```js
  if (request.action === "getStatus") {
    const isAutoRunning = !!(window.isAutonomousRunning || globalThis.isAutonomousRunning);
    const isScrollRunning = !!(window.isCourseScrollerRunning || globalThis.isCourseScrollerRunning);
    const isPaused = !!(window.isAutonomousPaused || globalThis.isAutonomousPaused);
    const scrollCurrent = (window.scrollerCurrentSection || globalThis.scrollerCurrentSection) || 0;
    const scrollTotal   = (window.scrollerTotalSections  || globalThis.scrollerTotalSections)  || 0;
    sendResponse({ isAutoRunning, isScrollRunning, isPaused, scrollCurrent, scrollTotal });
    return true;
  }
```

**Verify**: `grep -n "scrollCurrent\|scrollTotal" content.js` — both appear in the `getStatus` block.

### Step 5: Update the running banner to show scroller progress

Find the running banner update block in `content.js` (lines ~253–263). The current scroller text is a static string. Replace just the scroller text with a dynamic version that reads from `window.scrollerCurrentSection` and `window.scrollerTotalSections`:

```js
    if (isAutoRunning || isScrollRunning) {
      banner.style.display = "flex";
      let bannerText;
      if (isAutoRunning) {
        bannerText = "⚡ Quiz Auto-Pilot is Running... Please do not switch or close this tab!";
      } else {
        const cur = window.scrollerCurrentSection || globalThis.scrollerCurrentSection || 0;
        const tot = window.scrollerTotalSections  || globalThis.scrollerTotalSections  || 0;
        const progressStr = (cur > 0 && tot > 0) ? ` (${cur}/${tot})` : "";
        bannerText = `📜 Course Scroller is Running${progressStr}... Please do not switch or close this tab!`;
      }
      banner.innerHTML = `<span class="netacad-running-dot"></span> ${bannerText}`;
    } else {
      banner.style.display = "none";
    }
```

Note: `banner.innerHTML` is used intentionally here (pre-existing pattern) with a static template literal — `cur` and `tot` are integers, no user-controlled strings.

**Verify**: `grep -n "scrollerCurrentSection" content.js` — appears in at least 2 places (getStatus block and banner update).

### Step 6: Reload and smoke-test

1. Reload extension.
2. Open a NetAcad CYU page with multiple questions (look for "Check Your Understanding" section with 3+ questions).
3. Run the Course Scroller.
4. Observe: all questions on the CYU page are answered and advanced before the scroller navigates to the next ToC section.
5. Observe the running banner: it should show e.g. `📜 Course Scroller is Running (3/42)...`.
6. Open the popup during scroller run — verify `getStatus` now includes `scrollCurrent` and `scrollTotal` (check DevTools → Network or inspect popup.js's `pollTabStatus` logs).

## Test plan

Manual verification. Key observables:
- On a 4-question CYU page: scroller answers all 4 before advancing
- Banner shows current/total section count while running
- After all sections complete: banner disappears, progress resets to 0/0

## Done criteria

- [ ] `grep -n "MAX_QUESTIONS_PER_PAGE" scraper.js` — one match
- [ ] `grep -n "scrollerCurrentSection\|scrollerTotalSections" scraper.js` — ≥4 matches each
- [ ] `grep -n "scrollCurrent\|scrollTotal" content.js` — ≥2 matches
- [ ] Extension reloads without errors
- [ ] Manual CYU test: all questions answered per page before navigation
- [ ] Manual banner test: progress count visible in running banner
- [ ] `plans/README.md` status row updated to DONE

## STOP conditions

- Drift detected in any in-scope file since SHA `d395c7c`
- `waitMsScroller` is not yet available (plan 010 not executed) — use raw `setTimeout` as documented in Step 3 and note in report
- `clickNextQuestionButton` / `clickNextQuestionTab` functions not found via `resolveFn` — this means plan 007 may not have been executed; check `ui.js` exports for these function names before proceeding
- The multi-question loop runs more than `MAX_QUESTIONS_PER_PAGE` iterations — add a console.error and break

## Maintenance notes

- `MAX_QUESTIONS_PER_PAGE = 10` is a safe upper bound. If a NetAcad module ever has more than 10 sequential CYU questions, increase this constant.
- The progress state variables (`scrollerCurrentSection`, `scrollerTotalSections`) are module-level. If the course scroller is restarted without page reload, they reset correctly in the `finally` block.
- If popup.js's `pollTabStatus` is extended to display `scrollCurrent`/`scrollTotal`, update the popup UI markup in `popup.html` to include a progress readout element.
