# Plan 009: Fix scroll timing, scope aria-expanded accordion expansion, and reduce ToC logging

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat d395c7c..HEAD -- ui.js scraper.js`
> If either file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Status**: DONE
- **Priority**: P1
- **Effort**: S
- **Risk**: MED
- **Depends on**: 008 (removes double-sweep calls from autoScrollModulePage first)
- **Category**: bug
- **Planned at**: commit `d395c7c`, 2026-07-23

## Why this matters

Three independent issues cause course sections to stay marked incomplete or trigger unintended side-effects:

1. **Scroll timing cutoff** — `autoScrollModulePage` uses CSS smooth-scroll (`behavior: "smooth"`) but only waits 150ms + 200ms (350ms total) before resolving. Smooth scrolling on a full NetAcad module page takes 500ms–1000ms+ to complete. NetAcad's IntersectionObserver-based reading completion tracker fires when the viewport actually reaches the bottom; if the function resolves before the scroll animation completes, the section is never marked as read. **Observed consequence**: sections stay at 0/1 completion even after the scroller visits them.

2. **Blind `aria-expanded='false'` accordion expansion** — `parseThreeLevelCourseToC` expands collapsed accordion elements by running `root.querySelectorAll("[aria-expanded='false']")` across the *entire* shadow DOM root and clicking any match. This selector is far too broad: NetAcad pages contain navigation dropdowns, user profile menus, header accordions, and settings panels that also use `aria-expanded`. Clicking any of them can open unwanted overlays, trigger route navigation, or change user settings.

3. **ToC console.group spam** — `navigateToFirstIncompleteLevel3Item` uses `console.group` to log the complete list of ToC topics (title + completion status) on every single call from `runCourseScrollerLoop`. For a 50-topic course with 50 iterations this outputs 2500+ log lines, which bloats DevTools and causes measurable console rendering overhead.

## Current state

**File**: `ui.js`

```js
// ui.js:615–633 (autoScrollModulePage — after plan 008 removes the duplicate sweep calls)
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

```js
// ui.js:686–698 (parseThreeLevelCourseToC — accordion expansion block)
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
```

```js
// ui.js:751–770 (navigateToFirstIncompleteLevel3Item — logging block)
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
```

**Repo conventions**: `autoScrollModulePage` is in `ui.js`; `parseThreeLevelCourseToC` and `navigateToFirstIncompleteLevel3Item` are also in `ui.js`. Keep changes in-file. `console.debug` is used for trace logging per `AGENTS.md`.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Syntax check | Load unpacked in `chrome://extensions` | No extension error |
| Scroll test | Course page → scroll console → check `window.scrollY` during scroller | Reaches `scrollHeight` before navigation fires |

## Scope

**In scope**:
- `ui.js` — three edits described below

**Out of scope** (do NOT touch):
- `scraper.js` — no changes needed here
- The `isTocItemCompleted` logic — out of scope for this plan
- Any other functions in `ui.js`

## Git workflow

- Branch: `advisor/009-fix-scroll-timing-aria-toc-log`
- Commit message: `fix: extend scroll wait, scope accordion expansion to ToC sidebar, suppress ToC log spam`

## Steps

### Step 1: Fix scroll timing in `autoScrollModulePage`

**Problem**: The function uses CSS smooth-scroll with only 150ms + 200ms waits. Both waits need to be long enough for the scroll to complete AND for IntersectionObserver callbacks to fire. The fix is two-part:
- Switch from `behavior: "smooth"` to `behavior: "auto"` (instant) for the actual progress-tracker scroll to guarantee the viewport reaches `scrollHeight`
- Add an additional dispatch of a synthetic `scroll` event to force any IntersectionObserver callbacks that may require an explicit event
- Keep a reasonable wait (800ms) to allow JS callbacks to process

Replace the body of `autoScrollModulePage` in `ui.js` (lines 615–633) with:

```js
async function autoScrollModulePage() {
  console.debug("NetAcad AutoAnswer: Starting module auto-scroll...");

  // Scroll to page bottom instantly so IntersectionObservers and progress trackers fire reliably
  const maxScroll = Math.max(
    document.body.scrollHeight,
    document.documentElement.scrollHeight,
    window.innerHeight * 3
  );

  // First pass: scroll to midpoint (smooth — visual feedback)
  window.scrollTo({ top: Math.floor(maxScroll / 2), behavior: "smooth" });
  await new Promise((res) => setTimeout(res, 300));

  // Second pass: instant scroll to bottom so completion trackers register
  window.scrollTo({ top: maxScroll, behavior: "auto" });
  // Dispatch a synthetic scroll event to ensure IntersectionObserver callbacks fire
  window.dispatchEvent(new Event("scroll"));
  await new Promise((res) => setTimeout(res, 800));
}
```

**Verify**: `grep -n "setTimeout" ui.js | grep -A2 "autoScrollModulePage"` — the waits now total 1100ms (300 + 800) and the final scroll uses `behavior: "auto"`.

### Step 2: Scope accordion expansion to the ToC sidebar container

**Problem**: `[aria-expanded='false']` queried on the entire root matches all aria-collapsible elements on the page. Fix by restricting the search to the ToC sidebar container element.

In `ui.js`, find the `parseThreeLevelCourseToC` function (line ~681). Replace the accordion expansion block (lines ~686–698) with:

```js
    // 1. Expand all collapsed accordions in the ToC sidebar only
    const tocContainer =
      root.querySelector("app-course-outline") ||
      root.querySelector("[class*='course-outline']") ||
      root.querySelector("[class*='sidebar']") ||
      root.querySelector("nav");

    const expandScope = tocContainer || root;
    const expandButtons = Array.from(
      expandScope.querySelectorAll(
        ".accordion-toggle, .expand-btn, [class*='expand'], [class*='accordion']"
      )
    ).filter((btn) => btn.getAttribute("aria-expanded") === "false" || btn.classList.contains("collapsed"));

    expandButtons.forEach((btn) => {
      try {
        btn.click();
      } catch (_) {}
    });
```

Key changes:
- Removed `[aria-expanded='false']` from the `querySelectorAll` string (it matched everything)
- Added a scoped container lookup (`app-course-outline`, `.course-outline`, `.sidebar`, `nav`) before querying
- Used `.filter()` to keep only actually-collapsed buttons
- Removed the redundant `aria-expanded` check inside the forEach (handled by filter)

**Verify**: `grep -n "aria-expanded" ui.js` — the string `[aria-expanded='false']` should no longer appear in the `querySelectorAll` selector inside `parseThreeLevelCourseToC`.

### Step 3: Replace verbose ToC console.group with a single-line debug summary

In `ui.js`, find `navigateToFirstIncompleteLevel3Item` (line ~751). Replace the logging block:

```js
  if (allSubTopics.length > 0) {
    console.group("NetAcad ToC Audit Trace");
    allSubTopics.forEach((topic, i) => {
      console.log(`[ToC #${i + 1}] "${topic.title}" -> ${topic.isCompleted ? "DONE ✔" : "UNDONE ⏳"}`);
    });
    console.groupEnd();
  }
```

With:

```js
  if (allSubTopics.length > 0) {
    const doneCount = allSubTopics.filter((t) => t.isCompleted).length;
    console.debug(`NetAcad ToC: ${doneCount}/${allSubTopics.length} topics completed.`);
  }
```

This preserves the useful progress information as a single `console.debug` line (filtered out in production DevTools unless debug level enabled) instead of N `console.log` lines inside a group.

**Verify**: `grep -n "console.group\|console.groupEnd" ui.js` — returns no matches inside `navigateToFirstIncompleteLevel3Item`.

### Step 4: Reload and smoke-test

1. Reload extension in `chrome://extensions`.
2. Open a NetAcad course page with multiple module sections.
3. Open DevTools → Console (set to "Default levels" — i.e. Debug hidden).
4. Run the Course Scroller.
5. Observe: no `console.group("NetAcad ToC Audit Trace")` groups appear.
6. Observe: after each section is processed, the browser actually reaches page bottom (verify via DevTools → `window.scrollY === document.body.scrollHeight`).
7. After one iteration, pause and check: did the section get marked complete in the ToC?

## Test plan

No automated test infrastructure. Manual verification is the gate. Key observable:
- Section completion marks appear in the ToC sidebar after the scroller visits each section
- No accordion/dropdown menus open unexpectedly during parsing
- DevTools console shows one `console.debug` summary per section, not a full group

## Done criteria

- [ ] `grep -n "setTimeout" ui.js` shows `autoScrollModulePage` waits total ≥ 1100ms and last scroll uses `behavior: "auto"`
- [ ] `grep -n "\[aria-expanded='false'\]" ui.js` returns no matches inside `querySelectorAll` inside `parseThreeLevelCourseToC`
- [ ] `grep -n "console.group" ui.js` returns no matches inside `navigateToFirstIncompleteLevel3Item`
- [ ] Extension reloads without errors
- [ ] Manual smoke-test: sections get completion marks after scroller visits
- [ ] `plans/README.md` status row updated to DONE

## STOP conditions

- Drift detected: `autoScrollModulePage`, `parseThreeLevelCourseToC`, or `navigateToFirstIncompleteLevel3Item` in `ui.js` don't match the "Current state" excerpts
- The `app-course-outline` container element isn't found during manual testing and the ToC fails to expand — report back; the container selector may need adjustment for the specific NetAcad page structure
- Step 2's verification shows `[aria-expanded='false']` still appears in a querySelectorAll call inside the scoped block

## Maintenance notes

- If NetAcad changes the ToC sidebar container class/element name, the `tocContainer` selector cascade in Step 2 will need updating. The `null` fallback to `root` ensures the function still works (just with broader accordion scope) if all named containers fail.
- If NetAcad's progress tracker requires scroll events from inside a shadow root element (not `window`), the synthetic `scroll` dispatch in Step 1 may need to target the scrollable container instead of `window`.
- The 800ms wait in Step 1 is a conservative estimate; if sections still don't mark complete, increase to 1200ms.
