# Plan 014: Improve answer accuracy with richer context and stricter answer-matching

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
- **Risk**: LOW — prompt changes only; fallback behaviour unchanged
- **Depends on**: 012 (the `questionType` field added in plan 012 is used in Step 3 here; if 012 is not done, the `questionType` field will be absent and the hint will simply not be emitted, which is safe)
- **Category**: correctness / accuracy
- **Planned at**: commit `bed4361`, 2026-07-25

---

## Why this matters

Three independent issues reduce answer accuracy on single-select and multi-select quiz questions:

1. **Prompt does not tell the AI the course subject** (`api.js:39`). The system prompt says "Cisco CCNA networking expert" even for Python/PCAP/CyberOps modules. The AI applies networking domain knowledge when python-specific disambiguation is needed, causing wrong answers on non-networking quizzes.

2. **Option text normalization strips too aggressively** (`ui.js:783–791`). `cleanOptionTextForMatch` removes leading numbering and letter prefixes. If the AI returns `"4. option text"`, the `cleanOptionPrefix` in `api.js:360–364` strips the `4.` — good. But if the **option label itself starts with a number** (e.g. `"128 bits"`, `"10.0.0.1"`), the normalizer also strips the leading number leaving `". bits"` or an empty prefix match — the score check at line 905 then fails and no option is clicked.

3. **Score threshold of 70 is too low** (`ui.js:927`). The substring-contains fallback at score 80 (`cand.alphaText.includes(targetAlpha)`) will match partial option text — e.g. `"local area network"` will match target `"area"` — producing wrong clicks with no warning.

---

## Current state

### Relevant files

- `api.js` — system prompt builders and answer post-processing
- `ui.js` — `cleanOptionTextForMatch`, `autoSelectOptionsInDom` scoring

### Key excerpts

**`api.js:39` — hard-coded course subject**
```js
  return `You are a Cisco CCNA networking expert. Analyze the question type...
```

**`api.js:360–365` — `cleanOptionPrefix`**
```js
function cleanOptionPrefix(str) {
  if (!str || typeof str !== "string") return str;
  const trimmed = str.trim();
  if (/^[A-Z]:\s+/i.test(trimmed)) return trimmed;
  return trimmed.replace(/^(?:[0-9]+|[a-zA-Z])[\.)\:\-]\s*/, "").replace(/^[\-\*]\s*/, "").trim();
}
```
This strips `"1. "`, `"A. "` etc — but also `"128. bits"` becomes `"bits"` if the text starts with `128.` (number followed by a dot and space).

**`ui.js:783–791` — `cleanOptionTextForMatch`**
```js
function cleanOptionTextForMatch(text) {
  if (!text || typeof text !== "string") return "";
  let clean = text.trim();
  clean = clean.replace(/^(?:ai\s*suggestions?:?|suggested\s*answers?:?|answers?:?)\s*/i, "").trim();
  const stripped = clean.replace(/^(?:[0-9]+|[a-zA-Z])[\.\)\:\-]\s*/, "").replace(/^[\-\*]\s*/, "").trim();
  const result = (stripped.length > 0 ? stripped : clean).toLowerCase();
  return result;
}
```

**`ui.js:905–916` — scoring (score 80 uses partial containment)**
```js
        } else {
          if (targetAlpha.length >= 2 && cand.alphaText.includes(targetAlpha)) {
            score = 85;
          } else if (cand.alphaText.length >= 2 && targetAlpha.includes(cand.alphaText)) {
            score = 80;  // option text is a substring of target — very broad
          }
        }
```

---

## Commands you will need

| Purpose | Command | Expected on success |
|---------|---------|---------------------|
| Validate JS syntax | `node --check api.js && node --check ui.js` | exit 0, no output |

---

## Scope

**In scope**:
- `api.js` — `buildSinglePrompt`, `buildBatchPrompt`, `cleanOptionPrefix`
- `ui.js` — `cleanOptionTextForMatch`, `autoSelectOptionsInDom` scoring section

**Out of scope**:
- `scraper.js`, `content.js`, `background.js`, `popup.js`, `manifest.json`

---

## Git workflow

- Branch: `advisor/014-answer-accuracy`
- Commit message: `fix: improve prompt context, option normalization, and match scoring accuracy`
- Do NOT push or open a PR unless instructed.

---

## Steps

### Step 1: Detect the course subject from the page title and inject it into prompts

In `api.js`, add a helper that reads the page title to infer the course subject for the system prompt:

```js
/**
 * Infer the course subject from the browser page title.
 * Returns a short string used in the system prompt to orient the AI.
 */
function inferCourseSubject() {
  try {
    if (typeof document === "undefined") return "Cisco networking";
    const title = (document.title || "").toLowerCase();
    if (title.includes("python") || title.includes("pcap") || title.includes("pcep")) return "Python programming";
    if (title.includes("cyber") || title.includes("security") || title.includes("ensa")) return "Cisco cybersecurity / ENSA";
    if (title.includes("devnet") || title.includes("devasc")) return "Cisco DevNet / network automation";
    if (title.includes("linux") || title.includes("ndc")) return "Linux / NDG";
    if (title.includes("itn") || title.includes("ccna")) return "Cisco CCNA networking";
    if (title.includes("srwe") || title.includes("ensa")) return "Cisco networking and security";
  } catch (_) {}
  return "Cisco networking";
}
```

Place this function before `buildSinglePrompt`.

**Verify**: `node --check api.js` → exit 0

### Step 2: Use the course subject in both prompt builders

In `buildSinglePrompt` (line 39), replace:
```js
  return `You are a Cisco CCNA networking expert. Analyze the question type and determine the correct answer.
```
with:
```js
  const subject = inferCourseSubject();
  return `You are an expert in ${subject}. Analyze the question type and determine the correct answer.
```

In `buildBatchPrompt` (line 78), replace:
```js
  return `You are a Cisco CCNA networking expert answering quiz questions.
```
with:
```js
  const subject = inferCourseSubject();
  return `You are an expert in ${subject} answering quiz questions.
```

**Verify**: `node --check api.js` → exit 0

### Step 3: Fix `cleanOptionPrefix` to not strip leading numeric values

The regex `/^(?:[0-9]+|[a-zA-Z])[\.)\:\-]\s*/` strips both `"4. "` (list prefix) and `"128. "` (a number that happens to be followed by a period). The fix: require the number prefix to be followed by `)` or `. ` (dot+space) AND be at most 2 digits — list items rarely exceed 99.

Replace `cleanOptionPrefix` in `api.js` (lines 360–365):
```js
function cleanOptionPrefix(str) {
  if (!str || typeof str !== "string") return str;
  const trimmed = str.trim();
  // Preserve object-matching pairs like "A: text" — never strip
  if (/^[A-Z]:\s+/i.test(trimmed)) return trimmed;
  // Only strip numbered list prefixes (1–2 digit number followed by ). or ]. or ): or -  then space)
  // NOT values like "128 bits", "10.0.0.1" etc.
  return trimmed
    .replace(/^\d{1,2}[\.\)\:\-]\s+/, "")  // "1. " "99) " etc — at most 2 digits
    .replace(/^[a-zA-Z][\.\)\:\-]\s+/, "") // "A. " "b) " etc — single letter
    .replace(/^[\-\*]\s+/, "")             // "- " "* " bullet points
    .trim();
}
```

Apply the same fix to `cleanOptionTextForMatch` in `ui.js` (lines 783–791):
```js
function cleanOptionTextForMatch(text) {
  if (!text || typeof text !== "string") return "";
  let clean = text.trim();
  // Strip AI panel prefixes
  clean = clean.replace(/^(?:ai\s*suggestions?:?|suggested\s*answers?:?|answers?:?)\s*/i, "").trim();
  // Strip list-item prefixes (1–2 digit number OR single letter, followed by separator + space)
  // Deliberately NOT matching 3+ digit numbers like "128" or IPs like "10.0.0.1"
  const stripped = clean
    .replace(/^\d{1,2}[\.\)\:\-]\s+/, "")
    .replace(/^[a-zA-Z][\.\)\:\-]\s+/, "")
    .replace(/^[\-\*]\s+/, "")
    .trim();
  const result = (stripped.length > 0 ? stripped : clean).toLowerCase();
  return result;
}
```

**Verify**: `node --check api.js && node --check ui.js` → exit 0

### Step 4: Raise score threshold and tighten partial-match scoring

In `ui.js`, in the `autoSelectOptionsInDom` scoring block (lines 898–943):

Current partial-match scoring:
```js
          if (targetAlpha.length >= 2 && cand.alphaText.includes(targetAlpha)) {
            score = 85;
          } else if (cand.alphaText.length >= 2 && targetAlpha.includes(cand.alphaText)) {
            score = 80;
          }
```

Replace with stricter containment thresholds. Require the shorter string to be at least 40% of the longer string's length to count as a meaningful substring match:
```js
          if (targetAlpha.length >= 4 && cand.alphaText.includes(targetAlpha)) {
            // target is a substring of candidate — strong signal
            score = 85;
          } else if (
            cand.alphaText.length >= 6 &&
            targetAlpha.length >= 6 &&
            cand.alphaText.length >= Math.floor(targetAlpha.length * 0.4) &&
            targetAlpha.includes(cand.alphaText)
          ) {
            // candidate text is a substantial portion of target — moderate signal
            score = 78;
          }
```

Also raise the minimum click threshold from `70` to `78` (two occurrences — line 927 and line 947):

Line 927: `if (!bestMatch || highestScore < 70) {` → `if (!bestMatch || highestScore < 78) {`
Line 947: `if (bestMatch && highestScore >= 70) {` → `if (bestMatch && highestScore >= 78) {`

**Verify**: `node --check ui.js` → exit 0

### Step 5: Add prompt guidance for numeric/IP/notation answers

In `buildBatchPrompt` in `api.js`, add this line to the CRITICAL INSTRUCTIONS block (after the existing notes about MCQ and OBJECT_MATCHING):

```
- For questions involving numbers, IP addresses, subnet masks, or technical notation: return the EXACT string as shown in the option list, including all digits, dots, slashes, and units. Do NOT paraphrase or round.
- For code snippet / math questions: carefully check return types (list vs tuple) and operators (e.g. x**x exponentiation vs x*x multiplication).
```

(The second bullet already exists — keep it and add the first bullet before it.)

Apply the same addition to the instructions block in `buildSinglePrompt`.

**Verify**: `node --check api.js` → exit 0

---

## Test plan

Manual verification:

1. Open a **Python/PCAP** NetAcad quiz. Check the console: the batch API call should log a system prompt starting with `"You are an expert in Python programming"`.
2. Open a **CCNA** quiz. System prompt should start with `"You are an expert in Cisco CCNA networking"`.
3. On a question whose options include values like `"128 bits"` or `"255.255.255.0"`, verify the AI-selected option is highlighted correctly (not an empty/wrong selection from over-stripping).
4. On a question where no option text matches the AI answer at all, verify **nothing is clicked** (no random wrong option highlighted).

---

## Done criteria

- [ ] `node --check api.js` exits 0
- [ ] `node --check ui.js` exits 0
- [ ] `inferCourseSubject` function exists in `api.js` before `buildSinglePrompt`
- [ ] Both `buildSinglePrompt` and `buildBatchPrompt` call `inferCourseSubject()`
- [ ] `cleanOptionPrefix` and `cleanOptionTextForMatch` use `\d{1,2}` (not `[0-9]+`) for list-prefix stripping
- [ ] Score threshold is `78` (not `70`) in both lines of `autoSelectOptionsInDom`
- [ ] No files outside the in-scope list are modified (`git status`)
- [ ] `plans/README.md` status row updated

---

## STOP conditions

- The code at the locations in "Current state" doesn't match the excerpts.
- A step's verification fails twice after a reasonable fix attempt.
- After raising the score threshold to 78, a known-working quiz question that previously matched no longer finds its option — investigate and report the actual option text vs AI answer before adjusting.

---

## Maintenance notes

- `inferCourseSubject` reads `document.title`. If NetAcad changes how course names appear in the title tag, this function will fall back to `"Cisco networking"` — safe but suboptimal. Extend the keyword list as new course types are encountered.
- The score threshold change (70→78) will cause more "Could not find any candidate" warnings on poorly-worded AI answers. This is intentional — a wrong click is worse than no click. Users can always manually select or use the Refresh button.
- The `\d{1,2}` regex for list prefixes means items numbered 100+ (rare in quizzes) will not have their prefix stripped. If a quiz has more than 99 options, extend to `\d{1,3}`.
