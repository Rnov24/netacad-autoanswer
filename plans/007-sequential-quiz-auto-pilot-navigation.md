# Plan 007: Enforce sequential question navigation and active-tab awareness in Quiz Auto-Pilot

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat ba71b0f..HEAD -- scraper.js ui.js`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: LOW
- **Depends on**: plans/001-fix-scrape-lock-and-retry.md, plans/003-decouple-stop-flags.md
- **Category**: bug
- **Planned at**: commit `ba71b0f`, 2026-07-22

## Why this matters

Currently, Quiz Auto-Pilot initializes an internal loop counter `activeTabIndex = 0` and forcibly calls `clickQuestionTabByIndex(activeTabIndex)` at each step. This causes three major issues:
1. If a student starts Auto-Pilot while on Question 4, `activeTabIndex` starts at 0 and increments to 1, causing the automation to jump backwards to Question 2 (`qTabs[1]`) instead of continuing from Question 4.
2. Question tab detection regex (`/^Q\d+$/i`) only matches tab elements with exact labels like "Q1" or "Q2". If NetAcad uses tabs labeled "1", "2", "Question 1", or ARIA tab elements, the selector fails to detect qTabs and falls through to clicking `nextArrow`, sometimes causing random skipping or non-sequential jumps.
3. On multi-question pages or when per-question submit buttons exist for all visible questions on a single page, the loop only submits the first found submit button before forcing a tab navigation call.

Fixing this ensures Quiz Auto-Pilot processes questions in strict sequential order from the user's current position to completion without random jumping.

## Current state

- `scraper.js:294-347`: `runAutonomousLoop()` initializes `let activeTabIndex = 0` and forces navigation via `clickQuestionTabByIndex(activeTabIndex)` after incrementing `activeTabIndex`:
  ```javascript
  let activeTabIndex = 0;
  const maxLoops = 45;

  while (isAutonomousRunning && activeTabIndex < maxLoops) {
    ...
    activeTabIndex++;
    const tabFn = resolveFn("clickQuestionTabByIndex");
    const moved = tabFn ? tabFn(activeTabIndex) : false;
    ...
  }
  ```
- `ui.js:834-886`: `clickQuestionTabByIndex(targetIndex)` receives `targetIndex` and directly dispatches click to `qTabs[targetIndex]`, ignoring active tab state when `targetIndex` is provided. The regex filter `^Q\d+$` is overly narrow:
  ```javascript
  const qTabs = buttons.filter((b) => {
    const txt = (b.innerText || "").trim();
    return /^Q\d+$/i.test(txt) || txt.toLowerCase() === "submit page";
  });
  if (qTabs.length > 0) {
    if (typeof targetIndex === "number" && targetIndex < qTabs.length) {
      dispatchFullClickSequence(qTabs[targetIndex]);
      return true;
    }
    ...
  }
  ```
- `ui.js:720-745`: `autoSubmitCurrentQuestion()` only finds the first submit button in search roots:
  ```javascript
  function autoSubmitCurrentQuestion() {
    const roots = [document, ...getShadowRoots(document)];
    for (const root of roots) {
      const buttons = Array.from(root.querySelectorAll("button, input[type='button'], input[type='submit'], .button, mat-button"));
      ...
    }
  }
  ```

## Commands you will need

| Purpose | Command | Expected on success |
|---------|---------|---------------------|
| Git status check | `git status --porcelain` | Clean workspace or expected modified files |
| Drift check | `git diff --stat ba71b0f..HEAD -- scraper.js ui.js` | Shows only expected diffs |

(No build step or npm test runner exists in this MV3 Chrome Extension codebase; manual verification via Chrome extension reload is required.)

## Scope

**In scope** (the only files you should modify):
- `scraper.js`
- `ui.js`

**Out of scope** (do NOT touch):
- `api.js`
- `content.js`
- `background.js`
- `popup.js`
- `popup.html`
- `manifest.json`

## Git workflow

- Branch: `advisor/007-sequential-quiz-navigation`
- Commit per step or per logical unit.
- Do NOT push or open a PR unless instructed.

## Steps

### Step 1: Expand Q-tab recognition and enhance active tab detection in `ui.js`

In `ui.js`, update `clickQuestionTabByIndex(targetIndex)`:
1. Expand the filter criteria for `qTabs` to recognize tabs labeled with:
   - `^Q\d+$` (e.g. "Q1", "Q2")
   - `^\d+$` (e.g. "1", "2", "3") when inside a pagination/tab container
   - `^Question \d+$` or `aria-label` starting with "Question " or "Q"
   - Elements with role `tab` or classes like `q-tab`, `question-tab`, `page-item`, `mat-tab-label`
2. Update active tab detection (`activeIdx`) to check:
   - `b.classList.contains("active")`
   - `b.classList.contains("selected")`
   - `b.getAttribute("aria-selected") === "true"`
   - `b.getAttribute("aria-current") === "page" || b.getAttribute("aria-current") === "true"`
   - `b.disabled` or `b.classList.contains("current")`
3. Expose an explicit function `clickNextQuestionTab()` that does sequential relative advancement (`activeIdx + 1`) instead of jumping to absolute index 0 or `targetIndex`.

**Verify**: Check syntactical validity by inspecting `ui.js` exports.

### Step 2: Refactor `runAutonomousLoop()` in `scraper.js` for sequential relative progression

In `scraper.js`, refactor `runAutonomousLoop()`:
1. Remove forcing `activeTabIndex = 0` as an absolute navigation target.
2. Change the tab navigation step to use relative sequential navigation:
   - First attempt `clickNextQuestionTab()` (or `clickQuestionTabByIndex()` without arguments so it detects active tab and clicks active + 1).
   - If relative navigation fails, fall back to checking if a "Next" / ">" arrow button exists.
   - Keep a loop safety counter `iterationCount` (max 45) to prevent infinite loops.
3. Ensure that if `clickNextQuestionTab()` returns `false` (no further tabs or next buttons available), check `detectFinalSubmitPage()` and finish cleanly without jumping back.

**Verify**: Code inspect `scraper.js` to ensure state flags (`isAutonomousRunning`, `isAutonomousPaused`) reset correctly in `finally` block and no backward jumps occur.

### Step 3: Handle multi-question page submission in `scraper.js` and `ui.js`

1. In `scraper.js` inside `runAutonomousLoop()`, after `scrapeData()` populates/selects answers for all `mcqViewElements`:
   - Iterate through each `mcqViewElement` found on the current view/page and invoke `autoSubmitQuestion(mcqViewElement)` so all questions on the current page are checked/submitted sequentially.
   - Follow with `autoSubmitCurrentQuestion()` as a fallback for standard submit buttons.

**Verify**: Confirm all `mcqViewElements` receive submit calls before tab navigation triggers.

## Test plan

- Test 1: Load unpacked extension in Chrome. Navigate to a NetAcad quiz page with multiple question tabs (e.g. Q1..Q10).
- Test 2: Manually click to Question 3. Start "Auto-Solve Quiz 🚀". Verify that the script answers Question 3, submits Q3, and moves sequentially to Question 4 (does NOT jump back to Question 1 or Question 2).
- Test 3: Test on a quiz page with "Next" arrow buttons instead of Q-tabs. Verify smooth 1 -> 2 -> 3 sequential progression.
- Test 4: Test on a multi-question quiz page (all questions on 1 page). Verify all questions are answered and submitted sequentially before final submission.

## Done criteria

Machine-checkable / verifiable criteria:
- [ ] No hardcoded absolute tab jumping (`activeTabIndex = 0` -> `clickQuestionTabByIndex(activeTabIndex)`) in `scraper.js`
- [ ] `clickQuestionTabByIndex` in `ui.js` correctly identifies active tab and advances to `activeIdx + 1`
- [ ] Quiz Auto-Pilot advances sequentially from whichever question tab is currently active
- [ ] `scraper.js` state flags reset in `finally` blocks
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report back if:
- NetAcad Quiz DOM structure uses an unsupported custom iframe or canvas renderer that hides tab elements.
- Code changes require introducing non-vanilla dependencies or build steps.

## Maintenance notes

- NetAcad frequently updates Angular component class names (`mat-tab`, `mcq-view`). Ensure selectors inspect both Shadow DOM trees and standard HTML elements using `getShadowRoots(document)`.
