// Add running button and status banner styles to page head
const statusStyleEl = document.createElement("style");
statusStyleEl.textContent = `
  .netacad-running-btn {
    background-color: #177245 !important;
    border: 1px solid rgba(255, 255, 255, 0.35) !important;
    box-shadow: 0 2px 6px rgba(7, 28, 51, 0.18), 0 12px 28px rgba(7, 28, 51, 0.22) !important;
    min-width: 165px !important;
    width: auto !important;
    height: 42px !important;
    padding: 0 16px !important;
    border-radius: 999px !important;
    display: flex !important;
    align-items: center !important;
    justify-content: center !important;
    gap: 8px !important;
    font-size: 12px !important;
    font-weight: 700 !important;
    letter-spacing: 0.5px !important;
    color: #ffffff !important;
  }
  .netacad-running-dot {
    width: 9px;
    height: 9px;
    background-color: #ffffff;
    border-radius: 50%;
    display: inline-block;
  }
  .ai-running-banner {
    background: #e7f4ec;
    color: #1a1a1a;
    padding: 8px 12px;
    border-radius: 10px;
    margin-bottom: 10px;
    font-size: 12px;
    font-weight: 600;
    display: flex;
    align-items: center;
    gap: 8px;
    border: 1px solid #bfe3cd;
  }
  .ai-running-banner .netacad-running-dot {
    background-color: #166534;
  }
  @keyframes netacad-panel-in {
    from {
      opacity: 0;
      transform: translateY(4px);
    }
    to {
      opacity: 1;
      transform: translateY(0);
    }
  }
  .netacad-ai-assistant-ui {
    animation: netacad-panel-in 180ms ease-out;
  }
  @keyframes netacad-badge-settle {
    0% { transform: scale(1); }
    50% { transform: scale(1.08); }
    100% { transform: scale(1); }
  }
  .ai-badge-settle {
    animation: netacad-badge-settle 200ms ease-in-out;
  }
  @media (prefers-reduced-motion: reduce) {
    .netacad-ai-assistant-ui {
      animation: none !important;
    }
    .ai-badge-settle {
      animation: none !important;
    }
  }
`;
if (document.head) document.head.appendChild(statusStyleEl);
else document.addEventListener("DOMContentLoaded", () => document.head.appendChild(statusStyleEl));

const FLOATING_BTN_ID = "netacad-ai-floating-process-btn";
const FLOATING_BTN_IDLE_HTML = `<span style="position:relative;display:inline-flex;align-items:center;justify-content:center;line-height:1;font-size:13px;font-weight:750;letter-spacing:-0.01em;">AI<span style="position:absolute;top:-4px;right:-7px;width:7px;height:7px;border-radius:50%;background-color:#12a5d9;display:inline-block;pointer-events:none;"></span></span>`;

function injectFloatingButton() {
  if (window.top !== window) return; // top frame only
  if (document.getElementById(FLOATING_BTN_ID)) return;
  if (!document.body) {
    document.addEventListener("DOMContentLoaded", injectFloatingButton, { once: true });
    return;
  }

  const btn = document.createElement("button");
  btn.id = FLOATING_BTN_ID;
  btn.type = "button";
  btn.innerHTML = FLOATING_BTN_IDLE_HTML;
  btn.title = "Click to run Auto-Solve Quiz";
  btn.setAttribute("aria-label", "Run Auto-Solve Quiz");
  Object.assign(btn.style, {
    position: "fixed",
    right: "24px",
    bottom: "24px",
    left: "auto",
    top: "auto",
    zIndex: "2147483647",
    width: "46px",
    height: "46px",
    padding: "0",
    fontSize: "13px",
    fontWeight: "750",
    color: "#ffffff",
    backgroundColor: "#071c33",
    border: "1px solid rgba(255, 255, 255, 0.35)",
    borderRadius: "999px",
    boxShadow: "0 2px 6px rgba(7, 28, 51, 0.18), 0 12px 28px rgba(7, 28, 51, 0.22)",
    cursor: "grab",
    fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
    transition: "background-color 0.15s",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    lineHeight: "1",
    textAlign: "center",
    userSelect: "none",
    touchAction: "none",
  });

  btn.addEventListener("mouseover", () => {
    if (!btn.classList.contains("netacad-running-btn")) {
      btn.style.backgroundColor = "#0a294d";
    }
  });
  btn.addEventListener("mouseout", () => {
    if (!btn.classList.contains("netacad-running-btn")) {
      btn.style.backgroundColor = "#071c33";
    }
  });

  // --- Drag state ---
  const DRAG_THRESHOLD_PX = 4;
  let dragState = null;
  let suppressNextClick = false;

  function clampToViewport(x, y) {
    const w = btn.offsetWidth || 46;
    const h = btn.offsetHeight || 46;
    const maxX = Math.max(0, window.innerWidth - w);
    const maxY = Math.max(0, window.innerHeight - h);
    return [Math.min(Math.max(0, x), maxX), Math.min(Math.max(0, y), maxY)];
  }

  function applyPosition(x, y) {
    const [cx, cy] = clampToViewport(x, y);
    btn.style.left = cx + "px";
    btn.style.top = cy + "px";
    btn.style.right = "auto";
    btn.style.bottom = "auto";
  }

  chrome.storage.sync.get(["floatingBtnPos"], (res) => {
    const p = res.floatingBtnPos;
    if (p && typeof p.x === "number" && typeof p.y === "number") {
      applyPosition(p.x, p.y);
    } else {
      applyPosition(window.innerWidth - 180, window.innerHeight - 66);
    }
  });

  function onPointerDown(e) {
    if (e.button !== undefined && e.button !== 0) return;
    if (btn.setPointerCapture && e.pointerId != null) btn.setPointerCapture(e.pointerId);
    const rect = btn.getBoundingClientRect();
    dragState = {
      startX: e.clientX,
      startY: e.clientY,
      offsetX: e.clientX - rect.left,
      offsetY: e.clientY - rect.top,
      moved: false,
    };
    btn.style.cursor = "grabbing";
  }

  function onPointerMove(e) {
    if (!dragState) return;
    const dx = e.clientX - dragState.startX;
    const dy = e.clientY - dragState.startY;
    if (!dragState.moved && Math.hypot(dx, dy) < DRAG_THRESHOLD_PX) return;
    dragState.moved = true;
    applyPosition(e.clientX - dragState.offsetX, e.clientY - dragState.offsetY);
    e.preventDefault();
  }

  function onPointerUp() {
    if (!dragState) return;
    btn.style.cursor = "grab";
    if (dragState.moved) {
      suppressNextClick = true;
      const rect = btn.getBoundingClientRect();
      chrome.storage.sync.set({ floatingBtnPos: { x: rect.left, y: rect.top } });
    }
    dragState = null;
  }

  btn.addEventListener("pointerdown", onPointerDown);
  window.addEventListener("pointermove", onPointerMove);
  window.addEventListener("pointerup", onPointerUp);
  window.addEventListener("pointercancel", onPointerUp);

  window.addEventListener("resize", () => {
    const rect = btn.getBoundingClientRect();
    applyPosition(rect.left, rect.top);
  });

  btn.addEventListener("click", (ev) => {
    if (suppressNextClick) {
      suppressNextClick = false;
      ev.preventDefault();
      ev.stopPropagation();
      return;
    }
    const isAutoRunning = !!(window.isAutonomousRunning || globalThis.isAutonomousRunning);
    if (isAutoRunning) {
      const stopQuizFn = resolveFn("stopAutonomousLoop");
      if (stopQuizFn) stopQuizFn();
      return;
    }

    btn.disabled = true;
    btn.textContent = "...";

    chrome.runtime.sendMessage({ action: "broadcastProcessPage" }, () => {
      if (chrome.runtime.lastError) {
        console.debug("NetAcad Scraper: broadcast error", chrome.runtime.lastError.message);
        btn.textContent = "!";
      } else {
        btn.textContent = "AI";
      }
      setTimeout(() => {
        btn.disabled = false;
        updateFloatingButtonState();
      }, 1800);
    });
  });

  document.body.appendChild(btn);
  console.debug("NetAcad Scraper: Floating button injected on right.");
}

function updateFloatingButtonState() {
  const btn = document.getElementById(FLOATING_BTN_ID);
  const isAutoRunning = !!(window.isAutonomousRunning || globalThis.isAutonomousRunning);
  const isScrollRunning = !!(window.isCourseScrollerRunning || globalThis.isCourseScrollerRunning);
  const isPaused = !!(window.isAutonomousPaused || globalThis.isAutonomousPaused);

  if (btn) {
    if (isAutoRunning) {
      if (isPaused) {
        btn.className = "netacad-running-btn";
        btn.innerHTML = `<span class="netacad-running-dot"></span> PAUSED`;
        btn.style.setProperty("background-color", "#92400e", "important");
      } else {
        btn.className = "netacad-running-btn";
        btn.innerHTML = `<span class="netacad-running-dot"></span> AUTO-PILOT RUNNING...`;
        btn.style.setProperty("background-color", "#177245", "important");
      }
    } else if (isScrollRunning) {
      btn.className = "netacad-running-btn";
      btn.innerHTML = `<span class="netacad-running-dot"></span> SCROLLER RUNNING...`;
      btn.style.setProperty("background-color", "#177245", "important");
    } else {
      btn.className = "";
      btn.innerHTML = FLOATING_BTN_IDLE_HTML;
      btn.style.backgroundColor = "#071c33";
      btn.style.border = "1px solid rgba(255, 255, 255, 0.35)";
      btn.style.width = "46px";
      btn.style.minWidth = "";
      btn.style.height = "46px";
      btn.style.padding = "0";
      btn.style.borderRadius = "999px";
      btn.style.boxShadow = "0 2px 6px rgba(7, 28, 51, 0.18), 0 12px 28px rgba(7, 28, 51, 0.22)";
      btn.style.display = "flex";
      btn.style.alignItems = "center";
      btn.style.justifyContent = "center";
    }
  }

  // Update AI Assistant Panel Running Banners
  const banners = document.querySelectorAll(".ai-running-banner");
  banners.forEach((banner) => {
    if (isAutoRunning || isScrollRunning) {
      banner.style.display = "flex";
      let bannerText;
      if (isAutoRunning) {
        bannerText = "Quiz Auto-Pilot is Running... Please do not switch or close this tab!";
      } else {
        const cur = window.scrollerCurrentSection || globalThis.scrollerCurrentSection || 0;
        const tot = window.scrollerTotalSections  || globalThis.scrollerTotalSections  || 0;
        const progressStr = (cur > 0 && tot > 0) ? ` (${cur}/${tot})` : "";
        bannerText = `Course Scroller is Running${progressStr}... Please do not switch or close this tab!`;
      }
      banner.innerHTML = `<span class="netacad-running-dot"></span> ${bannerText}`;
    } else {
      banner.style.display = "none";
    }
  });
}

// Sync running status state continuously
setInterval(updateFloatingButtonState, 500);

// Warn user before leaving/closing tab if process is active
window.addEventListener("beforeunload", (e) => {
  const isAutoRunning = !!(window.isAutonomousRunning || globalThis.isAutonomousRunning);
  const isScrollRunning = !!(window.isCourseScrollerRunning || globalThis.isCourseScrollerRunning);

  if (isAutoRunning || isScrollRunning) {
    const confirmationMessage = "NetAcad Automation is currently active! Leaving or closing this tab will stop the process.";
    (e || window.event).returnValue = confirmationMessage;
    return confirmationMessage;
  }
});

let debounceTimeout;
function debouncedScrape() {
  clearTimeout(debounceTimeout);
  debounceTimeout = setTimeout(() => {
    chrome.storage.sync.get(["processOnSwitch"], (result) => {
      if (result.processOnSwitch === false) return;
      if (typeof window.scrapeData === "function") {
        window.scrapeData();
      }
    });
  }, 1500);
}

function initMutationObserver() {
  const appRoot = document.querySelector("app-root");
  if (!appRoot?.shadowRoot) return;
  const pageView = appRoot.shadowRoot.querySelector("page-view");
  if (!pageView?.shadowRoot) return;

  const observer = new MutationObserver((mutations) => {
    const isSelfMutation = mutations.every((m) => {
      return [...(m.addedNodes || []), ...(m.removedNodes || [])].every(
        (node) =>
          node.classList &&
          (node.classList.contains("netacad-ai-assistant-ui") || node.classList.contains("ai-status-badge"))
      );
    });
    if (!isSelfMutation) debouncedScrape();
  });

  observer.observe(pageView.shadowRoot, { childList: true, subtree: true });
}

const autoRunScraper = async () => {
  if (!document.querySelector("app-root")) return;

  if (document.readyState !== "complete") {
    await new Promise((resolve) => window.addEventListener("load", resolve, { once: true }));
  }

  await new Promise((resolve) => setTimeout(resolve, 500));

  const getCfgFn = typeof getProviderConfig === "function" ? getProviderConfig : (window.getProviderConfig || null);
  const cfg = getCfgFn ? await getCfgFn() : { apiKey: "" };
  const { showAnswers } = await chrome.storage.sync.get(["showAnswers"]);

  if (cfg.apiKey && showAnswers !== false) {
    if (typeof window.scrapeData === "function") {
      await window.scrapeData();
      initMutationObserver();
    }
  }
};

autoRunScraper();
injectFloatingButton();

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (!request || !request.action) return false;

  // ── Status Poll ──
  if (request.action === "getStatus") {
    const isAutoRunning = !!(window.isAutonomousRunning || globalThis.isAutonomousRunning);
    const isScrollRunning = !!(window.isCourseScrollerRunning || globalThis.isCourseScrollerRunning);
    const isPaused = !!(window.isAutonomousPaused || globalThis.isAutonomousPaused);
    const scrollCurrent = (window.scrollerCurrentSection || globalThis.scrollerCurrentSection) || 0;
    const scrollTotal   = (window.scrollerTotalSections  || globalThis.scrollerTotalSections)  || 0;
    sendResponse({ isAutoRunning, isScrollRunning, isPaused, scrollCurrent, scrollTotal });
    return true;
  }

  // ── Export Course Data ──
  if (request.action === "exportCourseData") {
    const exportFn = resolveFn("exportScrapedCourseData");
    if (exportFn) {
      exportFn(request.format || "markdown");
      sendResponse({ success: true });
    } else {
      sendResponse({ success: false, error: "exportScrapedCourseData not found" });
    }
    return true;
  }

  // ── Quiz Auto-Pilot ──
  if (request.action === "processPage") {
    if (!document.querySelector("app-root")) return false;

    if (request.showAnswers === false) {
      sendResponse({ success: true, result: false, message: "AI answers hidden by setting." });
      return false;
    }

    const autoLoopFn = resolveFn("runAutonomousLoop");
    const scrapeFn = resolveFn("scrapeData");

    const fn = autoLoopFn || scrapeFn;
    if (fn) {
      fn().then(() => {
        updateFloatingButtonState();
        sendResponse({ success: true });
      }).catch((err) => sendResponse({ success: false, error: String(err) }));
      return true; // async
    }
    sendResponse({ success: false, error: "scrapeData not found" });
    return false;
  }

  // ── Course Scroller ──
  if (request.action === "runCourseScroller") {
    const scrollerFn = resolveFn("runCourseScrollerLoop");
    if (scrollerFn) {
      scrollerFn();
      updateFloatingButtonState();
      sendResponse({ success: true });
    } else {
      sendResponse({ success: false, error: "runCourseScrollerLoop not found" });
    }
    return true;
  }

  // ── Stop All ──
  if (request.action === "stopAutoPilot") {
    const stopQuizFn = resolveFn("stopAutonomousLoop");
    const stopScrollFn = resolveFn("stopCourseScrollerLoop");
    if (stopQuizFn) stopQuizFn();
    if (stopScrollFn) stopScrollFn();
    updateFloatingButtonState();
    sendResponse({ success: true });
    return true;
  }

  // ── Pause / Resume ──
  if (request.action === "toggleAutoPilotPause") {
    const toggleFn = resolveFn("toggleAutonomousPause");
    if (toggleFn) {
      const result = toggleFn();
      updateFloatingButtonState();
      sendResponse({ success: true, isPaused: result.isPaused, isRunning: result.isRunning });
    } else {
      sendResponse({ success: false, error: "toggleAutonomousPause not found" });
    }
    return true;
  }

  return false;
});

// Helper — used above
function resolveFn(name) {
  if (typeof window !== "undefined" && typeof window[name] === "function") return window[name];
  if (typeof globalThis !== "undefined" && typeof globalThis[name] === "function") return globalThis[name];
  return null;
}