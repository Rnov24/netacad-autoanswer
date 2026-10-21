# Plan 012: Reliable question-type detection and correct multi-select auto-clicking

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat bed4361..HEAD -- api.js ui.js`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: MED — changes auto-click behaviour; multi-select questions will now deselect previously-chosen wrong answers
- **Depends on**: none
- **Category**: bug / correctness
- **Planned at**: commit `bed4361`, 2026-07-25

---

## Why this matters

Two related bugs cause wrong answers to be submitted on single-select and multi-select questions:

1. **Question type is inferred only from the prompt text** in `buildSinglePrompt` (`api.js:38`) using a naive keyword test (`"matching question"` or `"order"`). There is no reliable DOM-based check for whether a question is MCQ_SINGLE vs MCQ_MULTIPLE. The AI is told the question is MCQ_SINGLE even when it has checkboxes, so it returns only one answer.

2. **`autoSelectOptionsInDom` never deselects**. For multi-select questions the function iterates over each `targetAnswer` and clicks the matching option — but never clears previously-selected options that should not be selected. If the user or a prior auto-run already has a wrong option checked, it stays checked.

Together these mean multi-select questions are answered as if they were single-select, and residual wrong selections are never cleared.

---

## Current state

### Relevant files

- `api.js` — prompt builder and AI call orchestration
- `ui.js` — DOM selection and click logic (`autoSelectOptionsInDom`, `processAnswerElements`)

### Key excerpts

**`api.js:38-64` — `buildSinglePrompt`**
```js
function buildSinglePrompt(question, answers) {
  const isMatching = question.toLowerCase().includes("matching question") || question.toLowerCase().includes("order");
  return `...
INSTRUCTIONS:
1. Analyze and classify the question type into "type":
   - "MCQ_SINGLE" (single choice multiple-choice question)
   ...
3. Output your answer in structured JSON format with keys "type" and "answer":
{
  "type": "${isMatching ? "OBJECT_MATCHING" : "MCQ_SINGLE"}",  // <- HARDCODES MCQ_SINGLE
  "answer": "exact answer string"
}
```

The type hint in the JSON template is hard-coded. The AI is nudged toward MCQ_SINGLE even for checkbox questions.

**`api.js:67-104` — `buildBatchPrompt`**
```js
function buildBatchPrompt(questionsWithAnswers) {
  const formattedQuestions = questionsWithAnswers
    .map((q, idx) => {
      const isMatching = q.question.toLowerCase().includes("matching question") || q.question.toLowerCase().includes("order");
      return `[QUESTION ${idx + 1}] ${isMatching ? "(TYPE: OBJECT_MATCHING)" : ""}
...
```
Same problem: no `MCQ_MULTIPLE` hint is emitted even when the question DOM contains checkboxes.

**`ui.js:843-851` — option node gathering**
```js
let optionNodes = [];
searchRoots.forEach((root) => {
  const interactiveInputs = Array.from(
    root.querySelectorAll("mat-radio-button, mat-checkbox, input[type='radio'], input[type='checkbox']")
  );
  if (interactiveInputs.length > 0) {
    optionNodes.push(...interactiveInputs);
  }
});
```
The code already finds both radio buttons and checkboxes — so the DOM information needed to infer MCQ_MULTIPLE is **already available**, just not passed to the AI.

**`ui.js:950-958` — the click path (never deselects)**
```js
if (bestMatch.inputEl) {
  if (!bestMatch.inputEl.checked) {     // only clicks if unchecked — never unclicks wrong options
    dispatchFullClickSequence(bestMatch.inputEl);
    bestMatch.inputEl.checked = true;
    ...
  }
}
```

---

## Commands you will need

| Purpose | Command | Expected on success |
|---------|---------|---------------------|
| Validate JS syntax | `node --check api.js && node --check ui.js` | exit 0, no output |
| Load extension | Load unpacked in `chrome://extensions` | extension loads without errors |

---

## Scope

**In scope** (the only files you should modify):
- `api.js`
- `ui.js`

**Out of scope** (do NOT touch):
- `scraper.js` — orchestration layer; does not need to change
- `content.js`, `background.js`, `popup.js`, `manifest.json`

---

## Git workflow

- Branch: `advisor/012-question-type-detection`
- Commit message style: `fix: detect MCQ_MULTIPLE from DOM and deselect stale options`
- Do NOT push or open a PR unless instructed.

---

## Steps

### Step 1: Expose question type hint from the DOM to `scraper.js` → `api.js`

The scraper already calls `processAnswerElements` which returns answer texts from the DOM. At the same point it resolves answer nodes via `extractQuestionAndAnswers`. The input nodes are already available. We need to determine whether the question uses checkboxes (MCQ_MULTIPLE) or radio buttons (MCQ_SINGLE) and pass that information alongside the question data into the batch API call.

**In `ui.js`, add a new exported helper function** after `processAnswerElements` (around line 358):

```js
/**
 * Infer the question input type from the MCQ DOM element.
 * Returns "MCQ_MULTIPLE" if checkboxes are found, "MCQ_SINGLE" otherwise.
 */
function detectMcqInputType(mcqViewElement) {
  if (!mcqViewElement) return "MCQ_SINGLE";
  try {
    const sr = mcqViewElement.shadowRoot;
    const baseView = sr ? sr.querySelector('base-view[type="component"]') : null;
    const searchRoots = [
      sr,
      baseView && baseView.shadowRoot ? baseView.shadowRoot : null,
    ].filter(Boolean);

    for (const root of searchRoots) {
      const checkboxes = root.querySelectorAll(
        "mat-checkbox, input[type='checkbox']"
      );
      if (checkboxes.length > 0) return "MCQ_MULTIPLE";
      const radios = root.querySelectorAll(
        "mat-radio-button, input[type='radio']"
      );
      if (radios.length > 0) return "MCQ_SINGLE";
    }
  } catch (_) {}
  return "MCQ_SINGLE";
}
```

Add `detectMcqInputType` to the `exportsList` object at the bottom of `ui.js` (same pattern as all other exports in that object).

**Verify**: `node --check ui.js` → exit 0

### Step 2: Pass the detected input type into the batch question data in `scraper.js`

In `scraper.js`, around line 238–251, the extracted question data is pushed into `allQuestionsData`. Add a `questionType` field using the new helper:

Current code (lines 238–250):
```js
      const extracted = extractQuestionAndAnswersFn(mcqViewElement, index);
      const answerTexts = processAnswerElementsFn(extracted.answerElements, index);

      if (extracted.questionText && !extracted.questionText.startsWith("Error") && answerTexts.length > 0) {
        allQuestionsData.push({
          question: extracted.questionText,
          answers: answerTexts,
          mcqViewElement,
          originalIndex: index,
        });
```

Replace with:
```js
      const extracted = extractQuestionAndAnswersFn(mcqViewElement, index);
      const answerTexts = processAnswerElementsFn(extracted.answerElements, index);
      const detectTypeFn = resolveFn("detectMcqInputType") || (typeof detectMcqInputType === "function" ? detectMcqInputType : null);
      const questionType = detectTypeFn ? detectTypeFn(mcqViewElement) : "MCQ_SINGLE";

      if (extracted.questionText && !extracted.questionText.startsWith("Error") && answerTexts.length > 0) {
        allQuestionsData.push({
          question: extracted.questionText,
          answers: answerTexts,
          questionType,   // "MCQ_SINGLE" | "MCQ_MULTIPLE"
          mcqViewElement,
          originalIndex: index,
        });
```

**Verify**: `node --check scraper.js` → exit 0

### Step 3: Use the detected type in the prompt builders in `api.js`

**In `buildSinglePrompt`** (lines 37–65): replace the hard-coded type hint.

Change the function signature to accept an optional `questionType` parameter:

```js
function buildSinglePrompt(question, answers, questionType = null) {
  const isMatching = question.toLowerCase().includes("matching question") || question.toLowerCase().includes("order");
  const inferredType = isMatching ? "OBJECT_MATCHING" : (questionType || "MCQ_SINGLE");
  return `You are a Cisco CCNA networking expert. Analyze the question type and determine the correct answer.

Question:
${question}

Options / Available items:
${answers.map((a, i) => `${i + 1}. ${a}`).join("\n")}

INSTRUCTIONS:
1. The DOM-detected question input type is: "${inferredType}". Use this as a strong hint.
   Confirm or adjust based on question wording. Valid types:
   - "MCQ_SINGLE" (radio buttons — exactly one correct answer)
   - "MCQ_MULTIPLE" (checkboxes — one or more correct answers; select ALL that apply)
   - "OBJECT_MATCHING" (matching/connecting category circles A, B, C... to option items)
   - "FILL_IN_BLANK" (text input question)

2. Determine the correct answer(s) into "answer":
   - For MCQ_SINGLE: exact option text of the single correct answer.
   - For MCQ_MULTIPLE: ALL correct option texts, each separated by ' /// '.
   - For OBJECT_MATCHING: 'A: <exact text> /// B: <exact text> /// C: <exact text>'. Use exact text from options list.
   - For FILL_IN_BLANK: the answer text to type.

3. Output your answer in structured JSON format with keys "type" and "answer":
{
  "type": "${inferredType}",
  "answer": "exact answer string"
}
Return ONLY valid JSON.`;
}
```

**In `buildBatchPrompt`** (lines 67–104): pass the type hint per question.

Replace the `formattedQuestions` map:
```js
  const formattedQuestions = questionsWithAnswers
    .map((q, idx) => {
      const isMatching = q.question.toLowerCase().includes("matching question") || q.question.toLowerCase().includes("order");
      const typeHint = isMatching ? "OBJECT_MATCHING" : (q.questionType || "MCQ_SINGLE");
      return `[QUESTION ${idx + 1}] (DOM-DETECTED TYPE: ${typeHint})
${q.question}
Options / Items:
${q.answers.map((a, i) => `${i + 1}. ${a}`).join("\n")}`;
    })
    .join("\n\n");
```

And update the instructions block to clarify multi-select:
```
CRITICAL INSTRUCTIONS:
- The "DOM-DETECTED TYPE" in each question header is a strong hint based on checkbox vs radio DOM analysis. Honor it unless question wording clearly contradicts it.
- For MCQ_SINGLE: return one exact option text.
- For MCQ_MULTIPLE: return ALL correct options separated by ' /// '. Select every answer that applies — do NOT limit to one.
- For OBJECT_MATCHING: output ALL pairs: 'A: <exact option text> /// B: <exact option text>'.
- Return ONLY valid JSON object with no extra text outside JSON.
```

**Verify**: `node --check api.js` → exit 0

### Step 4: Wire `questionType` through to `getAiAnswersForBatch`

In `scraper.js`, the batch call passes `questionsForPrompt`:
```js
const questionsForPrompt = allQuestionsData.map((q) => ({ question: q.question, answers: q.answers }));
```
Change to also include `questionType`:
```js
const questionsForPrompt = allQuestionsData.map((q) => ({
  question: q.question,
  answers: q.answers,
  questionType: q.questionType || "MCQ_SINGLE",
}));
```

**Verify**: `node --check scraper.js` → exit 0

### Step 5: Deselect stale options before selecting for MCQ_MULTIPLE

In `ui.js`, in `autoSelectOptionsInDom` (around line 797), add a deselect pass **before** the match-and-click loop.

After `const uniqueNodes = Array.from(new Set(optionNodes));` (line 865) and after `parsedCandidates` is built, add:

```js
    // Determine if this is a multi-select (checkbox) question
    const isMultiSelect = parsedCandidates.some((c) => {
      const tag = (c.inputEl && c.inputEl.tagName || "").toLowerCase();
      return tag === "mat-checkbox" || (c.inputEl && c.inputEl.type === "checkbox");
    });

    // For multi-select: deselect ALL currently-selected options before re-selecting
    // This clears stale prior selections so only AI-chosen options end up checked
    if (isMultiSelect) {
      parsedCandidates.forEach((cand) => {
        if (cand.inputEl && cand.inputEl.checked) {
          dispatchFullClickSequence(cand.inputEl);
          cand.inputEl.checked = false;
          cand.inputEl.dispatchEvent(new Event("change", { bubbles: true }));
          cand.inputEl.dispatchEvent(new Event("input", { bubbles: true }));
        }
      });
    }
```

Insert this block immediately before the `targetAnswers.forEach(...)` loop (currently at line 894).

**Verify**: `node --check ui.js` → exit 0

### Step 6: Ensure single-select questions deselect all others after selecting

In `ui.js`, in the `targetAnswers.forEach` loop, after a successful `bestMatch` click for a radio-button question, add a pass to ensure other options are not checked:

After the `bestMatch.inputEl.checked = true;` block (around line 952–955), add:

```js
          // For single-select: uncheck any other option that is currently checked
          if (bestMatch.inputEl.type === "radio" || bestMatch.inputEl.tagName.toLowerCase() === "mat-radio-button") {
            parsedCandidates.forEach((other) => {
              if (other !== bestMatch && other.inputEl && other.inputEl.checked) {
                other.inputEl.checked = false;
                other.inputEl.dispatchEvent(new Event("change", { bubbles: true }));
              }
            });
          }
```

**Verify**: `node --check ui.js` → exit 0

---

## Test plan

No automated test harness exists in this project. Manual verification on a live NetAcad quiz page:

1. Open a NetAcad module with a **single-select** (radio button) quiz question. Run Auto-Solve. Verify exactly **one** option is highlighted green and the submit fires correctly.
2. Open a NetAcad module with a **multi-select** (checkbox) quiz question. Run Auto-Solve. Verify **all correct options** are highlighted green and only correct ones are selected.
3. Manually pre-select a wrong checkbox, then click "Auto-Select" in the AI panel. Verify the wrong option is **deselected** and only the AI-chosen ones are selected.
4. Check `chrome://extensions` → inspect background → no console errors.

---

## Done criteria

- [ ] `node --check api.js` exits 0
- [ ] `node --check ui.js` exits 0
- [ ] `node --check scraper.js` exits 0
- [ ] `detectMcqInputType` is exported in `exportsList` in `ui.js`
- [ ] `questionType` field flows from `scraper.js` → `getAiAnswersForBatch` → `buildBatchPrompt`
- [ ] On a live multi-select question, AI panel shows multiple answers separated by ` /// `
- [ ] On a live multi-select question, `autoSelectOptionsInDom` selects all correct checkboxes and deselects stale ones
- [ ] No files outside the in-scope list are modified (`git status`)
- [ ] `plans/README.md` status row updated

---

## STOP conditions

- The code at the locations in "Current state" doesn't match the excerpts (codebase has drifted since this plan was written).
- A step's verification fails twice after a reasonable fix attempt.
- The fix appears to require touching an out-of-scope file.
- You discover that NetAcad's checkbox DOM uses a different tag than `mat-checkbox` or `input[type='checkbox']` — log the actual tag to console and report back before guessing.

---

## Maintenance notes

- If NetAcad migrates from Angular Material components to standard HTML inputs, the `detectMcqInputType` selector list in `ui.js` will need updating.
- `buildBatchPrompt` now accepts `questionType` per question — any future caller must populate this field; missing it defaults to `MCQ_SINGLE` which is safe but suboptimal.
- The deselect-before-select pass in Step 5 runs on every `autoSelectOptionsInDom` call for checkbox questions — if the AI returns a partial result (fewer answers than correct), some correct options will be deselected and not re-selected. Ensure the AI is returning all correct answers before relying on this.
