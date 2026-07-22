# Plan 006: Fix the Object-Matching / Connecting Question Pipeline End-to-End

> **Executor instructions**: Follow this plan step by step. Run every verification
> command and confirm the expected result before moving to the next step. STOP
> conditions are real escape hatches — if you hit one, stop and report; do not
> improvise. When done, update the status row in `plans/README.md`.
>
> **Drift check (run first)**:
> ```
> git diff --stat ba71b0f..HEAD -- ui.js api.js scraper.js
> ```
> If any of those files changed since this plan was written, compare the
> "Current state" excerpts below against the live code before proceeding.
> Any mismatch is a STOP condition.

## Status

- **Priority**: P1
- **Effort**: M (half day)
- **Risk**: LOW — changes are confined to matching-specific code paths; MCQ path is untouched
- **Depends on**: none (plans 001–005 are independent; apply them first if they are still TODO)
- **Category**: bug / correctness
- **Planned at**: commit `ba71b0f`, 2026-07-21

## Why this matters

The Object-Matching ("connecting") question type is fully implemented but unreliable
in practice. Category letters are extracted with a fragile selector chain that silently
degrades to an index-based fallback (`String.fromCharCode(65+i)`), which breaks any
time the DOM order differs from the A/B/C/D label order. Option selection uses a
bidirectional substring match that picks unintended elements (e.g. a short label
"IPv4" matches any longer card that contains "IPv4"). After a click sequence there is
no verification that the connection was registered — silent failures produce a partial
score with no user feedback. Fixing these three root causes makes the matching type
as reliable as the MCQ type.

## The Object-Matching Pipeline (every layer)

The data flows through five stages. All five need coordinated changes.

```
[1] DOM extraction       extractMatchingQuestion()        ui.js:198-250
[2] Prompt building      scraper.js:197 + api.js:37-56    scraper.js / api.js
[3] AI response          AI returns "A: text /// B: text"
[4] Pair parsing         processMatchingPairsSequentially  ui.js:352-389
[5] DOM click            findExactMatchingElements +       ui.js:282-350
                         dispatchFullClickSequence
```

## Current state

### Stage 1: extractMatchingQuestion (`ui.js:198-250`)

Category letter extraction (current, ~line 225-232):

```js
categoryEls.forEach((btn, i) => {
  const textEl = btn.querySelector(".category-item-text, [class*='text']") || btn;
  const numEl  = btn.querySelector(".category-item-number, [class*='number'], [class*='letter']") || btn;

  const text   = textEl.innerText.trim();
  const letter = numEl.innerText.trim() || String.fromCharCode(65 + i);   // BUG: fallback uses DOM index
  if (text && !categories.some((c) => c.letter === letter)) {
    categories.push({ text, letter, element: btn });
  }
});
```

Problem: `numEl.innerText.trim()` often returns "A." or the full card text when no
precise sub-element is found. The fallback index (65+i = 'A', 'B', ...) doesn't
survive reordered DOM.

Also, the broad `[class*='category']` and `[class*='option']` selectors can match
navigation elements, headers, or any element that happens to contain those words in
a class name.

### Stage 2: Prompt — scraper.js (~line 197)

```js
const formattedQuestion = `MATCHING QUESTION. ${m.questionText}\nCategories: ${
  m.categories.map((c) => `${c.letter}=${c.text}`).join(" | ")
}\nOptions: ${
  m.options.map((o, i) => `${i+1}=${o.text}`).join(" | ")
}`;
```

Options are numbered (1=, 2=) but the AI output format asks for letter prefix (A:).
This works most of the time by implication but is ambiguous — the AI can mix up
which index belongs to which letter.

### Stage 4: Pair parsing — processMatchingPairsSequentially (`ui.js:352-389`)

```js
const parts = pair.split(":");
if (parts.length < 2) continue;
const categoryLetter = parts[0].trim().toUpperCase();
const targetOptionText = parts.slice(1).join(":").trim().toLowerCase();
```

This is structurally correct but depends on the AI using `A:` as a prefix rather
than `"A → text"` or `"Category A: text"`.

### Stage 5: findExactMatchingElements (`ui.js:282-350`)

Option fuzzy match (current, ~line 321-331):

```js
for (const optCard of optCards) {
  const fullText = (optCard.innerText || "").trim().toLowerCase();
  if (fullText && (
    fullText === targetOptionText ||
    fullText.includes(targetOptionText) ||
    targetOptionText.includes(fullText)   // BUG: picks any card that is a substr of target
  )) { ... }
}
```

After clicking, no verification that the connection was accepted.

## Scope

**In scope** (only files you should modify):
- `ui.js` — stages 1, 4, 5
- `api.js` — stage 2 prompt
- `scraper.js` — stage 2 question formatting

**Out of scope** (do NOT touch):
- MCQ (non-matching) code paths in any of the above files
- `content.js`, `background.js`, `popup.html`, `popup.js`

## Steps

### Step 1: Harden category letter extraction in `extractMatchingQuestion` (`ui.js`)

**Goal**: extract only the single-character (or short) label from the circle element,
not the full card text. Normalise to strip trailing punctuation.

Locate `extractMatchingQuestion` (~line 198). Inside the `categoryEls.forEach`,
replace the letter extraction block with:

```js
categoryEls.forEach((btn, i) => {
  // Prefer a dedicated circle/number/letter child; fall back to reading
  // the first text-only leaf whose content is a single letter.
  const textEl = btn.querySelector(
    ".category-item-text, [class*='text']:not([class*='number']):not([class*='letter'])"
  ) || btn;

  // Try dedicated label selectors first
  let rawLetter = "";
  const numEl = btn.querySelector(
    ".category-item-number, .category-number, .category-letter, " +
    "[class*='number'], [class*='letter'], [class*='circle']"
  );
  if (numEl) {
    rawLetter = numEl.innerText.trim();
  }

  // Strip trailing punctuation (e.g. "A." → "A", "A:" → "A")
  rawLetter = rawLetter.replace(/[^A-Za-z0-9]/g, "").trim();

  // If still empty or more than 2 chars (picked up full card text), scan leaf nodes
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
```

**Verify**: After the change, `grep -n "String.fromCharCode(65 + i)" ui.js` should
return at most one match (inside `extractMatchingQuestion`), and it is now only
reached when the leaf-node scan also fails — a genuine last resort.

### Step 2: Fix the option fuzzy match to prefer exact/prefix, not bidirectional substring

**Goal**: prevent short option texts (like "IPv4") from matching long card text that
contains them, while still handling minor whitespace/capitalisation differences.

In `findExactMatchingElements` (~line 317), replace the option search loop:

```js
for (const optCard of optCards) {
  const fullText = (optCard.innerText || "").trim().toLowerCase();
  if (!fullText) continue;

  // Priority 1: exact match
  const isExact = fullText === targetOptionText;
  // Priority 2: target is a leading prefix of the card text (handles trailing metadata)
  const isPrefix = fullText.startsWith(targetOptionText);
  // Priority 3: card text is contained within the target (long target, short card label)
  //   — ONLY when the card text is at least 6 chars to avoid short-label false-positives
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
```

Also apply the same priority ordering to the fallback scan (~line 333-346):

```js
if (!exactOptionNode) {
  const candidates = Array.from(sr.querySelectorAll("div, p, span, button, label"));
  for (const el of candidates) {
    const txt = (el.innerText || "").trim().toLowerCase();
    if (!txt) continue;
    const isExact    = txt === targetOptionText;
    const isPrefix   = txt.startsWith(targetOptionText);
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
```

**Verify**: `grep -n "targetOptionText.includes(fullText)" ui.js` returns 0 matches
(the bidirectional include is replaced everywhere in `findExactMatchingElements`).

### Step 3: Add post-click verification and retry in `processMatchingPairsSequentially`

**Goal**: detect when a click silently failed (the connection indicator did not appear)
and retry once with a longer delay, then log clearly if it still fails.

How to detect failure: after clicking, check whether either the category or the option
element gained a class that NetAcad uses to signal "connected" state. Common patterns:
`is-connected`, `selected`, `matched`, `active`, `correct`. Also check if the element's
`aria-pressed` or `aria-selected` became `"true"`.

Replace the body of the pair execution in `processMatchingPairsSequentially`
(~line 363-388) with:

```js
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
    // Retry once with a longer settle gap
    console.debug(`NetAcad AutoAnswer: No connection signal detected for '${categoryLetter}'; retrying...`);
    await new Promise((res) => setTimeout(res, 500));
    dispatchFullClickSequence(exactCategoryClickTarget);
    await new Promise((res) => setTimeout(res, 400));
    dispatchFullClickSequence(exactOptionClickTarget);
    await new Promise((res) => setTimeout(res, 400));
  }

  // Green highlight (success visual regardless — NetAcad may not expose a class signal)
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
```

**Verify**: `grep -n "Could not find exact DOM targets" ui.js` returns 0 matches
(the old warn string is replaced with the new, richer message).

### Step 4: Fix the AI prompt to make the expected output format unambiguous

**Goal**: the prompt in `api.js:buildSinglePrompt` (and the batch variant) should tell
the AI to use the exact category letters from the question, numbered 1/2/3 to avoid
confusion, and output `A: <exact option text> /// B: <exact option text>`.

In `api.js`, `buildSinglePrompt` (~line 37-56), replace the matching branch:

```js
if (isMatching) {
  return `You are a Cisco CCNA networking expert solving an Object-Matching / Connecting question.

Question:
${question}

Available items:
${answers.map((a) => `- ${a}`).join("\n")}

INSTRUCTIONS:
1. Match each category circle (A, B, C, D, …) with exactly one option item.
2. Output ALL pairs on ONE line using this EXACT format, nothing else:
   A: <exact option text> /// B: <exact option text> /// C: <exact option text>
3. Use the exact option text as listed above — do not paraphrase.
4. Do not include explanations, numbering, or extra text.

Example:
A: user EXEC mode /// B: privileged EXEC mode /// C: global configuration mode`;
}
```

In `api.js`, `buildBatchPrompt` (~line 76-80), update the matching block:

```js
if (isMatching) {
  return `[QUESTION ${idx + 1}] (MATCHING/CONNECTING — output format: A: text /// B: text /// C: text)
${q.question}
Items:
${q.answers.map((a) => `- ${a}`).join("\n")}`;
}
```

And update the batch CRITICAL INSTRUCTIONS comment at ~line 98:

```js
- For MATCHING/CONNECTING: output ALL pairs on one line:
  'A: <exact option text> /// B: <exact option text> /// C: <exact option text>'
  Use the exact text from the items list. No paraphrasing.
```

**Verify**: `grep -n "MATCHING/ORDERING" api.js` returns 0 matches (old label replaced
with MATCHING/CONNECTING everywhere).

### Step 5: Fix the category formatting in scraper.js to be unambiguous

**Goal**: when building the question string for the AI, explicitly tell the model which
letter maps to which category, and use the word "Options" for the draggable choices.

In `scraper.js` (~line 197), replace the matching question formatter:

```js
const formattedQuestion = `MATCHING QUESTION. ${m.questionText}
Category circles (you must match each letter):
${m.categories.map((c) => `  ${c.letter}: ${c.text}`).join("\n")}
Available option items (match each circle to one of these):
${m.options.map((o) => `  - ${o.text}`).join("\n")}`;
```

Also update the `answers` array sent to the AI — remove the `[CATEGORY A]` /
`[OPTION N]` tags since the formatted question now contains all context, and these
tags caused some models to try to output the tags in their answers:

```js
allQuestionsData.push({
  question: formattedQuestion,
  answers: m.options.map((o) => o.text),   // plain option texts only
  mcqViewElement,
  originalIndex: index,
});
```

**Verify**:
- `grep -n "\[CATEGORY" scraper.js` returns 0 matches in the matching branch.
- `grep -n "\[OPTION" scraper.js` returns 0 matches in the matching branch.

## Done criteria

- [ ] `grep -n "String.fromCharCode(65 + i)" ui.js` — result shows the fallback is only reached after the leaf-scan is exhausted (≤1 match inside `extractMatchingQuestion`, in the fallback `else`)
- [ ] `grep -n "targetOptionText.includes(fullText)" ui.js` returns 0 matches
- [ ] `grep -n "MATCHING/ORDERING" api.js` returns 0 matches
- [ ] `grep -n "\[CATEGORY" scraper.js` returns 0 matches in the matching question push block
- [ ] `grep -n "Could not find exact DOM targets" ui.js` returns 0 matches (old warn replaced)
- [ ] Only `ui.js`, `api.js`, `scraper.js` are modified (`git status`)
- [ ] `plans/README.md` status row updated to DONE

## STOP conditions

Stop and report (do not improvise) if:

- The code at any of the "Current state" locations does not match the excerpts — the codebase has drifted; compare carefully before any edit.
- `findExactMatchingElements` has been moved out of `ui.js` to a different file.
- The `answers` array in the `allQuestionsData.push({...})` block is used anywhere other than being passed to the AI prompt — dropping the `[CATEGORY]`/`[OPTION]` tags must not break any other code path.
- You discover that `baseView.shadowRoot` is used inside `findExactMatchingElements` but is not passed in — the function only receives `sr` (the `omvElement.shadowRoot`).

## Maintenance notes

- NetAcad may change the shadow DOM class names for the matching component at any time. When the extension breaks on connecting questions, `findExactMatchingElements` is the first place to inspect — add the new class names to the selector lists there.
- The retry logic in Step 3 uses class-name detection for "connected" state. If NetAcad uses a different signal (e.g. removing a class or toggling an attribute), add that detection condition alongside the existing checks — do not replace the existing ones.
- The 350/400ms delays in Step 3 are conservative. If NetAcad's matching UI is sluggish on slow machines, increase the first delay before the option click. If it is fast, reducing the delay speeds up the full loop without risk.
- The prompt change in Step 4 is strictly additive for the single-provider path. The batch path shares the same output-format constraint. If a new AI provider is added to `api.js` in the future, ensure `buildBatchPrompt` handles it the same way.
