document.addEventListener("DOMContentLoaded", () => {
  const providerSelect   = document.getElementById("aiProvider");
  const apiKeyLabel      = document.getElementById("apiKeyLabel");
  const apiKeyInput      = document.getElementById("apiKey");
  const modelSelect      = document.getElementById("modelSelect");
  const customModelGroup = document.getElementById("customModelGroup");
  const customModelInput = document.getElementById("customModelInput");
  const saveBtn          = document.getElementById("saveKey");
  const processPageBtn   = document.getElementById("processPage");
  const autoScrollBtn    = document.getElementById("autoScrollBtn");
  const pauseBtn         = document.getElementById("pauseBtn");
  const stopBtn          = document.getElementById("stopBtn");
  const statusDiv        = document.getElementById("status");

  const autoSelectToggle      = document.getElementById("autoSelectToggle");
  const autoSubmitToggle      = document.getElementById("autoSubmitToggle");
  const showAnswersToggle     = document.getElementById("showAnswersToggle");
  const processOnSwitchToggle = document.getElementById("processOnSwitchToggle");

  const MODEL_PRESETS = {
    gemini: [
      { value: "gemini-1.5-flash",   label: "gemini-1.5-flash (default)" },
      { value: "gemini-2.0-flash",   label: "gemini-2.0-flash" },
      { value: "gemini-1.5-pro",     label: "gemini-1.5-pro" },
    ],
    groq: [
      { value: "llama-3.3-70b-versatile",       label: "llama-3.3-70b (default)" },
      { value: "deepseek-r1-distill-llama-70b", label: "deepseek-r1-llama-70b" },
      { value: "mixtral-8x7b-32768",            label: "mixtral-8x7b" },
    ],
    openai: [
      { value: "gpt-4o-mini", label: "gpt-4o-mini (default)" },
      { value: "gpt-4o",      label: "gpt-4o" },
      { value: "o3-mini",     label: "o3-mini" },
    ],
    anthropic: [
      { value: "claude-3-5-haiku-latest",  label: "claude-3.5-haiku (default)" },
      { value: "claude-3-5-sonnet-latest", label: "claude-3.5-sonnet" },
      { value: "claude-3-opus-latest",     label: "claude-3-opus" },
    ],
    openrouter: [
      { value: "openai/gpt-4o-mini",                     label: "gpt-4o-mini (default)" },
      { value: "anthropic/claude-3.5-sonnet",            label: "claude-3.5-sonnet" },
      { value: "google/gemini-2.5-flash",                label: "gemini-2.5-flash" },
      { value: "meta-llama/llama-3.3-70b-instruct",      label: "llama-3.3-70b" },
      { value: "deepseek/deepseek-r1",                   label: "deepseek-r1" },
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
    customOpt.textContent = "✨ Custom Model (Type manually)";
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
    "autoSelect", "autoSubmit", "showAnswers", "processOnSwitch",
  ];

  chrome.storage.sync.get(KEYS, (res) => {
    storage = res || {};
    if (res.aiProvider) providerSelect.value = res.aiProvider;
    updateProviderUI(providerSelect.value);

    autoSelectToggle.checked      = res.autoSelect      !== false;
    autoSubmitToggle.checked      = res.autoSubmit      === true;
    showAnswersToggle.checked     = res.showAnswers     !== false;
    processOnSwitchToggle.checked = res.processOnSwitch !== false;
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

  // ── Status helpers ──
  let statusTimer;
  function setStatus(msg, color = "#38bdf8", duration = 3500) {
    clearTimeout(statusTimer);
    statusDiv.style.color = color;
    statusDiv.textContent = msg;
    if (duration > 0) statusTimer = setTimeout(() => (statusDiv.textContent = ""), duration);
  }

  // ── Send message to active tab content script ──
  function sendToTab(msg, onResponse) {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (!tabs.length || !tabs[0].id) {
        setStatus("Error: Active tab not found.", "#f87171");
        return;
      }
      chrome.tabs.sendMessage(tabs[0].id, msg, (res) => {
        if (chrome.runtime.lastError) {
          setStatus(`Error: ${chrome.runtime.lastError.message}`, "#f87171");
        } else if (onResponse) {
          onResponse(res);
        }
      });
    });
  }

  // ── Save Settings ──
  saveBtn.addEventListener("click", () => {
    const provider = providerSelect.value;
    const apiKey   = apiKeyInput.value.trim();
    let model      = modelSelect.value;

    if (model === "custom") {
      model = customModelInput.value.trim();
      if (!model) {
        setStatus("Please enter a custom model name.", "#f87171", 3000);
        return;
      }
    }

    if (!apiKey) {
      setStatus(`Please enter a ${PROVIDER_LABELS[provider]} API key.`, "#f87171", 3000);
      return;
    }

    const saveObj = {
      aiProvider: provider,
      [`${provider}ApiKey`]: apiKey,
      [`${provider}Model`]: model,
      autoSelect: autoSelectToggle.checked,
      autoSubmit: autoSubmitToggle.checked,
      showAnswers: showAnswersToggle.checked,
      processOnSwitch: processOnSwitchToggle.checked,
    };

    storage[`${provider}ApiKey`] = apiKey;
    storage[`${provider}Model`]  = model;

    chrome.storage.sync.set(saveObj, () => setStatus("Settings saved ✓", "#34d399"));
  });

  // ── Auto-Solve Quiz ──
  processPageBtn.addEventListener("click", () => {
    setStatus("Starting Quiz Auto-Pilot...", "#38bdf8", 0);
    sendToTab({ action: "processPage", showAnswers: showAnswersToggle.checked }, (res) => {
      if (res?.success) setStatus("Quiz Auto-Pilot running 🚀", "#34d399");
      else setStatus(res?.error || "Could not start Quiz Auto-Pilot.", "#f87171");
    });
  });

  // ── Auto-Scroll & Complete Module ──
  autoScrollBtn.addEventListener("click", () => {
    setStatus("Starting Course Scroller...", "#a855f7", 0);
    sendToTab({ action: "runCourseScroller" }, (res) => {
      if (res?.success) setStatus("Course Scroller running 📜", "#a855f7");
      else setStatus(res?.error || "Could not start Course Scroller.", "#f87171");
    });
  });

  // ── Pause / Resume ──
  pauseBtn.addEventListener("click", () => {
    sendToTab({ action: "toggleAutoPilotPause" }, (res) => {
      if (res?.isPaused) {
        pauseBtn.textContent = "Resume ▶️";
        pauseBtn.style.background = "#059669";
        setStatus("Paused ⏸️", "#f59e0b");
      } else {
        pauseBtn.textContent = "Pause ⏸️";
        pauseBtn.style.background = "";
        setStatus("Resumed ▶️", "#34d399");
      }
    });
  });

  // ── Stop ──
  stopBtn.addEventListener("click", () => {
    sendToTab({ action: "stopAutoPilot" }, () => {
      pauseBtn.textContent = "Pause ⏸️";
      pauseBtn.style.background = "";
      setStatus("Stopped ⏹️", "#f87171");
    });
  });
});
