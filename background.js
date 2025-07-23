// background.js
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'addBlockedSite') {
    const { id, domain, time, color, hasTime } = message.siteObjForm;
    const siteObj = { id, domain, time, color, hasTime };
    blockedSites.push(siteObj);
    chrome.storage.local.set({ blockedSites });
    sendResponse({ success: true });
  }
});