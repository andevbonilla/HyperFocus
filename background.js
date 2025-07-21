// background.js

// Almacena datos por sitio: remaining (ms), ruleId
const STORAGE_KEY = 'timeBlocks';

// Helper: genera un ID único para la regla
function genRuleId() {
  return Math.floor(Date.now() / 1000);
}

// Añade una regla DNR que bloquee el sitio
async function addBlockRule(site, ruleId) {
  await chrome.declarativeNetRequest.updateDynamicRules({
    addRules: [{
      id: ruleId,
      priority: 1,
      action: { type: 'block' },
      condition: { urlFilter: `||${site}^`, resourceTypes: ['main_frame'] }
    }]
  });
}

// Elimina la regla DNR
async function removeBlockRule(ruleId) {
  await chrome.declarativeNetRequest.updateDynamicRules({
    removeRuleIds: [ruleId]
  });
}

// Al llegar una orden para programar bloqueo
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.action === 'scheduleBlock') {
    const { site, minutes, seconds, hours } = msg;
    const h = hours * 60 * 60 * 1000;
    const m = minutes * 60 * 1000;
    const s = seconds * 1000;
    const totalTimeInMs = m + s + h;

    // 1) Guardar en storage: remaining = ms, aún no hay ruleId
    chrome.storage.local.set({ [STORAGE_KEY]: { ...{} , [site]: { remaining: totalTimeInMs } } });

    // 2) Crear alarma para cuando expire el tiempo de uso
    chrome.alarms.create(`block_${site}`, { delayInMinutes: totalTimeInMs });

    // 3) Crear alarma para reset 24h después
    chrome.alarms.create(`reset_${site}`, { delayInMinutes: 1440 });

    sendResponse();
  }
  return true;
});

// Manejo de alarmas
chrome.alarms.onAlarm.addListener(async alarm => {
  const [type, site] = alarm.name.split('_');
  const data = await chrome.storage.local.get(STORAGE_KEY);
  const blocks = data[STORAGE_KEY] || {};

  if (type === 'block') {
    // 4) Bloquear sitio ahora
    const ruleId = genRuleId();
    await addBlockRule(site, ruleId);

    // Guardar ruleId para poder eliminarlo al reset
    blocks[site].ruleId = ruleId;
    await chrome.storage.local.set({ [STORAGE_KEY]: blocks });

  } else if (type === 'reset') {
    // 5) Quitar bloqueo tras 24h
    const { ruleId } = blocks[site] || {};
    if (ruleId) {
      await removeBlockRule(ruleId);
    }
    // 6) Limpiar datos del sitio
    delete blocks[site];
    await chrome.storage.local.set({ [STORAGE_KEY]: blocks });
  }
});
