/* background.js — MV3 (estable e idempotente) */

// ---------- Utils de fecha/alarma ----------
const DAILY_ALARM = 'hyperfocusDailyReset';

// Devuelve el objeto del sitio por hostname, o null
async function findSiteByHostname(hostname) {
  const { blockedSites = [] } = await chrome.storage.local.get('blockedSites');
  const site = blockedSites.find(s => {
    try { return new URL(s.fullUrl).hostname === hostname; }
    catch { return false; }
  });
  return site || null;
}

// Decide si hay que bloquear *ahora* una URL concreta (aplica reset diario “perezoso”)
async function shouldBlockNowForUrl(url) {
  let u;
  try { u = new URL(url); } catch { return { block: false }; }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return { block: false };

  const hostname = u.hostname;
  const data = await chrome.storage.local.get('blockedSites');
  const blockedSites = data.blockedSites || [];
  const site = blockedSites.find(s => {
    try { return new URL(s.fullUrl).hostname === hostname; }
    catch { return false; }
  });
  if (!site) return { block: false };

  // Sitio "Siempre"
  if (!site.hasTime) return { block: true, site };

  // Reset diario perezoso
  const today = todayKey();
  let mutated = false;
  if (site.lastResetDay !== today) {
    site.remainingSeconds = parseHHMMSS(site.time || '00:00:00');
    site.lastResetDay = today;
    mutated = true;
  }
  if (typeof site.remainingSeconds !== 'number') {
    site.remainingSeconds = parseHHMMSS(site.time || '00:00:00');
    mutated = true;
  }
  if (mutated) await chrome.storage.local.set({ blockedSites });

  // Si no queda tiempo => bloquear
  if ((site.remainingSeconds | 0) <= 0) return { block: true, site };

  // Aún tiene saldo → no bloquear
  return { block: false };
}

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

// ---------- IDs de regla: hash estable por hostname ----------
function ruleIdForSite(site) {
  const hostname = new URL(site.fullUrl).hostname;
  // FNV-1a 32-bit
  let h = 2166136261;
  for (let i = 0; i < hostname.length; i++) {
    h ^= hostname.charCodeAt(i);
    h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
  }
  // id en rango 1..2e9 (válido para DNR)
  return 1 + (h % 2000000000);
}

// ---------- Helpers DNR (idempotentes) ----------
async function removeAllRulesForHostname(hostname) {
  try {
    const rules = await chrome.declarativeNetRequest.getDynamicRules();
    const toRemove = rules
      .filter(r => r?.condition?.urlFilter === `||${hostname}^`)
      .map(r => r.id);
    if (toRemove.length) {
      await chrome.declarativeNetRequest.updateDynamicRules({ removeRuleIds: toRemove });
    }
  } catch {}
}

async function addBlockRuleForSite(site) {
  const hostname = new URL(site.fullUrl).hostname;
  const id = ruleIdForSite(site);

  // Limpieza previa (por id y por hostname) para evitar "not unique ID"
  try {
    const existing = await chrome.declarativeNetRequest.getDynamicRules();
    const toRemove = existing
      .filter(r => r.id === id || r?.condition?.urlFilter === `||${hostname}^`)
      .map(r => r.id);
    if (toRemove.length) {
      await chrome.declarativeNetRequest.updateDynamicRules({ removeRuleIds: toRemove });
    }
  } catch {}

  const rule = {
    id,
    priority: 1,
    action: { type: 'redirect', redirect: { extensionPath: '/blocked.html' } },
    condition: { urlFilter: `||${hostname}^`, resourceTypes: ['main_frame'] }
  };
  await chrome.declarativeNetRequest.updateDynamicRules({ addRules: [rule] });
}

async function removeBlockRuleForSite(site) {
  try {
    const hostname = new URL(site.fullUrl).hostname;
    await removeAllRulesForHostname(hostname);
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
        type: 'dailyResetForHost',     // lo escucha content.js
        host: site.fullUrl,
        remainingSeconds: site.remainingSeconds | 0
      });
    } catch {
      // Puede fallar si el content aún no está inyectado
    }
  }
}

// ---------- Sincronización de reglas al arrancar (idempotente) ----------
async function syncAlwaysRules() {
  const { blockedSites = [] } = await chrome.storage.local.get('blockedSites');
  for (const site of blockedSites) {
    if (!site.hasTime) {
      // Siempre: asegurar bloqueo (remove-then-add)
      await addBlockRuleForSite(site);
    } else {
      // Con tiempo: si tiene tiempo → sin regla; si agotado → con regla
      const hasTimeLeft = typeof site.remainingSeconds === 'number'
        ? site.remainingSeconds > 0
        : true;
      if (hasTimeLeft) {
        await removeBlockRuleForSite(site);
      } else {
        await addBlockRuleForSite(site);
      }
    }
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
      await removeBlockRuleForSite(site); // por si estaba bloqueado de ayer
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
  // Añadir sitio bloqueado (desde popup) — efecto inmediato desde background
  if (message.action === 'addBlockedSite') {
    const siteObj = message.siteObjForm;

    (async () => {
      try {
        const { blockedSites = [] } = await chrome.storage.local.get('blockedSites');

        // Evitar duplicados por dominio (http/https)
        const newHost = new URL(siteObj.fullUrl).hostname;
        if (blockedSites.some(s => {
          try { return new URL(s.fullUrl).hostname === newHost; }
          catch { return false; }
        })) {
          sendResponse({ success: false, error: 'Ya existe un bloqueo para ese dominio' });
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
          // "Con tiempo": si tiempo = 0 => bloquear ya; si no, overlay
          if ((siteObj.remainingSeconds | 0) <= 0) {
            await addBlockRuleForSite(siteObj);
            await redirectTabsToBlocked(siteObj);
          } else {
            await removeBlockRuleForSite(siteObj); // por si hubiese residuo
            await notifyTabsStartTimer(siteObj);   // muestra overlay en vivo
          }
        }

        sendResponse({ success: true, site: siteObj });
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
        await removeAllRulesForHostname(hostname);

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
          let tabs = [];
          try {
            tabs = await chrome.tabs.query({ url: [`http://${hostname}/*`, `https://${hostname}/*`] });
          } catch {}

          for (const t of tabs) {
            try {
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


chrome.webNavigation.onCommitted.addListener(async (details) => {
  try {
    // Solo frame principal y URLs http/https
    if (details.frameId !== 0) return;
    const url = details.url || '';
    const u = new URL(url);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return;

    // Ignorar nuestras páginas y páginas de Chrome
    if (u.protocol === 'chrome-extension:' || u.protocol.startsWith('chrome')) return;

    // ¿Debemos bloquear este destino?
    const { block, site } = await shouldBlockNowForUrl(url);
    if (!block || !site) return;

    // Asegura regla (idempotente) y redirige
    await addBlockRuleForSite(site);
    const blockedUrl = chrome.runtime.getURL('blocked.html') + `?host=${encodeURIComponent(site.fullUrl)}`;
    try { await chrome.tabs.update(details.tabId, { url: blockedUrl }); } catch {}
  } catch {
    // no-op
  }
});


