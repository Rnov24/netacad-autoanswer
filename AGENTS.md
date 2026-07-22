# AGENTS.md — NetAcad AI Assistant

## Project Overview
Chrome Extension (Manifest V3) that auto-answers Cisco NetAcad quizzes using multi-provider AI APIs and auto-scrolls course modules to mark them 100% complete.

## File Map
| File | Role |
|---|---|
| `manifest.json` | MV3 manifest; content scripts load in order: `api.js` → `ui.js` → `scraper.js` → `content.js` |
| `api.js` | Multi-provider AI engine (Gemini, Groq, OpenAI, Anthropic, OpenRouter) with Structured Output (JSON mode) and AI Question Type Analysis; exports `getAiAnswer`, `getAiAnswersForBatch` |
| `ui.js` | DOM scraping, Shadow DOM traversal, Object-Matching UI panel display, video fast-forward, 3-level ToC parser, UI panel injection |
| `scraper.js` | Orchestration loops: Quiz Auto-Pilot (`runAutonomousLoop` with sequential Answer → Submit → Next flow) and Course Scroller (`runCourseScrollerLoop`); exports control functions |
| `content.js` | Entry point; floating draggable button injection, mutation observer, message listener for runtime actions |
| `background.js` | Background service worker; listens for keyboard shortcut (`Alt+Shift+Q`) and relays messages to tabs |
| `popup.html` / `popup.js` | Popup interface; handles provider selection, API key storage (`chrome.storage.sync`), mode toggles, and action triggers |

## Key Architecture & Constraints
- **MV3 Content Script Restrictions:** Content scripts cannot use ES `import`/`export`. Functions are exposed via `window` / `globalThis` assignment and resolved dynamically via `resolveFn("functionName")`.
- **Shadow DOM Traversal:** NetAcad pages heavily use Shadow DOM (`app-root` → `page-view` → `article-view` → `block-view` → `mcq-view` / `object-matching-view`). Always traverse `shadowRoot` properties.
- **XSS Prevention:** Never pass AI API response strings directly to `innerHTML`. Use `buildAnswerNode()` or `textContent` / `createTextNode()`.
- **Structured Outputs**: API requests pass native JSON mode parameters (`response_format: { type: "json_object" }` / `responseMimeType: "application/json"`) and parse via `safeParseJsonResponse`.
- **Sequential Navigation**: Quiz Auto-Pilot follows a strict **Answer → Submit → Next** sequence using Next navigation controls without Q-tab jumps.
- **Matching Question Suggestion Mode**: Object-Matching questions display suggested pairs in the UI panel without auto-filling or auto-submitting.
- **No Build Step:** All code is native vanilla ES6 JavaScript loaded directly by Chrome.

## How to Load and Test
1. Open Chrome and navigate to `chrome://extensions`.
2. Enable "Developer mode" (top right toggle).
3. Click "Load unpacked" and select the `netacad-autoanswer` directory.
4. Open a NetAcad quiz or course page.
5. Click the extension popup to set an API key and run either **Auto-Solve Quiz 🚀** or **Auto-Scroll & Complete Module 📜**.

## Coding Guidelines
- Place helper functions before their call sites or export them via module export objects.
- Keep `console.debug` for trace logging and `console.error` for caught exceptions.
- Ensure state flags (`isAutonomousRunning`, `isScrapeInFlight`, `isCourseScrollerRunning`) are properly reset in `finally` blocks.
