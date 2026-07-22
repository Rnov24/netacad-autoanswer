console.log("NetAcad AutoAnswer content script loaded and ready.");

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
    btn.style.backgroundColor = "#1d4ed8";
    btn.style.transform = "scale(1.08)";
  });
  btn.addEventListener("mouseout", () => {
    btn.style.backgroundColor = "#2563eb";
    btn.style.transform = "scale(1)";
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
      applyPosition(window.innerWidth - 66, window.innerHeight - 66);
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
    const original = btn.textContent;
    btn.disabled = true;
    btn.textContent = "⚡";

    // Trigger quiz auto-pilot via background broadcast
    chrome.runtime.sendMessage({ action: "broadcastProcessPage" }, () => {
      if (chrome.runtime.lastError) {
        console.debug("NetAcad Scraper: broadcast error", chrome.runtime.lastError.message);
        btn.textContent = "✗";
      } else {
        btn.textContent = "✓";
      }
      setTimeout(() => {
        btn.textContent = original;
        btn.disabled = false;
      }, 1800);
    });
  });

  document.body.appendChild(btn);
  console.debug("NetAcad Scraper: Floating button injected.");
}

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
    // Ignore mutations caused by our own AI UI panels
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
      fn().then(() => sendResponse({ success: true })).catch((err) => sendResponse({ success: false, error: String(err) }));
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
    sendResponse({ success: true });
    return true;
  }

  // ── Pause / Resume ──
  if (request.action === "toggleAutoPilotPause") {
    const toggleFn = resolveFn("toggleAutonomousPause");
    if (toggleFn) {
      const result = toggleFn();
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
