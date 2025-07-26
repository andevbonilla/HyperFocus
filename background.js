// background.js

// Listen all messages
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'addBlockedSite') {
    const siteObj = message.siteObjForm;

    (async () => {
      try {
        const { blockedSites = [] } = await chrome.storage.local.get('blockedSites');

        if (blockedSites.some(s => s.fullUrl === siteObj.fullUrl)) {
          sendResponse({ success: false, error: 'Ya existe URL' });
          return;
        }

        blockedSites.push(siteObj);
        await chrome.storage.local.set({ blockedSites });
        sendResponse({ success: true });
      } catch (err) {
        console.error(err);
        sendResponse({ success: false, error: err.message });
      }
    })();

    return true; // mantiene abierto el canal hasta sendResponse
  }
});
