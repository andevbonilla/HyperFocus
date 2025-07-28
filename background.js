// background.js

// ---------- Utils ----------
function toSchemeAndHostOnly(input) {
  const raw = (input || '').trim();
  const u = new URL(raw);
  if (u.protocol !== 'http:' && u.protocol !== 'https:') {
    throw new Error('La URL debe empezar por http:// o https://');
  }
  return `${u.protocol}//${u.host}`; // host = hostname[:port]
}

function parseHHMMSS(str) {
  if (!str) return 0;
  const [h='0', m='0', s='0'] = String(str).split(':');
  return (+h)*3600 + (+m)*60 + (+s);
}

function ruleIdForSite(site) {
  const base = 100000;                 // evita colisiones
  return base + (site.id % 100000);
}

function urlFilterForSite(site) {
  // Bloquea el dominio entero (y subdominios) en frame principal
  const u = new URL(site.fullUrl);
  return `||${u.hostname}^`;
}

async function addBlockRuleForSite(site) {
  const rule = {
    id: ruleIdForSite(site),
    priority: 1,
    action: { type: 'redirect', redirect: { extensionPath: '/blocked.html' } },
    condition: { urlFilter: urlFilterForSite(site), resourceTypes: ['main_frame'] }
  };
  await chrome.declarativeNetRequest.updateDynamicRules({
    removeRuleIds: [rule.id],
    addRules: [rule],
  });
}

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
  };

  // ---------- NUEVOS MENSAJES ----------
  if (message.type === 'getTimeBudget') {
    (async () => {
      try {
        const hostOnly = toSchemeAndHostOnly(message.pageUrl);
        const { blockedSites = [] } = await chrome.storage.local.get('blockedSites');

        const site = blockedSites.find(s => s.fullUrl === hostOnly && s.hasTime);
        if (!site) { sendResponse({ ok: false, reason: 'NOT_TIMED' }); return; }

        if (typeof site.remainingSeconds !== 'number') {
          site.remainingSeconds = parseHHMMSS(site.time || '00:00:00');
          await chrome.storage.local.set({ blockedSites });
        }

        if (site.remainingSeconds <= 0) {
          await addBlockRuleForSite(site);
          sendResponse({ ok: true, remainingSeconds: 0, blockNow: true });
          return;
        }

        sendResponse({ ok: true, remainingSeconds: site.remainingSeconds, blockNow: false });
      } catch (err) {
        console.error(err);
        sendResponse({ ok: false, reason: err.message });
      }
    })();
    return true;
  }

  if (message.type === 'syncRemaining') {
    (async () => {
      try {
        const hostOnly = toSchemeAndHostOnly(message.pageUrl);
        const { blockedSites = [] } = await chrome.storage.local.get('blockedSites');
        const site = blockedSites.find(s => s.fullUrl === hostOnly && s.hasTime);
        if (!site) { sendResponse({ ok: false, reason: 'NOT_FOUND' }); return; }

        site.remainingSeconds = Math.max(0, message.remainingSeconds|0);
        await chrome.storage.local.set({ blockedSites });
        sendResponse({ ok: true });
      } catch (err) {
        console.error(err);
        sendResponse({ ok: false, reason: err.message });
      }
    })();
    return true;
  }

  if (message.type === 'timeUp') {
    (async () => {
      try {
        const hostOnly = toSchemeAndHostOnly(message.pageUrl);
        const { blockedSites = [] } = await chrome.storage.local.get('blockedSites');
        const site = blockedSites.find(s => s.fullUrl === hostOnly && s.hasTime);
        if (!site) { sendResponse({ ok: false, reason: 'NOT_FOUND' }); return; }

        site.remainingSeconds = 0;
        await chrome.storage.local.set({ blockedSites });

        await addBlockRuleForSite(site);

        const tabId = sender?.tab?.id;
        if (typeof tabId === 'number') {
          const url = chrome.runtime.getURL('blocked.html') + `?host=${encodeURIComponent(hostOnly)}`;
          try { await chrome.tabs.update(tabId, { url }); } catch {}
        }

        sendResponse({ ok: true });
      } catch (err) {
        console.error(err);
        sendResponse({ ok: false, reason: err.message });
      }
    })();
    return true;
  }
  
});
