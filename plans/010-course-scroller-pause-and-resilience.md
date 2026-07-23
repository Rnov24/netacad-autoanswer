# Plan 010: Add pause/resume support and inner-loop resilience to Course Scroller

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat d395c7c..HEAD -- scraper.js content.js`
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

The Course Scroller (`runCourseScrollerLoop`) has no pause/resume support and no resilience against transient per-section errors. These are independent problems with concrete user-facing consequences:

**No pause/resume**: The Quiz Auto-Pilot (`runAutonomousLoop`) supports pausing via `isAutonomousPaused` checked inside `waitMs`. The popup's "Pause ⏸" button calls `toggleAutoPilotPause` which toggles `isAutonomousPaused`. But `runCourseScrollerLoop` never reads `isAutonomousPaused`, so the Pause button does nothing when the scroller is active. Users must click "Stop" — which cancels the entire session — with no way to temporarily pause and resume.

**No inner-loop resilience**: The `while` loop in `runCourseScrollerLoop` has no `try-catch` around per-section operations. A single transient error (e.g. a shadow DOM element becoming detached mid-traversal during `await scrapeFn()`, or a temporary extension context invalidation) throws out of the loop body, which is caught by the outer `try-catch`, sets `isCourseScrollerRunning = false`, and terminates the entire run. One bad section kills the rest of the course.

**maxSubTopics cap too low**: `const maxSubTopics = 250` silently stops the scroller on courses with more than 250 sub-topics (full CCNA, CyberOps, etc.). Raising it to a more realistic limit prevents silent truncation.

## Current state

**File**: `scraper.js`

```js
// scraper.js:26-30 (state flags)
let isAutonomousRunning = false;
let isAutonomousPaused = false;
let isScrapeInFlight = false;
let isCourseScrollerRunning = false;
```

```js
// scraper.js:53-65 (waitMs — checks pause state; used in runAutonomousLoop only)
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
```

```js
// scraper.js:355–422 (runCourseScrollerLoop — no pause check, no inner try-catch)
async function runCourseScrollerLoop() {
  if (isCourseScrollerRunning) { ... return; }
  isCourseScrollerRunning = true;
  ...
  const maxSubTopics = 250;     // ← too low
  let iterations = 0;

  try {
    while (isCourseScrollerRunning && iterations < maxSubTopics) {
      if (!isCourseScrollerRunning) break;   // ← redundant check, no pause check

      // ... per-section steps, NO inner try-catch ...

      await new Promise((r) => setTimeout(r, 1200));  // ← doesn't check pause/stop
      iterations++;
    }
  } finally {
    isCourseScrollerRunning = false;
    ...
  }
}
```

**Pause/resume control functions** (already exist, used by Quiz Auto-Pilot):
- `pauseAutonomousLoop()` — sets `isAutonomousPaused = true`
- `resumeAutonomousLoop()` — sets `isAutonomousPaused = false`
- `toggleAutonomousPause()` — toggles the flag

**`waitMs` assumption**: `waitMs` currently checks `isAutonomousRunning` to detect stop. For the scroller, the equivalent stop flag is `isCourseScrollerRunning`. Rather than modify `waitMs` (which would break Quiz Auto-Pilot), introduce a thin `waitMsScroller(ms)` that checks `isCourseScrollerRunning` and `isAutonomousPaused`.

**Repo convention**: All other `async` functions here use `console.debug` for trace logging and `console.error` for caught exceptions. Match this. Error handling in `scrapeData` uses `try/finally` with `isScrapeInFlight = false` in `finally`. Match that pattern for per-section errors.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Syntax check | Load unpacked → `chrome://extensions` | No error |
| Pause test | Run scroller → click Pause → observe console | Loop stops executing between sections; "PAUSED" message visible |
| Resume test | Click Resume → loop continues from where paused | |
| Error resilience | Temporarily throw inside scrapeFn mock | Loop logs error, continues to next section |

## Scope

**In scope** (the only files you should modify):
- `scraper.js` — three edits: add `waitMsScroller`, update loop to use it, add inner try-catch, increase `maxSubTopics`

**Out of scope** (do NOT touch):
- `content.js` — the pause/resume message handlers already call `toggleAutonomousPause` which toggles `isAutonomousPaused`; no change needed there since the scroller will now read that flag
- `ui.js` — no changes
- `popup.js` — no changes; the existing Pause button already calls `toggleAutoPilotPause` which routes to `toggleAutonomousPause`
- `waitMs` — do not modify; leave it serving Quiz Auto-Pilot only

## Git workflow

- Branch: `advisor/010-course-scroller-pause-resilience`
- Commit message: `feat: add pause support and per-section error resilience to Course Scroller`

## Steps

### Step 1: Add `waitMsScroller` helper to `scraper.js`

After the existing `waitMs` function (ends at line ~65), add:

```js
// Wait helper for Course Scroller — respects pause state and scroller stop flag
async function waitMsScroller(ms) {
  const step = 100;
  let elapsed = 0;
  while (elapsed < ms) {
    if (!isCourseScrollerRunning) return;
    while (isAutonomousPaused && isCourseScrollerRunning) {
      await new Promise((r) => setTimeout(r, step));
    }
    await new Promise((r) => setTimeout(r, Math.min(step, ms - elapsed)));
    elapsed += step;
  }
}
```

This mirrors `waitMs` exactly, but replaces `isAutonomousRunning` checks with `isCourseScrollerRunning`.

**Verify**: `grep -n "waitMsScroller" scraper.js` — one match at the function declaration.

### Step 2: Update `runCourseScrollerLoop` — use `waitMsScroller`, add inner try-catch, raise cap

Locate `runCourseScrollerLoop` in `scraper.js` (starts at line ~355). Apply three changes inside the function:

**Change A** — Raise the `maxSubTopics` cap:
```js
// Before:
  const maxSubTopics = 250;
// After:
  const maxSubTopics = 1000;
```

**Change B** — Replace the bare `setTimeout` at the end of the loop with `waitMsScroller`, and add a pause check at the top of the loop. The while-loop body should now start with:
```js
    while (isCourseScrollerRunning && iterations < maxSubTopics) {
      // Respect pause state — yields until resumed or stopped
      if (isAutonomousPaused) {
        console.log("NetAcad AutoAnswer: Course Scroller PAUSED ⏸️");
        while (isAutonomousPaused && isCourseScrollerRunning) {
          await new Promise((r) => setTimeout(r, 200));
        }
        if (!isCourseScrollerRunning) break;
        console.log("NetAcad AutoAnswer: Course Scroller RESUMED ▶️");
      }
```

And replace the sleep at the end of the loop (the bare `await new Promise(r => setTimeout(r, 1200))`) with:
```js
      // Wait for next section DOM to render (respects pause/stop)
      await waitMsScroller(1200);
```

**Change C** — Wrap per-section steps in an inner try-catch so a single bad section doesn't kill the loop. The inner loop body pattern should be:

```js
      try {
        console.log(`NetAcad AutoAnswer: Course Scroller processing section #${iterations + 1}`);

        // 1. Video + check button sweep
        // ... existing steps ...

        // 4. Navigation
        let navigated = navFn ? navFn() : false;
        if (!navigated && fallbackNavFn) navigated = fallbackNavFn();

        if (!navigated) {
          console.log("NetAcad AutoAnswer: Course Scroller — all course topics 100% completed! 🎉");
          break;
        }

        // Wait for next section
        await waitMsScroller(1200);
        iterations++;
      } catch (sectionErr) {
        console.error(`NetAcad AutoAnswer: Course Scroller error on section #${iterations + 1}:`, sectionErr);
        // Skip this section and continue to next
        await waitMsScroller(1500);
        iterations++;
      }
```

The key constraint: the `break` on "all completed" must still exit the outer `while` loop, not just the `catch`. In JavaScript, `break` inside a `try` inside a `while` exits the `while`. This is correct.

**Verify**: `grep -n "waitMsScroller\|maxSubTopics\|sectionErr" scraper.js` shows:
- `waitMsScroller` appears 2× (declaration + usage in loop)
- `maxSubTopics` shows `1000`
- `sectionErr` appears in the inner catch

### Step 3: Reload and test pause/resume

1. Reload extension in `chrome://extensions`.
2. Open a NetAcad course, start Course Scroller.
3. Click "Pause ⏸" in the popup.
4. Observe console: should see `"NetAcad AutoAnswer: Course Scroller PAUSED ⏸️"` and loop stops.
5. Click "Resume ▶" in the popup.
6. Observe console: should see `"NetAcad AutoAnswer: Course Scroller RESUMED ▶️"` and loop resumes.
7. Click "Stop ⏹" — loop should terminate.

**Verify**: After clicking Stop, `isCourseScrollerRunning` in console shows `false` (type `window.isCourseScrollerRunning` in DevTools console).

## Test plan

No automated test infrastructure. Manual verification via steps above. Key observable: pause/resume works; a simulated per-section error (can test by temporarily wrapping `scrollFn()` call in a `throw`) does not stop the entire scroller.

## Done criteria

- [ ] `grep -n "waitMsScroller" scraper.js` returns 2 matches (declaration + call in loop)
- [ ] `grep -n "maxSubTopics" scraper.js` shows value `1000`
- [ ] `grep -n "sectionErr\|catch.*sectionErr" scraper.js` shows inner catch exists
- [ ] Manual pause test passes (loop pauses when Pause clicked)
- [ ] Manual resume test passes (loop continues when Resume clicked)
- [ ] Manual stop test passes (loop terminates immediately after current section)
- [ ] Extension reloads without errors
- [ ] `plans/README.md` status row updated to DONE

## STOP conditions

- Drift detected: `runCourseScrollerLoop` or `waitMs` in `scraper.js` doesn't match the "Current state" excerpts
- The `break` inside the inner `try` block exits the `catch` but not the `while` — if this happens, restructure using a `shouldBreak` flag: set it in the try, check it after the try/catch, then `break`
- After the change, the Quiz Auto-Pilot's pause behavior regresses — check `waitMs` was not modified

## Maintenance notes

- If a "Pause Course Scroller" feature is desired *independently* from the Quiz Auto-Pilot pause (i.e. separate flags), add `isScrollerPaused` and corresponding `pauseScrollerLoop`/`resumeScrollerLoop` functions. The current implementation reuses `isAutonomousPaused`, which means pausing the Quiz Auto-Pilot also pauses the scroller if both are somehow running.
- The `maxSubTopics = 1000` cap is now effectively a safety limit rather than a functional constraint. If a course ever exceeds 1000 sections, raise it again or replace with a dynamic cap based on `parseThreeLevelCourseToC().allSubTopics.length`.
