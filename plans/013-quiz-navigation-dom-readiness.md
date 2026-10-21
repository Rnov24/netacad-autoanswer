# Plan 013: Harden quiz navigation — wait for DOM readiness before proceeding

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat bed4361..HEAD -- scraper.js ui.js`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: LOW — replaces fixed sleeps with polling; existing timeouts are generous fallbacks
- **Depends on**: none (can be executed before or after 012)
- **Category**: bug / correctness
- **Planned at**: commit `bed4361`, 2026-07-25

---

## Why this matters

The Quiz Auto-Pilot uses fixed-delay sleeps between steps:

- `await waitMs(300)` after answering (`scraper.js:335`)
- `await waitMs(650)` after clicking Next (`scraper.js:358`)
- A hardcoded `await waitMs(500)` when Next didn't move (`scraper.js:355`)

These durations are guesses. On slow networks or heavy pages the new question DOM hasn't rendered yet when `scrapeData()` is called again, causing the **same question to be scraped and answered twice** (wasting an API call) or causing `scrapeData` to find **zero questions** and retry up to 10 times. On fast local quiz caches the delay is unnecessary and slows the run.

Additionally, `clickNextQuestionButton` (`ui.js:1148`) finds the **first** button matching "next" across all shadow roots — it can accidentally click the course-level "Next Module" navigation button instead of the quiz "Next Question" button, advancing the user out of the quiz entirely.

---

## Current state

### Relevant files

- `scraper.js` — `runAutonomousLoop` (lines 302–366), `scrapeData` (lines 115–294)
- `ui.js` — `clickNextQuestionButton` (lines 1148–1177)

### Key excerpts

**`scraper.js:333–359` — fixed sleeps in the answer→submit→next loop**
```js
      // 2. Answer current question
      await scrapeData();
      await waitMs(300);   // <-- fixed; may be too short or too long

      if (!isAutonomousRunning) break;

      // 3. Re-verify submit page
      if (detectFn && detectFn()) { ... }

      // 4. Click Next
      loopIteration++;
      const nextBtnFn = resolveFn("clickNextQuestionButton") || resolveFn("clickNextQuestionTab");
      let moved = nextBtnFn ? nextBtnFn() : false;

      if (!moved) {
        ...
        await waitMs(500);  // <-- fixed
      } else {
        await waitMs(650);  // <-- fixed; doesn't wait for new DOM
      }
```

**`ui.js:1148–1177` — `clickNextQuestionButton` searches ALL roots, not scoped to quiz**
```js
function clickNextQuestionButton() {
  try {
    const roots = [document, ...getShadowRoots(document)];
    for (const root of roots) {
      const buttons = Array.from(root.querySelectorAll("button, a, input[type='button'], .button, mat-button"));
      const nextBtn = buttons.find((b) => {
        const text = (b.innerText || b.value || b.getAttribute("aria-label") || b.getAttribute("title") || "").trim().toLowerCase();
        return (
          text === ">" || text === "next" || text === "next question" || ...
        );
      });
      if (nextBtn && !nextBtn.disabled) {
        dispatchFullClickSequence(nextBtn);
        return true;   // returns on first match across ALL roots
      }
    }
```

---

## Commands you will need

| Purpose | Command | Expected on success |
|---------|---------|---------------------|
| Validate JS syntax | `node --check scraper.js && node --check ui.js` | exit 0, no output |

---

## Scope

**In scope**:
- `scraper.js` — `runAutonomousLoop` function
- `ui.js` — `clickNextQuestionButton` function

**Out of scope**:
- `api.js`, `content.js`, `background.js`, `popup.js`, `manifest.json`
- `runCourseScrollerLoop` — has its own timing logic; don't touch
- `waitMs` / `waitMsScroller` helpers — keep as-is; used for pause support

---

## Git workflow

- Branch: `advisor/013-navigation-dom-readiness`
- Commit message: `fix: replace fixed sleeps with DOM-readiness polling in quiz auto-pilot`
- Do NOT push or open a PR unless instructed.

---

## Steps

### Step 1: Add a DOM-readiness poll helper to `scraper.js`

Add this function immediately before `runAutonomousLoop` (before line 302), after the existing `waitMs`/`waitMsScroller` helpers:

```js
/**
 * Poll until a new mcq-view or object-matching-view appears whose question text
 * differs from `previousQuestionSnippet`, or until the final submit page appears,
 * or until `timeoutMs` elapses.
 *
 * Returns "new_question" | "final_submit" | "timeout".
 */
async function waitForNextQuestionOrFinalPage(previousQuestionSnippet, timeoutMs = 4000) {
  const step = 150;
  let elapsed = 0;
  const detectFinalFn = resolveFn("detectFinalSubmitPage");

  while (elapsed < timeoutMs) {
    if (!isAutonomousRunning) return "stopped";

    // Check for final submit page first
    if (detectFinalFn && detectFinalFn()) return "final_submit";

    // Look for any mcq-view with a different question text
    try {
      const appRoot = document.querySelector("app-root");
      if (appRoot && appRoot.shadowRoot) {
        const pageView = appRoot.shadowRoot.querySelector("page-view");
        if (pageView && pageView.shadowRoot) {
          const articleViews = pageView.shadowRoot.querySelectorAll("article-view");
          for (const av of articleViews) {
            if (!av.shadowRoot) continue;
            for (const bv of av.shadowRoot.querySelectorAll("block-view")) {
              if (!bv.shadowRoot) continue;
              const mcq = bv.shadowRoot.querySelector("mcq-view, object-matching-view");
              if (!mcq || !mcq.shadowRoot) continue;
              // Check that this question text looks different from what we just answered
              const questionEl = mcq.shadowRoot.querySelector(
                "div.component__body-inner.mcq__body-inner, div.component__body, .mcq__prompt, .prompt"
              );
              const currentSnippet = (questionEl ? questionEl.innerText : "").trim().slice(0, 80);
              if (currentSnippet && currentSnippet !== previousQuestionSnippet) {
                return "new_question";
              }
            }
          }
        }
      }
    } catch (_) {}

    await new Promise((r) => setTimeout(r, step));
    elapsed += step;
  }

  return "timeout";
}
```

**Verify**: `node --check scraper.js` → exit 0

### Step 2: Capture the current question snippet before clicking Next

In `runAutonomousLoop`, before `scrapeData()` is called (line 334), capture the current question text snippet so the poll helper can detect when the DOM has changed.

Replace the block at lines 333–359:

```js
      // Capture current question snippet for DOM-readiness check later
      let currentQuestionSnippet = "";
      try {
        const appRoot = document.querySelector("app-root");
        if (appRoot && appRoot.shadowRoot) {
          const pageView = appRoot.shadowRoot.querySelector("page-view");
          if (pageView && pageView.shadowRoot) {
            const firstMcq = pageView.shadowRoot.querySelector("article-view");
            if (firstMcq && firstMcq.shadowRoot) {
              const firstBv = firstMcq.shadowRoot.querySelector("block-view");
              if (firstBv && firstBv.shadowRoot) {
                const mcq = firstBv.shadowRoot.querySelector("mcq-view, object-matching-view");
                if (mcq && mcq.shadowRoot) {
                  const qEl = mcq.shadowRoot.querySelector(
                    "div.component__body-inner.mcq__body-inner, div.component__body, .mcq__prompt, .prompt"
                  );
                  currentQuestionSnippet = (qEl ? qEl.innerText : "").trim().slice(0, 80);
                }
              }
            }
          }
        }
      } catch (_) {}

      // 2. Answer current question
      await scrapeData();
      await waitMs(200);  // brief settled-state wait after auto-select + submit

      if (!isAutonomousRunning) break;

      // 3. Re-verify submit page
      if (detectFn && detectFn()) {
        if (confirmFn) confirmFn();
        break;
      }

      // 4. Click Next Question Navigation Button
      loopIteration++;
      const nextBtnFn = resolveFn("clickNextQuestionButton") || resolveFn("clickNextQuestionTab");
      let moved = nextBtnFn ? nextBtnFn() : false;

      if (!moved) {
        if (detectFn && detectFn()) {
          if (confirmFn) confirmFn();
          break;
        }
        // Nothing to click — poll briefly before retrying
        const readiness = await waitForNextQuestionOrFinalPage(currentQuestionSnippet, 2000);
        if (readiness === "final_submit" && confirmFn) { confirmFn(); break; }
      } else {
        // Clicked Next — wait until new question DOM appears (up to 4s)
        const readiness = await waitForNextQuestionOrFinalPage(currentQuestionSnippet, 4000);
        if (readiness === "final_submit" && confirmFn) { confirmFn(); break; }
        // readiness === "timeout" is fine — scrapeData will retry on its own
      }
```

**Verify**: `node --check scraper.js` → exit 0

### Step 3: Scope `clickNextQuestionButton` to quiz-internal buttons only

In `ui.js`, replace `clickNextQuestionButton` (lines 1148–1177) with a version that prefers buttons inside `mcq-view` shadow roots and only falls back to document-level if nothing is found there:

```js
function clickNextQuestionButton() {
  try {
    // Prefer next buttons that live inside the quiz component shadow DOM
    // to avoid accidentally clicking the course-level "Next Module" link.
    const quizRoots = [];
    try {
      const appRoot = document.querySelector("app-root");
      if (appRoot && appRoot.shadowRoot) {
        const pageView = appRoot.shadowRoot.querySelector("page-view");
        if (pageView && pageView.shadowRoot) {
          pageView.shadowRoot.querySelectorAll("article-view").forEach((av) => {
            if (av.shadowRoot) quizRoots.push(av.shadowRoot);
            av.shadowRoot && av.shadowRoot.querySelectorAll("block-view").forEach((bv) => {
              if (bv.shadowRoot) quizRoots.push(bv.shadowRoot);
              bv.shadowRoot && bv.shadowRoot.querySelectorAll("mcq-view, object-matching-view").forEach((mqv) => {
                if (mqv.shadowRoot) quizRoots.push(mqv.shadowRoot);
                const base = mqv.shadowRoot.querySelector('base-view[type="component"]');
                if (base && base.shadowRoot) quizRoots.push(base.shadowRoot);
              });
            });
          });
        }
      }
    } catch (_) {}

    // Also search document-level as fallback (keeps existing behaviour for edge cases)
    const allRoots = quizRoots.length > 0
      ? [...quizRoots, document, ...getShadowRoots(document)]
      : [document, ...getShadowRoots(document)];

    // De-duplicate roots
    const seenRoots = new Set();
    const dedupedRoots = allRoots.filter((r) => {
      if (seenRoots.has(r)) return false;
      seenRoots.add(r);
      return true;
    });

    for (const root of dedupedRoots) {
      const buttons = Array.from(root.querySelectorAll(
        "button, a, input[type='button'], .button, mat-button"
      ));
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
```

**Verify**: `node --check ui.js` → exit 0

---

## Test plan

Manual verification on a NetAcad quiz with ≥3 questions:

1. Run "Auto-Solve Quiz 🚀". Watch the console. Verify each question appears with a different question text before auto-select fires (not the same question twice).
2. On a quiz that has a slow network (throttle via DevTools → Network → Slow 3G), verify the pilot does not skip questions and does not attempt to navigate past the last question before submit appears.
3. Verify the auto-pilot does not accidentally navigate to a different module page during a quiz.

---

## Done criteria

- [ ] `node --check scraper.js` exits 0
- [ ] `node --check ui.js` exits 0
- [ ] `waitForNextQuestionOrFinalPage` helper is in `scraper.js`, before `runAutonomousLoop`
- [ ] Fixed sleeps of 650ms and 500ms in `runAutonomousLoop` are replaced with DOM-readiness polling
- [ ] `clickNextQuestionButton` prefers quiz-internal shadow roots over document root
- [ ] No files outside the in-scope list are modified (`git status`)
- [ ] `plans/README.md` status row updated

---

## STOP conditions

- The code at the locations in "Current state" doesn't match the excerpts.
- A step's verification fails twice after a reasonable fix attempt.
- The DOM traversal for quiz roots raises unexpected errors (different NetAcad page structure). Log the error and report back.
- The `waitForNextQuestionOrFinalPage` poll never returns `new_question` on a working quiz page — this indicates the question text selector is wrong; report back with the actual selector in the DOM.

---

## Maintenance notes

- `waitForNextQuestionOrFinalPage` uses the same shadow DOM traversal path as `scrapeData`. If NetAcad changes its shadow DOM hierarchy, both will break together — a single fix location.
- The 4-second timeout for DOM readiness is generous. If NetAcad introduces very slow quiz transitions, increase the timeout in `waitForNextQuestionOrFinalPage`'s call in `runAutonomousLoop`.
- The quiz-root priority in `clickNextQuestionButton` depends on `mcq-view` being present; if a question type other than MCQ / object-matching is ever shown (e.g. `fill-blank-view`), its shadow root won't be in `quizRoots` and the fallback document search will handle it.
