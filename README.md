![ccnap_resize](https://github.com/user-attachments/assets/0cb6200c-c304-42fa-ad0f-fa68fa0c4fac)

# NetAcad AI Assistant

NetAcad AI Assistant is a browser extension (Manifest V3) for Cisco NetAcad that automatically solves quiz questions using multi-provider AI APIs (Google Gemini, Groq, OpenAI, Anthropic Claude, OpenRouter) and automatically scrolls/completes course material sub-modules.

## Features

- **Multi-Provider AI Engine with Native Structured Output**:
  - Supports Google Gemini, Groq (ultra-fast), OpenAI (ChatGPT), Anthropic Claude, and OpenRouter.
  - Native JSON Mode (`response_format: { type: "json_object" }` & `responseMimeType: "application/json"`) for 100% predictable AI parsing.
  - AI Question Type Analysis (`MCQ_SINGLE`, `MCQ_MULTIPLE`, `OBJECT_MATCHING`, `FILL_IN_BLANK`).
- **Auto-Solve Quiz 🚀**:
  - Scrapes multiple-choice and Object-Matching questions from NetAcad shadow DOM trees (`app-root` → `page-view` → `article-view` → `block-view` → `mcq-view` / `object-matching-view`).
  - Batches questions per page into single AI requests with LRU caching for high speed and cost efficiency.
  - **Sequential Navigation**: Follows a strict **Answer → Submit → Next** sequence without out-of-order tab jumping.
  - **Object-Matching Suggestion Mode**: Displays matched pairs (`A: text /// B: text`) directly in the UI panel for student review without auto-filling or prematurely submitting drag-and-drop fields.
- **Auto-Scroll & Complete Module 📜**:
  - Smoothly scrolls reading pages to trigger read-completion tracking.
  - Fast-forwards embedded `<video>` elements to the final second to mark 100% completion in the LMS.
  - Traverses 3-Level Table of Contents (Module → Section → Level-3 Sub-Topic) and automatically navigates to incomplete topics.
- **Pause & Stop Controls**: Pause ⏸️ or Stop ⏹️ active loops directly from the popup UI or content script interface.
- **Floating AI Button & Keyboard Shortcut**: Draggable floating action button on NetAcad pages, or press **Alt+Shift+Q** (**Option+Shift+Q** on Mac).

## Technology Stack

- **JavaScript (Vanilla ES6+)** — No heavy build step or npm bundlers required.
- **Chrome Extension API (Manifest V3)**
- **Shadow DOM Traversal & MutationObserver** for dynamic page scraping.
- **Multi-Provider AI Integration** (Gemini, Groq, OpenAI, Anthropic, OpenRouter).

## Installation & Setup

1. **Clone or Download** this repository:
   ```bash
   git clone https://github.com/Rnov24/netacad-autoanswer.git
   ```
2. **Load Extension in Chrome**:
   - Navigate to `chrome://extensions/`.
   - Enable **Developer mode** (top-right toggle).
   - Click **Load unpacked** and select the `netacad-autoanswer` directory.
3. **Configure API Key**:
   - Click the extension icon in Chrome toolbar.
   - Select your preferred AI Provider (e.g. Gemini, Groq, OpenAI, Claude).
   - Enter your API key and click **Save Settings**.
4. **Run on NetAcad**:
   - Open any Cisco NetAcad quiz or course module page.
   - Click **Auto-Solve Quiz 🚀** to solve and submit quiz questions.
   - Click **Auto-Scroll & Complete Module 📜** to fast-forward videos and complete reading topics.

## Privacy & Security

- API keys are stored strictly in local browser storage (`chrome.storage.sync`) and are only sent directly to the selected AI provider endpoint over HTTPS.
- No personal user data or credentials are collected or forwarded to third-party tracking servers.

## Contributing

Contributions are welcome! Please refer to [CONTRIBUTING.md](CONTRIBUTING.md) for architecture details, coding guidelines, and pull request procedures.

## License

MIT License. See [LICENSE](LICENSE) for details.
