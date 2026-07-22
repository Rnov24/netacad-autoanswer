function broadcastProcessPageToTab(tabId) {
  chrome.storage.sync.get(["showAnswers"], (result) => {
    const showAnswers = typeof result.showAnswers === "boolean" ? result.showAnswers : true;
    const msg = { action: "processPage", showAnswers };

    if (chrome.webNavigation) {
      chrome.webNavigation.getAllFrames({ tabId }, (frames) => {
        if (frames && frames.length > 0) {
          frames.forEach((frame) => {
            chrome.tabs.sendMessage(tabId, msg, { frameId: frame.frameId }, () => {
              void chrome.runtime.lastError;
            });
          });
        } else {
          chrome.tabs.sendMessage(tabId, msg, () => {
            void chrome.runtime.lastError;
          });
        }
      });
    } else {
      chrome.tabs.sendMessage(tabId, msg, () => {
        void chrome.runtime.lastError;
      });
    }
  });
}

chrome.commands.onCommand.addListener((command) => {
  if (command === "process-page-command") {
    console.log("Command received: process-page-command");
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs.length > 0 && tabs[0].id) {
        broadcastProcessPageToTab(tabs[0].id);
      }
    });
  }
});

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request && request.action === "broadcastProcessPage") {
    const tabId = sender.tab && sender.tab.id;
    if (tabId) {
      broadcastProcessPageToTab(tabId);
      sendResponse({ success: true });
    } else {
      sendResponse({ success: false, error: "No tab ID" });
    }
    return true;
  }
  return false;
});
