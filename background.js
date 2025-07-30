/* background.js — MV3 */

// ---------- Utils de fecha/alarma ----------
const DAILY_ALARM = 'hyperfocusDailyReset';

function todayKey(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`; // "YYYY-MM-DD" en hora local
}

function nextMidnightMs(now = new Date()) {
  const next = new Date(now);
  next.setHours(24, 0, 0, 0); // siguiente medianoche
  return +next;
}

async function scheduleDailyAlarm() {
  try { await chrome.alarms.clear(DAILY_ALARM); } catch {}
  await chrome.alarms.create(DAILY_ALARM, {
    when: nextMidnightMs(),
    periodInMinutes: 24 * 60
  });
}

// ---------- Utils varias ----------
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
  const base = 100000; // evita colisiones con reglas existentes
  return base + (site.id % 100000);
}

function urlFilterForSite(site) {
  const u = new URL(site.fullUrl);
  return `||${u.hostname}^`; // bloquea dominio y subdominios del host concreto
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

async function removeBlockRuleForSite(site) {
  try {
    await chrome.declarativeNetRequest.updateDynamicRules({
      removeRuleIds: [ruleIdForSite(site)]
    });
  } catch {}
}

// ---------- Helpers de pestañas (para efecto en tiempo real) ----------
function urlToHostPatterns(fullUrl) {
  const u = new URL(fullUrl);
  return [`http://${u.host}/*`, `https://${u.host}/*`];
}

async function queryTabsByHost(fullUrl) {
  try {
    const tabs = await chrome.tabs.query({ url: urlToHostPatterns(fullUrl) });
    return tabs || [];
  } catch {
    return [];
  }
}

async function redirectTabsToBlocked(site) {
  const blockedUrl = chrome.runtime.getURL('blocked.html') + `?host=${encodeURIComponent(site.fullUrl)}`;
  const tabs = await queryTabsByHost(site.fullUrl);
  for (const t of tabs) {
    try { await chrome.tabs.update(t.id, { url: blockedUrl }); } catch {}
  }
}

async function notifyTabsStartTimer(site) {
  const tabs = await queryTabsByHost(site.fullUrl);
  for (const t of tabs) {
    try {
      await chrome.tabs.sendMessage(t.id, {
        type: 'dailyResetForHost',     // lo escucha tu content.js
        host: site.fullUrl,
        remainingSeconds: site.remainingSeconds | 0
      });
    } catch {
      // puede fallar si la pestaña no tiene aún el content inyectado
    }
  }
}

// ---------- Sincronización de reglas al arrancar ----------
async function syncAlwaysRules() {
  const { blockedSites = [] } = await chrome.storage.local.get('blockedSites');
  const adds = [];
  const removeIds = [];

  for (const site of blockedSites) {
    const id = ruleIdForSite(site);
    if (!site.hasTime) {
      // Sitios "Siempre" => asegurar regla
      adds.push({
        id,
        priority: 1,
        action: { type: 'redirect', redirect: { extensionPath: '/blocked.html' } },
        condition: { urlFilter: urlFilterForSite(site), resourceTypes: ['main_frame'] }
      });
    } else {
      // Sitios con tiempo => si queda tiempo, remover cualquier regla residual
      const hasTimeLeft = typeof site.remainingSeconds === 'number'
        ? site.remainingSeconds > 0
        : true;
      if (hasTimeLeft) removeIds.push(id);
    }
  }

  if (adds.length || removeIds.length) {
    await chrome.declarativeNetRequest.updateDynamicRules({
      removeRuleIds: removeIds,
      addRules: adds
    });
  }
}

// ---------- Reseteo diario ----------
async function resetTimedBudgetsIfNeeded(now = new Date()) {
  const { blockedSites = [] } = await chrome.storage.local.get('blockedSites');
  const today = todayKey(now);
  let mutated = false;

  for (const site of blockedSites) {
    if (!site.hasTime) continue;
    if (site.lastResetDay !== today) {
      site.remainingSeconds = parseHHMMSS(site.time || '00:00:00');
      site.lastResetDay = today;
      await removeBlockRuleForSite(site); // por si quedó bloqueado ayer
      mutated = true;
    }
  }

  if (mutated) {
    await chrome.storage.local.set({ blockedSites });
  }
  return blockedSites;
}

async function broadcastDailyReset(sites) {
  for (const site of sites) {
    if (!site.hasTime) continue;
    await notifyTabsStartTimer(site);
  }
}

// ---------- Eventos de ciclo de vida ----------
chrome.runtime.onInstalled.addListener(async () => {
  await scheduleDailyAlarm();
  await syncAlwaysRules();
});

chrome.runtime.onStartup.addListener(async () => {
  await scheduleDailyAlarm();
  await syncAlwaysRules();
});

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name !== DAILY_ALARM) return;
  const sites = await resetTimedBudgetsIfNeeded(new Date());
  await broadcastDailyReset(sites);
});

// ---------- Mensajería con popup/content ----------
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // Añadir sitio bloqueado (desde popup) —> efecto inmediato desde background
  if (message.action === 'addBlockedSite') {
    const siteObj = message.siteObjForm;

    (async () => {
      try {
        const { blockedSites = [] } = await chrome.storage.local.get('blockedSites');

        if (blockedSites.some(s => s.fullUrl === siteObj.fullUrl)) {
          sendResponse({ success: false, error: 'Ya existe URL' });
          return;
        }

        // Inicialización de estado para sitios con tiempo
        if (siteObj.hasTime) {
          siteObj.lastResetDay = todayKey();
          siteObj.remainingSeconds = parseHHMMSS(siteObj.time || '00:00:00');
        }

        // Guardar
        blockedSites.push(siteObj);
        await chrome.storage.local.set({ blockedSites });

        // Efecto inmediato
        if (!siteObj.hasTime) {
          // "Siempre": crea regla y redirige ya
          await addBlockRuleForSite(siteObj);
          await redirectTabsToBlocked(siteObj);
        } else {
          // "Con tiempo": si tiempo = 0 => bloquear ya; si no, arrancar overlay
          if ((siteObj.remainingSeconds | 0) <= 0) {
            await addBlockRuleForSite(siteObj);
            await redirectTabsToBlocked(siteObj);
          } else {
            await removeBlockRuleForSite(siteObj); // por si hubiese residuo
            await notifyTabsStartTimer(siteObj);   // muestra overlay en vivo
          }
        }

        sendResponse({ success: true });
      } catch (err) {
        console.error(err);
        sendResponse({ success: false, error: err.message });
      }
    })();

    return true; // mantener el canal abierto
  }

  // Obtener presupuesto de tiempo (desde content)
  if (message.type === 'getTimeBudget') {
    (async () => {
      try {
        const hostOnly = toSchemeAndHostOnly(message.pageUrl);
        const { blockedSites = [] } = await chrome.storage.local.get('blockedSites');
        const site = blockedSites.find(s => s.fullUrl === hostOnly && s.hasTime);
        if (!site) { sendResponse({ ok: false, reason: 'NOT_TIMED' }); return; }

        // Reset diario perezoso
        const today = todayKey();
        if (site.lastResetDay !== today) {
          site.remainingSeconds = parseHHMMSS(site.time || '00:00:00');
          site.lastResetDay = today;
          await removeBlockRuleForSite(site);
          await chrome.storage.local.set({ blockedSites });
        }

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

  // Sincronizar segundos restantes (desde content)
  if (message.type === 'syncRemaining') {
    (async () => {
      try {
        const hostOnly = toSchemeAndHostOnly(message.pageUrl);
        const { blockedSites = [] } = await chrome.storage.local.get('blockedSites');
        const site = blockedSites.find(s => s.fullUrl === hostOnly && s.hasTime);
        if (!site) { sendResponse({ ok: false, reason: 'NOT_FOUND' }); return; }

        site.remainingSeconds = Math.max(0, message.remainingSeconds | 0);
        await chrome.storage.local.set({ blockedSites });
        sendResponse({ ok: true });
      } catch (err) {
        console.error(err);
        sendResponse({ ok: false, reason: err.message });
      }
    })();

    return true;
  }

  // Tiempo agotado (desde content)
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

  // Eliminar sitio (desde popup) — robusto y apaga overlay SOLO si era con tiempo
  if (message.action === 'removeBlockedSite') {
    (async () => {
      try {
        const { id } = message;

        // 1) Cargar storage y localizar el target por id
        let { blockedSites = [] } = await chrome.storage.local.get('blockedSites');
        const target = blockedSites.find(s => s.id === id);
        if (!target) {
          sendResponse({ success: false, error: 'No se encontró el sitio' });
          return;
        }

        // 2) Hostname canónico
        let hostname = '';
        try { hostname = new URL(target.fullUrl).hostname; } catch {}
        if (!hostname) {
          // Fallback: elimina solo por id si la URL estaba mal formada
          blockedSites = blockedSites.filter(s => s.id !== id);
          await chrome.storage.local.set({ blockedSites });
          sendResponse({ success: true, note: 'Eliminado por id; hostname inválido' });
          return;
        }

        // 3) Conjunto de entradas (http/https) del mismo hostname
        const sameHostEntries = blockedSites.filter(s => {
          try { return new URL(s.fullUrl).hostname === hostname; }
          catch { return false; }
        });

        // ¿Alguna de esas entradas era "con tiempo"?
        const hadTimed = sameHostEntries.some(s => s.hasTime === true);

        // 4) Quitar TODAS las reglas DNR que apunten a ese hostname (evita residuos)
        try {
          const allRules = await chrome.declarativeNetRequest.getDynamicRules();
          const toRemove = allRules
            .filter(r => r?.condition?.urlFilter === `||${hostname}^`)
            .map(r => r.id);
          if (toRemove.length) {
            await chrome.declarativeNetRequest.updateDynamicRules({ removeRuleIds: toRemove });
          }
        } catch (e) {
          // Si fallara getDynamicRules, al menos intenta remover por el id del target
          try {
            const idRule = ruleIdForSite(target)
            await chrome.declarativeNetRequest.updateDynamicRules({ removeRuleIds: [idRule] });
          } catch {}
        }

        // 5) Eliminar del storage cualquier entrada con ese mismo hostname
        const prevLen = blockedSites.length;
        blockedSites = blockedSites.filter(s => {
          try { return new URL(s.fullUrl).hostname !== hostname; }
          catch { return true; }
        });
        const removedCount = prevLen - blockedSites.length;
        await chrome.storage.local.set({ blockedSites });

        // 6) Apagar overlay SOLO si había bloqueos con tiempo para ese hostname
        if (hadTimed) {
          // Reutiliza tu helper queryTabsByHost() si ya lo tienes.
          // Si no lo tienes, puedes sustituir por chrome.tabs.query({ url: [`http://${hostname}/*`, `https://${hostname}/*`] })
          let tabs = [];
          try {
            tabs = await chrome.tabs.query({ url: [`http://${hostname}/*`, `https://${hostname}/*`] });
          } catch {}

          for (const t of tabs) {
            try {
              // El content script compara por host, así que el esquema es irrelevante
              await chrome.tabs.sendMessage(t.id, {
                type: 'stopTimerForHost',
                host: `https://${hostname}`
              });
            } catch {}
          }
        }

        sendResponse({ success: true, removedCount, overlayStopped: hadTimed });
      } catch (err) {
        console.error(err);
        sendResponse({ success: false, error: err.message });
      }
    })();

    return true;
  }

});
