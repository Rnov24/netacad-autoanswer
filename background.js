chrome.commands.onCommand.addListener((command) => {
  if (command === "process-page-command") {
    console.log("Command received: process-page-command");
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs.length > 0 && tabs[0].id) {
        const tabId = tabs[0].id;
        chrome.storage.sync.get(["showAnswers"], (result) => {
          let showAnswers = true;
          if (typeof result.showAnswers === "boolean") {
            showAnswers = result.showAnswers;
          }

          chrome.tabs.sendMessage(
            tabId,
            { action: "processPage", showAnswers: showAnswers },
            (response) => {
              if (chrome.runtime.lastError) {
                console.error(
                  "Background Error: Could not send message to tab.",
                  chrome.runtime.lastError.message,
                );
              } else {
                console.log(
                  "Background: Message sent to tab, response:",
                  response,
                );
              }
            },
          );
        });
      } else {
        console.warn("Background: No active tab found.");
      }
    });
  }
});

// Floating-button broadcast: top-frame content script asks background to fan
// the processPage message out to every frame in the same tab (since app-root
// lives in an iframe, not the top frame).
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request && request.action === "broadcastProcessPage") {
    const tabId = sender.tab && sender.tab.id;
    if (!tabId) {
      sendResponse({ success: false, error: "no tab id" });
      return false;
    }
    chrome.storage.sync.get(["showAnswers"], (result) => {
      const showAnswers =
        typeof result.showAnswers === "boolean" ? result.showAnswers : true;
      chrome.tabs.sendMessage(
        tabId,
        { action: "processPage", showAnswers },
        () => {
          // Suppress lastError for frames without listeners.
          void chrome.runtime.lastError;
        },
      );
      sendResponse({ success: true });
    });
    return true; // async response
  }
  return false;
});

