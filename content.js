// Add pulse animations and status banner styles to page head
const statusStyleEl = document.createElement("style");
statusStyleEl.textContent = `
  @keyframes netacad-pulse-glow {
    0% { box-shadow: 0 0 8px rgba(16, 185, 129, 0.6); transform: scale(1); }
    50% { box-shadow: 0 0 22px rgba(16, 185, 129, 1); transform: scale(1.04); }
    100% { box-shadow: 0 0 8px rgba(16, 185, 129, 0.6); transform: scale(1); }
  }
  @keyframes netacad-dot-blink {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.3; }
  }
  .netacad-running-btn {
    animation: netacad-pulse-glow 2s infinite ease-in-out !important;
    background-color: #059669 !important;
    border-color: #34d399 !important;
    min-width: 165px !important;
    width: auto !important;
    height: 42px !important;
    padding: 0 16px !important;
    border-radius: 24px !important;
    display: flex !important;
    align-items: center !important;
    justify-content: center !important;
    gap: 8px !important;
    font-size: 12px !important;
    font-weight: 700 !important;
    letter-spacing: 0.5px !important;
  }
  .netacad-running-dot {
    width: 9px;
    height: 9px;
    background-color: #34d399;
    border-radius: 50%;
    display: inline-block;
    animation: netacad-dot-blink 1.2s infinite ease-in-out;
  }
  .ai-running-banner {
    background: linear-gradient(135deg, #065f46 0%, #047857 100%);
    color: #ecfdf5;
    padding: 8px 12px;
    border-radius: 6px;
    margin-bottom: 10px;
    font-size: 12px;
    font-weight: 600;
    display: flex;
    align-items: center;
    gap: 8px;
    border: 1px solid #10b981;
    box-shadow: 0 2px 8px rgba(16, 185, 129, 0.2);
  }
`;
if (document.head) document.head.appendChild(statusStyleEl);
else document.addEventListener("DOMContentLoaded", () => document.head.appendChild(statusStyleEl));

const FLOATING_BTN_ID = "netacad-ai-floating-process-btn";

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
  btn.textContent = "AI";
  btn.title = "Click to run Auto-Solve Quiz";
  Object.assign(btn.style, {
    position: "fixed",
    right: "24px",
    bottom: "24px",
    left: "auto",
    top: "auto",
    zIndex: "2147483647",
    width: "42px",
    height: "42px",
    padding: "0",
    fontSize: "14px",
    fontWeight: "700",
    color: "#ffffff",
    backgroundColor: "#2563eb",
    border: "2px solid rgba(255, 255, 255, 0.3)",
    borderRadius: "50%",
    boxShadow: "0 4px 16px rgba(0, 0, 0, 0.4)",
    cursor: "grab",
    fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
    transition: "background-color 0.15s, transform 0.15s, box-shadow 0.15s",
    lineHeight: "38px",
    textAlign: "center",
    userSelect: "none",
    touchAction: "none",
  });

  btn.addEventListener("mouseover", () => {
    if (!btn.classList.contains("netacad-running-btn")) {
      btn.style.backgroundColor = "#1d4ed8";
      btn.style.transform = "scale(1.08)";
    }
  });
  btn.addEventListener("mouseout", () => {
    if (!btn.classList.contains("netacad-running-btn")) {
      btn.style.backgroundColor = "#2563eb";
      btn.style.transform = "scale(1)";
    }
  });

  // --- Drag state ---
  const DRAG_THRESHOLD_PX = 4;
  let dragState = null;
  let suppressNextClick = false;

  function clampToViewport(x, y) {
    const w = btn.offsetWidth || 42;
    const h = btn.offsetHeight || 42;
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

    const original = btn.textContent;
    btn.disabled = true;
    btn.textContent = "⚡";

    chrome.runtime.sendMessage({ action: "broadcastProcessPage" }, () => {
      if (chrome.runtime.lastError) {
        console.debug("NetAcad Scraper: broadcast error", chrome.runtime.lastError.message);
        btn.textContent = "✗";
      } else {
        btn.textContent = "✓";
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
        btn.className = "";
        btn.innerHTML = `<span class="netacad-running-dot" style="background-color:#fbbf24"></span> ⏸ PAUSED`;
        btn.style.backgroundColor = "#d97706";
      } else {
        btn.className = "netacad-running-btn";
        btn.innerHTML = `<span class="netacad-running-dot"></span> ⚡ AUTO-PILOT RUNNING...`;
      }
    } else if (isScrollRunning) {
      btn.className = "netacad-running-btn";
      btn.innerHTML = `<span class="netacad-running-dot"></span> 📜 SCROLLER RUNNING...`;
    } else {
      btn.className = "";
      btn.innerHTML = "AI";
      btn.style.backgroundColor = "#2563eb";
      btn.style.width = "42px";
      btn.style.height = "42px";
      btn.style.padding = "0";
      btn.style.borderRadius = "50%";
      btn.style.boxShadow = "0 4px 16px rgba(0, 0, 0, 0.4)";
    }
  }

  // Update AI Assistant Panel Running Banners
  const banners = document.querySelectorAll(".ai-running-banner");
  banners.forEach((banner) => {
    if (isAutoRunning || isScrollRunning) {
      banner.style.display = "flex";
      banner.innerHTML = `<span class="netacad-running-dot"></span> ${
        isAutoRunning ? "⚡ Quiz Auto-Pilot is Running... Please do not switch or close this tab!" : "📜 Course Scroller is Running... Please do not switch or close this tab!"
      }`;
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
    sendResponse({ isAutoRunning, isScrollRunning, isPaused });
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
