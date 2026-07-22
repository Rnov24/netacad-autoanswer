# Plan 003: Decouple Quiz Auto-Pilot stop flag from Course Scroller stop flag

> **Executor instructions**: Follow this plan step by step. Run every verification
> command before moving on. If anything in STOP conditions occurs, stop and report.
> When done, update `plans/README.md`.
>
> **Drift check**: `grep -n "isCourseScrollerRunning" d:\Projects\netacad-autoanswer\scraper.js`
> Expected: at least 4 matches (declaration, stopAutonomousLoop, runCourseScrollerLoop, exports).
> If count differs, compare excerpts before proceeding.

## Status

- **Priority**: P1
- **Effort**: S (< 1 hour)
- **Risk**: LOW — additive; only removes one unintended side-effect assignment
- **Depends on**: none
- **Category**: bug
- **Planned at**: commit `ba71b0f`, 2026-07-21

## Why this matters

`stopAutonomousLoop()` currently sets `isCourseScrollerRunning = false` alongside
`isAutonomousRunning = false`. This means clicking the Stop button from the popup
— which is expected to stop the Quiz Auto-Pilot — inadvertently also kills any
concurrently running Course Scroller. These are designed to be independent features.

The popup sends `stopAutoPilot` to stop quiz mode only. A user might run the Course
Scroller and Quiz Auto-Pilot sequentially; the stop should only affect what they
think they are stopping.

## Current state

File: `d:\Projects\netacad-autoanswer\scraper.js`

```js
function stopAutonomousLoop() {
  isAutonomousRunning = false;
  isAutonomousPaused = false;
  isCourseScrollerRunning = false;   // <-- this is the problem
  console.log("NetAcad AutoAnswer: Auto-Pilot STOPPED ⏹️");
  return { isRunning: false, isPaused: false };
}
```

The `runCourseScrollerLoop` function checks `isCourseScrollerRunning` in its
`while` condition. Resetting it from `stopAutonomousLoop` terminates the scroller.

## Scope

**In scope**:
- `scraper.js`

**Out of scope**:
- `content.js` — the `stopAutoPilot` handler calls `stopAutonomousLoop`; no change needed there
- All other files

## Steps

### Step 1: Remove isCourseScrollerRunning from stopAutonomousLoop

In `stopAutonomousLoop`, remove the line `isCourseScrollerRunning = false;`.

The function should become:

```js
function stopAutonomousLoop() {
  isAutonomousRunning = false;
  isAutonomousPaused = false;
  console.log("NetAcad AutoAnswer: Auto-Pilot STOPPED ⏹️");
  return { isRunning: false, isPaused: false };
}
```

**Verify**: `grep -n "isCourseScrollerRunning" d:\Projects\netacad-autoanswer\scraper.js`
`stopAutonomousLoop` should not appear in any result.

### Step 2: Add a dedicated stopCourseScrollerLoop function

Add a new exported function after `stopAutonomousLoop`:

```js
function stopCourseScrollerLoop() {
  isCourseScrollerRunning = false;
  console.log("NetAcad AutoAnswer: Course Scroller STOPPED ⏹️");
  return { isRunning: false };
}
```

Add `stopCourseScrollerLoop` to the `scraperExports` object and to the
`Object.assign(window, scraperExports)` and `Object.assign(globalThis, scraperExports)` calls.

**Verify**: `grep -n "stopCourseScrollerLoop" d:\Projects\netacad-autoanswer\scraper.js`
Should show the function definition AND the export object entry.

### Step 3: (Optional but recommended) Wire stopCourseScrollerLoop into the Stop button

In `content.js`, the `stopAutoPilot` message handler currently calls
`resolveFn("stopAutonomousLoop")`. Update it to also call `stopCourseScrollerLoop`
if the user intends "stop everything":

```js
if (request.action === "stopAutoPilot") {
  const stopQuizFn = resolveFn("stopAutonomousLoop");
  const stopScrollFn = resolveFn("stopCourseScrollerLoop");
  if (stopQuizFn) stopQuizFn();
  if (stopScrollFn) stopScrollFn();
  sendResponse({ success: true });
  return true;
}
```

This makes the Stop button stop everything, which is the user-facing intent.

**Verify**: Inspect `content.js` — the `stopAutoPilot` handler calls both functions.

## Done criteria

- [ ] `stopAutonomousLoop` no longer contains `isCourseScrollerRunning = false`
- [ ] `stopCourseScrollerLoop` function exists and is exported
- [ ] `content.js` stopAutoPilot handler calls both stop functions
- [ ] `git diff --name-only` shows only `scraper.js` and optionally `content.js`
- [ ] `plans/README.md` status updated

## STOP conditions

- The live `stopAutonomousLoop` already lacks `isCourseScrollerRunning = false` (already fixed)
- `isCourseScrollerRunning` is used in more places than scraper.js (check with grep first)

## Maintenance notes

- If a future "stop quiz only" vs "stop scroller only" button is added to the popup,
  wire each to the corresponding stop function individually
