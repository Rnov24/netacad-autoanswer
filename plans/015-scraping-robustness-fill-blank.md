# Plan 015: Robust question text scraping and answer extraction (fill-blank and edge cases)

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat bed4361..HEAD -- ui.js scraper.js`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P2
- **Effort**: M
- **Risk**: LOW — scraping improvements; fallbacks are preserved
- **Depends on**: none
- **Category**: correctness / accuracy
- **Planned at**: commit `bed4361`, 2026-07-25

---

## Why this matters

Two scraping gaps reduce accuracy across all question types:

1. **`fill-blank-view` questions are silently skipped**. `scraper.js:142–171` traverses `mcq-view` and `object-matching-view` inside `block-view` shadow roots but never looks for `fill-blank-view`. The AI correctly returns `FILL_IN_BLANK` type answers, but the auto-select tier (`ui.js:822–839`) which handles text inputs is only reached when an MCQ element is already in scope. Fill-blank questions produce no UI panel and are never auto-answered.

2. **`extractQuestionAndAnswers` uses a broad text fallback** (`ui.js:238–247`). When the primary question selectors fail (`.component__body-inner.mcq__body-inner`, `.component__body`, `.mcq__prompt`, `.prompt`), the function falls back to any `div, p, span` with `innerText.length > 20`. This can grab navigation sidebar text, button labels, or sub-question text as the "question" — sending garbage to the AI which then returns a wrong or confused answer.

---

## Current state

### Relevant files

- `scraper.js` — shadow DOM traversal in `scrapeData` (lines 141–171)
- `ui.js` — `extractQuestionAndAnswers` (lines 218–270)

### Key excerpts

**`scraper.js:153–159` — traversal discovers mcq-view and object-matching-view but NOT fill-blank-view**
```js
                  const mcqView = blockView.shadowRoot.querySelector("mcq-view");
                  if (mcqView) mcqViewElements.push(mcqView);
                  const omv = blockView.shadowRoot.querySelector("object-matching-view");
                  if (omv) mcqViewElements.push(omv);
```

**`ui.js:238–247` — broad fallback question text finder**
```js
      } else {
        const potentialElements = Array.from(root.querySelectorAll("div, p, span"));
        for (const el of potentialElements) {
          const text = el.innerText.trim();
          if (text.length > 20) {   // <- any non-empty text in the component
            promptText = text;
            questionTextElement = el;
            break;                  // <- first match wins; may be wrong element
          }
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
- `scraper.js` — shadow DOM traversal loop in `scrapeData`
- `ui.js` — `extractQuestionAndAnswers`

**Out of scope**:
- `api.js`, `content.js`, `background.js`, `popup.js`, `manifest.json`
- `extractMatchingQuestion` — separate path; not modified here

---

## Git workflow

- Branch: `advisor/015-scraping-robustness`
- Commit message: `fix: add fill-blank-view discovery and tighten question text fallback`
- Do NOT push or open a PR unless instructed.

---

## Steps

### Step 1: Add `fill-blank-view` to the shadow DOM traversal in `scraper.js`

In `scraper.js`, in `scrapeData`, find the traversal block (lines 153–159):
```js
                  const mcqView = blockView.shadowRoot.querySelector("mcq-view");
                  if (mcqView) mcqViewElements.push(mcqView);
                  const omv = blockView.shadowRoot.querySelector("object-matching-view");
                  if (omv) mcqViewElements.push(omv);
```

Replace with:
```js
                  const mcqView = blockView.shadowRoot.querySelector("mcq-view");
                  if (mcqView) mcqViewElements.push(mcqView);
                  const omv = blockView.shadowRoot.querySelector("object-matching-view");
                  if (omv) mcqViewElements.push(omv);
                  const fbv = blockView.shadowRoot.querySelector("fill-blank-view");
                  if (fbv) mcqViewElements.push(fbv);
```

**Verify**: `node --check scraper.js` → exit 0

### Step 2: Handle `fill-blank-view` elements in the scraper extraction loop

In `scraper.js`, in `scrapeData`, the extraction loop checks `isMatching` and then falls through to `extractQuestionAndAnswers`. Add a check for fill-blank-view before the existing `isMatching` block (around line 207):

Current:
```js
      const isMatching = mcqViewElement.tagName?.toLowerCase() === "object-matching-view";
```

Replace with:
```js
      const tagName = (mcqViewElement.tagName || "").toLowerCase();
      const isMatching = tagName === "object-matching-view";
      const isFillBlank = tagName === "fill-blank-view";
```

Then, after the `if (isMatching) { ... continue; }` block and before the `extractQuestionAndAnswers` block, add:
```js
      // Fill-in-the-blank: extract question text and treat answers as empty (AI provides the fill text)
      if (isFillBlank) {
        if (!extractQuestionAndAnswersFn) {
          await processSingleQuestionFn(mcqViewElement, index, apiKey, "Error: extraction functions missing.");
          continue;
        }
        const extracted = extractQuestionAndAnswersFn(mcqViewElement, index);
        if (extracted.questionText && !extracted.questionText.startsWith("Error")) {
          allQuestionsData.push({
            question: extracted.questionText,
            answers: [],   // fill-blank has no multiple-choice options
            questionType: "FILL_IN_BLANK",
            mcqViewElement,
            originalIndex: index,
          });
        } else {
          await processSingleQuestionFn(mcqViewElement, index, apiKey, extracted.questionText);
        }
        continue;
      }
```

**Verify**: `node --check scraper.js` → exit 0

### Step 3: Tighten the question text fallback in `extractQuestionAndAnswers`

In `ui.js`, in `extractQuestionAndAnswers` (lines 238–247), replace the broad fallback:

Current:
```js
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
```

Replace with a scoped search that excludes navigation, button text, and option items:
```js
      } else {
        // Tighter fallback: search only elements with semantic content classes,
        // excluding option/button/nav elements that are not the question prompt.
        const FALLBACK_SELECTORS = [
          ".component__body-inner",
          ".component__body",
          ".mcq__body",
          "[class*='prompt']",
          "[class*='question']",
          "[class*='body']",
          "p",
        ];
        const EXCLUDE_CLOSEST = ".mcq__item, .component__option, .objectMatching-option-item, button, nav, header, aside, .netacad-ai-assistant-ui";

        for (const sel of FALLBACK_SELECTORS) {
          const candidates = Array.from(root.querySelectorAll(sel));
          for (const el of candidates) {
            // Skip if inside an option, button, nav, or our own AI panel
            if (typeof el.closest === "function" && el.closest(EXCLUDE_CLOSEST)) continue;
            const text = (el.innerText || "").trim();
            if (text.length > 25 && text.length < 2000) {
              promptText = text;
              questionTextElement = el;
              break;
            }
          }
          if (promptText) break;
        }
      }
```

**Verify**: `node --check ui.js` → exit 0

### Step 4: Make `extractQuestionAndAnswers` work for `fill-blank-view` elements

`extractQuestionAndAnswers` currently checks `mcqViewElement.shadowRoot` and then looks for `base-view[type="component"]`. A `fill-blank-view` may use the same structure. The existing code should work; add a safeguard to log the question element found for debugging:

In `ui.js`, at the end of the `extractQuestionAndAnswers` function, just before the `return` statement (line 269), add:
```js
  console.debug(`NetAcad UI: Q${index + 1} extracted — "${questionText.slice(0, 60).replace(/\n/g, " ")}..." | ${answerElements.length} answer elements`);
```

**Verify**: `node --check ui.js` → exit 0

---

## Test plan

Manual verification:

1. Navigate to a NetAcad page with a **fill-in-the-blank** question. Run Auto-Solve. Verify the AI panel appears on the fill-blank question and the text input is populated with the AI answer.
2. Navigate to a standard MCQ question where the question text selector works (normal case). Verify question extraction and answer still work correctly — no regression.
3. On a page where the question text selectors fail (can be simulated by temporarily renaming the class in DevTools), verify the fallback does NOT pick up sidebar text or button labels as the question.

---

## Done criteria

- [ ] `node --check scraper.js` exits 0
- [ ] `node --check ui.js` exits 0
- [ ] `fill-blank-view` elements are discovered in the shadow DOM traversal (`scraper.js`)
- [ ] `fill-blank-view` elements push a `FILL_IN_BLANK` questionType to `allQuestionsData`
- [ ] Question text fallback in `extractQuestionAndAnswers` excludes option elements and navs
- [ ] Debug log added at end of `extractQuestionAndAnswers`
- [ ] No files outside the in-scope list are modified (`git status`)
- [ ] `plans/README.md` status row updated

---

## STOP conditions

- The code at the locations in "Current state" doesn't match the excerpts.
- A step's verification fails twice after a reasonable fix attempt.
- The `fill-blank-view` element has a different internal structure than `mcq-view` (no `base-view`, different answer element selectors) — log the shadow root structure and report back before proceeding with Step 4.

---

## Maintenance notes

- If NetAcad introduces new question types (e.g. `drag-drop-view`, `sequence-view`), they should be added to the traversal block in `scraper.js` using the same pattern as Step 1.
- The `EXCLUDE_CLOSEST` list in Step 3 is defensive but not exhaustive. If a new page layout produces false positives in the fallback, add the wrapper class to this list.
- The debug log added in Step 4 is `console.debug` (low-noise level) — it's safe to leave in production. Remove only if profiling shows it is a performance concern.
