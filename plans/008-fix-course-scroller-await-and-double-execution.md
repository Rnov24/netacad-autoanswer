# Plan 008: Fix unawaited recordPageData and eliminate double video/button sweep

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat d395c7c..HEAD -- scraper.js ui.js`
> If either file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Status**: DONE
- **Priority**: P1
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: bug
- **Planned at**: commit `d395c7c`, 2026-07-23

## Why this matters

Two independent correctness bugs fire on every Course Scroller loop iteration:

1. **Unawaited `recordPageData()`** — `recordPageData` is `async` (it calls `chrome.storage.local.get` and `.set`). The call at `scraper.js:381` omits `await`, so the `chrome.storage.local.set` write may run *after* the scroller has already navigated away to the next section, recording stale or empty page data. On fast machines the race is common; on slow connections the data is almost always wrong.

2. **Double video/check-button sweep** — `runCourseScrollerLoop` explicitly calls `autoCompleteVideosOnPage()` (line 374–375) and `autoClickAllCheckButtonsOnPage()` (line 377–378) at the start of each iteration, then immediately calls `await scrollFn()` where `scrollFn` is `autoScrollModulePage`. `autoScrollModulePage` (ui.js:618–620) unconditionally calls both functions again. Every iteration therefore fires each sweep function twice: videos are fast-forwarded twice, and every interactive button on the page receives two full click sequences via `dispatchFullClickSequence`. This can confuse NetAcad's Angular components which may toggle state on each click (e.g. flip-cards flip back).

## Current state

**File**: `scraper.js`

```
// scraper.js:373–396 (runCourseScrollerLoop, inner loop body)
      // 1. Cohesive Sweep: Fast-forward videos + click interactive check/flipcard buttons
      const videoFn = resolveFn("autoCompleteVideosOnPage");
      if (videoFn) videoFn();

      const checkBtnFn = resolveFn("autoClickAllCheckButtonsOnPage");
      if (checkBtnFn) checkBtnFn();

      // Record page data into local storage database
      recordPageData();    // ← BUG 1: missing await

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
      if (scrollFn) await scrollFn();   // ← calls video/button sweep again (BUG 2)
```

**File**: `ui.js`

```
// ui.js:615–633 (autoScrollModulePage)
async function autoScrollModulePage() {
  console.debug("NetAcad AutoAnswer: Starting module smooth auto-scroll...");

  // 1. One-pass fast video & interactive check button sweep   ← BUG 2: already done in loop
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
```

**Repo convention**: All other `async` functions in this file that write to `chrome.storage` use `await` (e.g. `recordPageData` itself at line 560–568, `exportScrapedCourseData` at lines 559–568). Match that pattern.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Syntax check | Open Chrome → `chrome://extensions` → "Load unpacked" → check for errors | No errors shown |
| Manual test | Open a NetAcad course, run Course Scroller, check console | No double-execution log lines (each "Clicked interactive check/flipcard button" and "Video completion triggered" appears once per section) |

## Scope

**In scope** (the only files you should modify):
- `scraper.js` — add `await` to `recordPageData()` call at line 381
- `ui.js` — remove the duplicate `autoCompleteVideosOnPage()` and `autoClickAllCheckButtonsOnPage()` calls from `autoScrollModulePage` (lines 619–620)

**Out of scope** (do NOT touch):
- The `recordPageData` function body itself — only the call site
- `autoCompleteVideosOnPage` and `autoClickAllCheckButtonsOnPage` function bodies
- Any other loop logic in `runCourseScrollerLoop`

## Git workflow

- Branch: `advisor/008-fix-course-scroller-await-and-double-exec`
- Commit message style: `fix: await recordPageData and remove double video/btn sweep in Course Scroller`

## Steps

### Step 1: Add `await` to the `recordPageData()` call in `scraper.js`

Open `scraper.js`. Go to line 381. The line currently reads:

```js
      recordPageData();
```

Change it to:

```js
      await recordPageData();
```

The surrounding context (lines 373–396) should now read:

```js
      // 1. Cohesive Sweep: Fast-forward videos + click interactive check/flipcard buttons
      const videoFn = resolveFn("autoCompleteVideosOnPage");
      if (videoFn) videoFn();

      const checkBtnFn = resolveFn("autoClickAllCheckButtonsOnPage");
      if (checkBtnFn) checkBtnFn();

      // Record page data into local storage database
      await recordPageData();

      // 2. Auto-Solve any "Check Your Understanding" / Quiz widgets on page
```

**Verify**: Search the file for `recordPageData();` (without `await`). The result must be zero matches in the loop body — only the function declaration `async function recordPageData()` should appear. Run:
```
grep -n "recordPageData();" scraper.js
```
Expected: no output (the bare call no longer exists).

### Step 2: Remove the duplicate sweep calls from `autoScrollModulePage` in `ui.js`

Open `ui.js`. Go to lines 615–633. Remove lines 618–620 (the comment and two function calls inside `autoScrollModulePage`). The function should look like this after the edit:

```js
async function autoScrollModulePage() {
  console.debug("NetAcad AutoAnswer: Starting module smooth auto-scroll...");

  // Fast fluid scroll to page bottom to hit 100% reading completion trackers
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
```

**Verify**: Confirm `autoScrollModulePage` no longer contains `autoCompleteVideosOnPage` or `autoClickAllCheckButtonsOnPage`:
```
grep -n "autoCompleteVideosOnPage\|autoClickAllCheckButtonsOnPage" ui.js
```
Expected: these names appear only in their function declarations (lines ~521, ~585) and the export block (line ~1335–1338), not inside `autoScrollModulePage`.

### Step 3: Reload extension and smoke-test

1. Open Chrome → `chrome://extensions` → click "Reload" on the NetAcad AutoAnswer extension.
2. Navigate to a NetAcad course page with at least one video and one flipcard/check button.
3. Open DevTools → Console.
4. Click "Auto-Scroll & Complete Module" in the extension popup.
5. Observe logs: each "Clicked interactive check/flipcard button" and "Video completion triggered" log line should appear **once** per section, not twice.
6. After the scroller finishes, open `chrome://extensions` → "Inspect views: background page" → Application tab → Storage → `scrapedCourseDb`. Entries should contain page data from each visited section.

**Verify**: Console does NOT show two sequential "Video completion triggered" messages for the same video within one loop iteration.

## Test plan

No automated test infrastructure exists for this repo (noted in `plans/README.md` as a prerequisite gap). Manual verification via the smoke-test in Step 3 is the verification gate. The key observable: check/video actions appear once per section, and `scrapedCourseDb` entries in `chrome.storage.local` contain non-empty `paragraphs` arrays.

## Done criteria

- [ ] `grep -n "recordPageData();" scraper.js` returns no matches (only the `async function recordPageData()` declaration remains)
- [ ] `grep -n "autoCompleteVideosOnPage\|autoClickAllCheckButtonsOnPage" ui.js` shows no matches inside `autoScrollModulePage` body
- [ ] Extension reloads without errors in `chrome://extensions`
- [ ] Manual smoke-test: each per-section action fires once (not twice)
- [ ] `plans/README.md` status row updated to DONE

## STOP conditions

- The code at the locations in "Current state" doesn't match the excerpts (codebase has drifted since plan was written) — check `git diff d395c7c..HEAD -- scraper.js ui.js`
- A step's verification fails after one fix attempt — report back with the actual diff
- Removing lines 619–620 from `autoScrollModulePage` causes the function to call some other sweep path that isn't covered by the loop — check `runCourseScrollerLoop` still calls both functions before invoking `scrollFn`

## Maintenance notes

- If `autoScrollModulePage` is ever called from a context *other than* `runCourseScrollerLoop` (e.g. a standalone "Scroll this page" button), the video/button sweep should be re-added to it or the calling context must call them explicitly first.
- Any new `async` function added to the loop body must be called with `await`; the pattern throughout the codebase is consistent — don't regress it.
