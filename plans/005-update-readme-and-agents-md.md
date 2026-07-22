# Plan 005: Update README and add AGENTS.md for accurate documentation

> **Executor instructions**: Follow this plan step by step. Update `plans/README.md`
> when done.
>
> **Drift check**: `Get-Content d:\Projects\netacad-autoanswer\README.md | Select-Object -First 20`
> Confirm the file starts with the heading "NetAcad Assistant".

## Status

- **Priority**: P2
- **Effort**: S (< 2 hours)
- **Risk**: LOW — documentation only; no code changes
- **Depends on**: none
- **Category**: dx / docs
- **Planned at**: commit `ba71b0f`, 2026-07-21

## Why this matters

The README describes the extension as Gemini-only, mentions "Process Questions on
this Page" as the main button (removed in favour of "Auto-Solve Quiz"), lists
Object-Matching / Course Scroller / Pause-Resume-Stop / 3-level ToC as "planned
improvements" even though they are fully implemented. New users and contributors
reading the README get a misleading picture of the extension's actual capabilities.

There is also no `AGENTS.md` file, which means AI coding assistants (and future
contributors using them) have no machine-readable guidance on architecture, Chrome
MV3 constraints, shadow DOM conventions, or how to test changes.

## Current state

File: `d:\Projects\netacad-autoanswer\README.md`

- Line 5: describes extension as Gemini-only ("Google Gemini AI")
- Line 37: instructs users to click "Process Questions on this Page" (button renamed)
- Line 42: claims manual processing; omits Quiz Auto-Pilot and Course Scroller
- Lines 56-68: "Planned Improvements" lists matching questions and visibility toggle
  as unimplemented — both are now fully implemented

File: `d:\Projects\netacad-autoanswer\CONTRIBUTING.md`

- Line 6: describes `api.js` as "Gemini API integration only"
- Line 13: self-references as `COLLABORATION.md` (wrong filename)

No `AGENTS.md` exists in the repository root.
No `.env.example` file exists.

## Scope

**In scope**:
- `README.md` — rewrite to match v2.0 reality
- `CONTRIBUTING.md` — fix file description and self-reference
- `AGENTS.md` — create new file at repo root
- `.env.example` — create new file at repo root (storage key reference only)

**Out of scope** (do NOT touch):
- Any `.js` file
- `manifest.json`
- `popup.html` / `popup.js`

## Steps

### Step 1: Rewrite README.md

Replace the "What Does It Do?", "How to Install and Use", and "Planned Improvements"
sections to reflect current v2.0 capabilities. Key points to include:

**"What Does It Do?" section** — document:
- Multi-provider AI support (Gemini, Groq, OpenAI, Anthropic, OpenRouter)
- Auto-Solve Quiz (answers MCQ + Object-Matching, submits per-question, navigates Q-tabs, submits final assessment)
- Course Scroller (fast-forwards videos to last second, smooth-scrolls pages, navigates 3-level ToC)
- Pause / Resume / Stop controls for both modes
- Floating draggable AI button on pages (Alt+Shift+Q shortcut)
- Answer caching within a session to reduce API calls

**"How to Install and Use" section** — update button name from "Process Questions"
to "Auto-Solve Quiz 🚀" and document the Course Scroller button.

**"Planned Improvements" section** — remove already-implemented items (matching,
visibility toggle). Only list genuinely future work.

**Verify**: `Select-String -Path d:\Projects\netacad-autoanswer\README.md -Pattern "Process Questions on this Page"`
Should return 0 matches.

### Step 2: Fix CONTRIBUTING.md

- Line 6: change "Gemini API integration" to "Multi-provider AI engine (Gemini, Groq, OpenAI, Anthropic, OpenRouter)"
- Line 13: change `COLLABORATION.md` to `CONTRIBUTING.md`
- Add a brief description of `scraper.js` (Quiz Auto-Pilot + Course Scroller) and `ui.js` (DOM interaction + Shadow DOM scraping)

**Verify**: `Select-String -Path d:\Projects\netacad-autoanswer\CONTRIBUTING.md -Pattern "COLLABORATION"`
Should return 0 matches.

### Step 3: Create AGENTS.md at repo root

Create `d:\Projects\netacad-autoanswer\AGENTS.md` with the following sections:

```markdown
# AGENTS.md — NetAcad AutoAnswer

## Project overview
Chrome Extension (Manifest V3) that auto-answers Cisco NetAcad quizzes using
AI APIs and auto-scrolls course modules to mark them complete.

## File map
| File | Role |
|---|---|
| `manifest.json` | MV3 manifest; content scripts load in order: api → ui → scraper → content |
| `api.js` | Multi-provider AI engine; exports: getAiAnswer, getAiAnswersForBatch |
| `ui.js` | DOM scraping + UI injection; exports 20+ functions onto window/globalThis |
| `scraper.js` | Orchestration loops (quiz + course scroller); exports runAutonomousLoop, runCourseScrollerLoop |
| `content.js` | Entry point; wires chrome.runtime.onMessage to scraper/ui functions; injects floating button |
| `background.js` | Service worker; relays keyboard shortcut → broadcastProcessPage to all frames |
| `popup.html/js` | Extension popup; settings persistence to chrome.storage.sync |

## Key constraints
- **MV3 content scripts cannot use ES modules**. Functions are shared by assigning
  to `window` and `globalThis`. All inter-file calls go through `resolveFn()`.
- **Shadow DOM is everywhere**. NetAcad uses `app-root > page-view > article-view >
  block-view > mcq-view` custom elements with shadowRoots. Always traverse shadowRoot.
- **Never use innerHTML with external data**. Use `textContent` or `createTextNode`.
- **No npm/build step**. All files are loaded raw by Chrome. No bundler.

## How to load and test
1. Go to `chrome://extensions` → Enable Developer Mode → Load Unpacked → select repo folder
2. Navigate to netacad.com quiz page
3. Click popup → enter API key → click "Auto-Solve Quiz"
4. To reload after edits: click the Reload icon on the extension card

## Coding conventions
- Functions exported across files go in the relevant file's `exportsList` object
- Use `resolveFn("functionName")` to call across file boundaries safely
- Keep `console.debug` for trace-level logs; `console.log` for user-visible events
- Error strings passed to processSingleQuestion must start with "Error:" to be
  detected by the badge styling logic
```

**Verify**: `Test-Path d:\Projects\netacad-autoanswer\AGENTS.md` → True

### Step 4: Create .env.example

Create `d:\Projects\netacad-autoanswer\.env.example` with storage-key comments only:

```
# NetAcad AutoAnswer — chrome.storage.sync keys
# Copy this file to .env.example; actual keys are stored in Chrome extension storage,
# not in environment variables. This file documents what keys exist for reference.

# aiProvider = gemini | groq | openai | anthropic | openrouter
# geminiApiKey = <your Google AI Studio key>
# groqApiKey = <your Groq API key>
# openaiApiKey = <your OpenAI API key>
# anthropicApiKey = <your Anthropic API key>
# openrouterApiKey = <your OpenRouter API key>
# geminiModel = gemini-1.5-flash
# groqModel = llama-3.3-70b-versatile
# openaiModel = gpt-4o-mini
# anthropicModel = claude-3-5-haiku-latest
# openrouterModel = openai/gpt-4o-mini
# autoSelect = true
# autoSubmit = false
# showAnswers = true
# processOnSwitch = true
```

**Verify**: `Test-Path d:\Projects\netacad-autoanswer\.env.example` → True

## Done criteria

- [ ] README no longer references "Process Questions on this Page" button
- [ ] README documents all 5 AI providers
- [ ] README documents Quiz Auto-Pilot and Course Scroller
- [ ] CONTRIBUTING.md has no "COLLABORATION" references
- [ ] `AGENTS.md` exists at repo root with all 4 sections
- [ ] `.env.example` exists at repo root
- [ ] No `.js` files modified
- [ ] `plans/README.md` status updated

## STOP conditions

- README is empty or missing (would indicate wrong directory)

## Maintenance notes

- When new features are added, update both `README.md` (user-facing) and
  `AGENTS.md` (contributor-facing) in the same PR
