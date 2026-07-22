# Plan 002: Eliminate XSS vectors from AI response injection via innerHTML

> **Executor instructions**: Follow this plan step by step. Run every verification
> command and confirm the expected result before moving to the next step. If anything
> in the "STOP conditions" section occurs, stop and report — do not improvise. When
> done, update the status row in `plans/README.md`.
>
> **Drift check (run first)**: `grep -n "innerHTML" d:\Projects\netacad-autoanswer\ui.js`
> Expected: 4 matches near lines 868, 870, 961, 963. If line numbers differ
> significantly, compare the excerpts below before proceeding.

## Status

- **Priority**: P1
- **Effort**: S (< 2 hours)
- **Risk**: LOW — purely substitutes safe DOM API calls for innerHTML; no logic change
- **Depends on**: none
- **Category**: security
- **Planned at**: commit `ba71b0f`, 2026-07-21

## Why this matters

`ui.js` sets `aiAnswerDisplay.innerHTML` using text that comes directly from AI
API responses (`rawAiResponse`, `preFetchedAiAnswer`). While these values are
fetched by the extension itself from the configured AI provider, a compromised or
malicious AI response containing HTML (e.g. `<img src=x onerror=alert(1)>`) would
execute in the shadow DOM context of the NetAcad page. The fix is to use the DOM
API to build the HTML structure rather than injecting a raw HTML string.

## Current state

File: `d:\Projects\netacad-autoanswer\ui.js`

Four call sites (confirm line numbers against live file):

```js
// Site A — handleRefreshAction, multi-answer branch (~line 868):
aiAnswerDisplay.innerHTML = "<b>AI Suggestions:</b><br />- " + individualAnswers.join("<br />- ");

// Site B — handleRefreshAction, single-answer branch (~line 870):
aiAnswerDisplay.innerHTML = `<b>AI Suggestion:</b> ${rawAiResponse}`;

// Site C — processSingleQuestion, multi-answer branch (~line 961):
aiAnswerDisplay.innerHTML = "<b>AI Suggestions:</b><br />- " + individualAnswers.join("<br />- ");

// Site D — processSingleQuestion, single-answer branch (~line 963):
aiAnswerDisplay.innerHTML = `<b>AI Suggestion:</b> ${preFetchedAiAnswer}`;
```

The `aiAnswerDisplay` element is a `<div>` created by `createAiAssistantUI()` at
~line 50-62 of `ui.js`. It has no children at render time.

## Scope

**In scope**:
- `ui.js` — the 4 innerHTML call sites listed above

**Out of scope** (do NOT touch):
- `popup.js:61` — `modelSelect.innerHTML = ""` is safe (no user or AI content)
- `scraper.js`, `content.js`, `api.js`, `background.js`

## Steps

### Step 1: Create a helper function buildAnswerNode

Add this helper function near the top of `ui.js` (before `createAiAssistantUI`,
or immediately after it — before the first usage):

```js
function buildAnswerNode(labelText, answers) {
  const wrapper = document.createDocumentFragment();
  const label = document.createElement("b");
  label.textContent = labelText;
  wrapper.appendChild(label);

  if (answers.length === 1) {
    wrapper.appendChild(document.createTextNode(" " + answers[0]));
  } else {
    answers.forEach((ans) => {
      wrapper.appendChild(document.createElement("br"));
      wrapper.appendChild(document.createTextNode("- " + ans));
    });
  }
  return wrapper;
}
```

**Verify**: The function exists in `ui.js`. It uses only `createElement`,
`createTextNode`, `createDocumentFragment`, and `appendChild` — no `innerHTML`.

### Step 2: Replace all 4 innerHTML sites

Replace each innerHTML assignment using the helper. The logic to split on
`" /// "` is already present at each site — keep that split logic, just
swap the output method.

**Site A** (handleRefreshAction, multi-answer):

Old:
```js
aiAnswerDisplay.innerHTML = "<b>AI Suggestions:</b><br />- " + individualAnswers.join("<br />- ");
```
New:
```js
aiAnswerDisplay.textContent = "";
aiAnswerDisplay.appendChild(buildAnswerNode("AI Suggestions:", individualAnswers));
```

**Site B** (handleRefreshAction, single-answer):

Old:
```js
aiAnswerDisplay.innerHTML = `<b>AI Suggestion:</b> ${rawAiResponse}`;
```
New:
```js
aiAnswerDisplay.textContent = "";
aiAnswerDisplay.appendChild(buildAnswerNode("AI Suggestion:", [rawAiResponse]));
```

**Site C** (processSingleQuestion, multi-answer):
Same substitution as Site A, using `preFetchedAiAnswer` split result.

**Site D** (processSingleQuestion, single-answer):
Same substitution as Site B, using `preFetchedAiAnswer`.

**Verify**: `grep -n "innerHTML" d:\Projects\netacad-autoanswer\ui.js`
Expected: only the safe `modelSelect.innerHTML = ""` in popup.js remains
(that file is not in scope here). `ui.js` should have 0 innerHTML matches.

## Done criteria

- [ ] `grep -n "innerHTML" ui.js` returns 0 matches
- [ ] `buildAnswerNode` is defined before its first usage in `ui.js`
- [ ] Visual spot-check: load extension, trigger a question, confirm the AI
      answer panel shows bold label and answer text (no regression)
- [ ] Only `ui.js` is modified
- [ ] `plans/README.md` status updated

## STOP conditions

- `aiAnswerDisplay` is found to be a non-div element that does not support `appendChild`
- The `individualAnswers` array construction logic at any site is more complex
  than a simple `.split(" /// ").filter(Boolean)` (stop and check before adapting the helper)

## Maintenance notes

- If answer display formatting needs richer HTML in future (e.g. links, code blocks),
  use `DOMParser` or `Sanitizer API` — not raw `innerHTML`
- The `autoSelectButton` click handler in `processSingleQuestion` reads
  `aiAnswerDisplay.innerText` — this will still work correctly after the change
