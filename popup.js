document.addEventListener("DOMContentLoaded", () => {
  const providerSelect   = document.getElementById("aiProvider");
  const apiKeyLabel      = document.getElementById("apiKeyLabel");
  const apiKeyInput      = document.getElementById("apiKey");
  const mercuryApiKeyInput = document.getElementById("mercuryApiKey");
  const modelSelect      = document.getElementById("modelSelect");
  const customModelGroup = document.getElementById("customModelGroup");
  const customModelInput = document.getElementById("customModelInput");
  const saveBtn          = document.getElementById("saveKey");
  const processPageBtn   = document.getElementById("processPage");
  const autoScrollBtn    = document.getElementById("autoScrollBtn");
  const pauseBtn         = document.getElementById("pauseBtn");
  const stopBtn          = document.getElementById("stopBtn");
  const statusDiv        = document.getElementById("status");

  const autoSelectToggle        = document.getElementById("autoSelectToggle");
  const autoSubmitToggle        = document.getElementById("autoSubmitToggle");
  const showAnswersToggle       = document.getElementById("showAnswersToggle");
  const processOnSwitchToggle   = document.getElementById("processOnSwitchToggle");
  const useDecisionModelToggle  = document.getElementById("useDecisionModelToggle");

  const MODEL_PRESETS = {
    gemini: [
      { value: "gemini-3.6-flash",       label: "gemini-3.6-flash (default)" },
      { value: "gemini-3.5-flash",       label: "gemini-3.5-flash" },
      { value: "gemini-3.5-flash-lite",  label: "gemini-3.5-flash-lite" },
      { value: "gemini-3.1-pro-preview", label: "gemini-3.1-pro-preview" },
    ],
    groq: [
      { value: "llama-3.3-70b-versatile",       label: "llama-3.3-70b (default)" },
      { value: "llama-3.1-8b-instant",          label: "llama-3.1-8b-instant" },
      { value: "openai/gpt-oss-120b",           label: "gpt-oss-120b" },
      { value: "deepseek-r1-distill-llama-70b", label: "deepseek-r1-llama-70b" },
    ],
    openai: [
      { value: "gpt-4o-mini",     label: "gpt-4o-mini (default)" },
      { value: "gpt-4o",          label: "gpt-4o" },
      { value: "gpt-5.6-terra",   label: "gpt-5.6-terra" },
      { value: "o4-mini",         label: "o4-mini" },
      { value: "o3-mini",         label: "o3-mini" },
    ],
    anthropic: [
      { value: "claude-3-5-haiku-latest",  label: "claude-3.5-haiku (default)" },
      { value: "claude-3-7-sonnet-latest", label: "claude-3.7-sonnet" },
      { value: "claude-sonnet-5",          label: "claude-sonnet-5" },
      { value: "claude-opus-4-8",          label: "claude-opus-4.8" },
    ],
    openrouter: [
      { value: "inception/mercury-decide:free",      label: "mercury-decide:free (Decision Model)" },
      { value: "inception/mercury-decide",           label: "mercury-decide (Decision Model)" },
      { value: "google/gemini-2.5-flash",           label: "gemini-2.5-flash (default)" },
      { value: "openai/gpt-4o-mini",                label: "gpt-4o-mini" },
      { value: "anthropic/claude-3.7-sonnet",       label: "claude-3.7-sonnet" },
      { value: "meta-llama/llama-3.3-70b-instruct", label: "llama-3.3-70b" },
      { value: "deepseek/deepseek-chat",            label: "deepseek-v3" },
      { value: "deepseek/deepseek-r1",              label: "deepseek-r1" },
    ],
  };

  const PROVIDER_LABELS = {
    gemini: "Gemini", groq: "Groq", openai: "OpenAI",
    anthropic: "Claude (Anthropic)", openrouter: "OpenRouter",
  };

  let storage = {};

  // ── Update provider-specific UI ──
  function updateProviderUI(provider) {
    apiKeyLabel.textContent = `${PROVIDER_LABELS[provider] || provider} API Key`;
    apiKeyInput.placeholder = `Enter ${PROVIDER_LABELS[provider] || provider} API Key`;
    apiKeyInput.value = storage[`${provider}ApiKey`] || "";

    modelSelect.innerHTML = "";
    (MODEL_PRESETS[provider] || []).forEach(({ value, label }) => {
      const opt = document.createElement("option");
      opt.value = value; opt.textContent = label;
      modelSelect.appendChild(opt);
    });

    const customOpt = document.createElement("option");
    customOpt.value = "custom";
    customOpt.textContent = "Custom model (type manually)";
    modelSelect.appendChild(customOpt);

    const saved = storage[`${provider}Model`];
    if (saved) {
      const isPreset = (MODEL_PRESETS[provider] || []).some((o) => o.value === saved);
      if (isPreset) {
        modelSelect.value = saved;
        customModelGroup.style.display = "none";
        customModelInput.value = "";
      } else {
        modelSelect.value = "custom";
        customModelInput.value = saved;
        customModelGroup.style.display = "block";
      }
    } else {
      modelSelect.value = (MODEL_PRESETS[provider] || [])[0]?.value || "custom";
      customModelGroup.style.display = "none";
      customModelInput.value = "";
    }
  }

  // ── Load stored settings ──
  const KEYS = [
    "aiProvider",
    "geminiApiKey", "geminiModel",
    "groqApiKey", "groqModel",
    "openaiApiKey", "openaiModel",
    "anthropicApiKey", "anthropicModel",
    "openrouterApiKey", "openrouterModel",
    "mercuryApiKey",
    "autoSelect", "autoSubmit", "showAnswers", "processOnSwitch",
    "useDecisionModelForMcq",
  ];

  chrome.storage.sync.get(KEYS, (res) => {
    storage = res || {};
    if (res.aiProvider) providerSelect.value = res.aiProvider;
    updateProviderUI(providerSelect.value);

    if (mercuryApiKeyInput) {
      mercuryApiKeyInput.value = res.mercuryApiKey || "";
    }

    autoSelectToggle.checked       = res.autoSelect             !== false;
    autoSubmitToggle.checked       = res.autoSubmit             === true;
    showAnswersToggle.checked      = res.showAnswers            !== false;
    processOnSwitchToggle.checked  = res.processOnSwitch        !== false;
    if (useDecisionModelToggle) {
      useDecisionModelToggle.checked = res.useDecisionModelForMcq === true;
    }
  });

  providerSelect.addEventListener("change", () => updateProviderUI(providerSelect.value));

  modelSelect.addEventListener("change", () => {
    if (modelSelect.value === "custom") {
      customModelGroup.style.display = "block";
      customModelInput.focus();
    } else {
      customModelGroup.style.display = "none";
    }
  });

  // Persist toggles immediately on change
  autoSelectToggle.addEventListener("change",      () => chrome.storage.sync.set({ autoSelect: autoSelectToggle.checked }));
  autoSubmitToggle.addEventListener("change",      () => chrome.storage.sync.set({ autoSubmit: autoSubmitToggle.checked }));
  showAnswersToggle.addEventListener("change",     () => chrome.storage.sync.set({ showAnswers: showAnswersToggle.checked }));
  processOnSwitchToggle.addEventListener("change", () => chrome.storage.sync.set({ processOnSwitch: processOnSwitchToggle.checked }));
  if (useDecisionModelToggle) {
    useDecisionModelToggle.addEventListener("change", () => chrome.storage.sync.set({ useDecisionModelForMcq: useDecisionModelToggle.checked }));
  }

  // Persist Mercury API key immediately on change
  if (mercuryApiKeyInput) {
    mercuryApiKeyInput.addEventListener("change", () => {
      const val = mercuryApiKeyInput.value.trim();
      storage.mercuryApiKey = val;
      chrome.storage.sync.set({ mercuryApiKey: val }, () => {
        if (val) {
          setStatus("Mercury API key saved.", "#177245");
        } else {
          setStatus("Mercury API key cleared.", "#52677d");
        }
      });
    });
  }

  function pollTabStatus() {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (!tabs.length || !tabs[0].id) return;
      chrome.tabs.sendMessage(tabs[0].id, { action: "getStatus" }, (res) => {
        if (chrome.runtime.lastError || !res) return;
        const textEl = document.getElementById("popupStatusText");
        const dotEl = document.getElementById("popupStatusDot");
        const badgeEl = document.getElementById("popupStatusBadge");
        if (!textEl || !dotEl) return;

        if (res.isAutoRunning) {
          if (res.isPaused) {
            textEl.textContent = "Auto-Pilot Paused";
            if (badgeEl) badgeEl.style.color = "#92400e";
            dotEl.style.background = "#92400e";
          } else {
            textEl.textContent = "Auto-Pilot Active";
            if (badgeEl) badgeEl.style.color = "#177245";
            dotEl.style.background = "#177245";
          }
        } else if (res.isScrollRunning) {
          textEl.textContent = "Course Scroller Active";
          if (badgeEl) badgeEl.style.color = "#177245";
          dotEl.style.background = "#177245";
        } else {
          textEl.textContent = "Ready";
          if (badgeEl) badgeEl.style.color = "#b9cce0";
          dotEl.style.background = "#52677d";
        }
      });
    });
  }

  pollTabStatus();
  setInterval(pollTabStatus, 1000);

  // ── Status helpers ──
  let statusTimer;
  function setStatus(msg, color = "#52677d", duration = 3500) {
    clearTimeout(statusTimer);
    statusDiv.style.color = color;
    statusDiv.textContent = msg;
    if (duration > 0) statusTimer = setTimeout(() => (statusDiv.textContent = ""), duration);
  }

  // ── Send message to active tab content script ──
  function sendToTab(msg, onResponse) {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (!tabs.length || !tabs[0].id) {
        setStatus("No active tab found. Open a NetAcad page and try again.", "#8f1d14");
        return;
      }
      chrome.tabs.sendMessage(tabs[0].id, msg, (res) => {
        if (chrome.runtime.lastError) {
          setStatus(`Could not reach the NetAcad tab. Reload the page and try again. (${chrome.runtime.lastError.message})`, "#8f1d14");
        } else if (onResponse) {
          onResponse(res);
        }
      });
    });
  }

  // ── Save Settings ──
  saveBtn.addEventListener("click", () => {
    const provider   = providerSelect.value;
    const apiKey     = apiKeyInput.value.trim();
    const mercuryKey = mercuryApiKeyInput ? mercuryApiKeyInput.value.trim() : "";
    let model        = modelSelect.value;

    if (apiKey) {
      if (model === "custom") {
        model = customModelInput.value.trim();
        if (!model) {
          setStatus("Please enter a custom model name.", "#8f1d14", 3000);
          return;
        }
      }
    }

    if (!apiKey && !mercuryKey) {
      setStatus(`Please enter a ${PROVIDER_LABELS[provider]} API key.`, "#8f1d14", 3000);
      return;
    }

    const saveObj = {
      mercuryApiKey: mercuryKey,
      autoSelect: autoSelectToggle.checked,
      autoSubmit: autoSubmitToggle.checked,
      showAnswers: showAnswersToggle.checked,
      processOnSwitch: processOnSwitchToggle.checked,
      useDecisionModelForMcq: useDecisionModelToggle ? useDecisionModelToggle.checked : false,
    };

    if (apiKey) {
      saveObj.aiProvider = provider;
      saveObj[`${provider}ApiKey`] = apiKey;
      saveObj[`${provider}Model`] = model;
      storage[`${provider}ApiKey`] = apiKey;
      storage[`${provider}Model`]  = model;
    }

    storage.mercuryApiKey = mercuryKey;
    if (useDecisionModelToggle) {
      storage.useDecisionModelForMcq = useDecisionModelToggle.checked;
    }

    chrome.storage.sync.set(saveObj, () => {
      const successMsg = (!apiKey && mercuryKey) ? "Mercury API key saved." : "Settings saved.";
      setStatus(successMsg, "#177245");
      saveBtn.style.backgroundColor = "#e7f4ec";
      saveBtn.style.color = "#166534";
      setTimeout(() => {
        saveBtn.style.backgroundColor = "";
        saveBtn.style.color = "";
      }, 1200);
    });
  });

  // ── Auto-Solve Quiz ──
  processPageBtn.addEventListener("click", () => {
    setStatus("Starting Quiz Auto-Pilot...", "#52677d", 0);
    sendToTab({ action: "processPage", showAnswers: showAnswersToggle.checked }, (res) => {
      if (res?.success) setStatus("Quiz Auto-Pilot running", "#177245");
      else setStatus(res?.error || "Could not start Quiz Auto-Pilot.", "#8f1d14");
    });
  });

  // ── Auto-Scroll & Complete Module ──
  autoScrollBtn.addEventListener("click", () => {
    setStatus("Starting Course Scroller...", "#52677d", 0);
    sendToTab({ action: "runCourseScroller" }, (res) => {
      if (res?.success) setStatus("Course Scroller running", "#177245");
      else setStatus(res?.error || "Could not start Course Scroller.", "#8f1d14");
    });
  });

  // ── Pause / Resume ──
  pauseBtn.addEventListener("click", () => {
    sendToTab({ action: "toggleAutoPilotPause" }, (res) => {
      if (res?.isPaused) {
        pauseBtn.textContent = "Resume";
        pauseBtn.style.background = "";
        setStatus("Paused", "#92400e");
      } else {
        pauseBtn.textContent = "Pause";
        pauseBtn.style.background = "";
        setStatus("Resumed", "#177245");
      }
    });
  });

  // ── Stop ──
  stopBtn.addEventListener("click", () => {
    sendToTab({ action: "stopAutoPilot" }, () => {
      pauseBtn.textContent = "Pause";
      pauseBtn.style.background = "";
      setStatus("Stopped", "#8f1d14");
    });
  });

  // ── Export Course Data ──
  const exportMdBtn = document.getElementById("exportMdBtn");
  const exportJsonBtn = document.getElementById("exportJsonBtn");

  if (exportMdBtn) {
    exportMdBtn.addEventListener("click", () => {
      setStatus("Exporting Markdown data...", "#52677d", 2000);
      sendToTab({ action: "exportCourseData", format: "markdown" });
    });
  }

  if (exportJsonBtn) {
    exportJsonBtn.addEventListener("click", () => {
      setStatus("Exporting JSON data...", "#52677d", 2000);
      sendToTab({ action: "exportCourseData", format: "json" });
    });
  }
});