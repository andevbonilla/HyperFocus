// background.js

// Listen all messages
chrome.runtime.onMessage.addListener(async (message, sender, sendResponse) => {

  if (message.action === 'addBlockedSite') {

    const siteObj = message.siteObjForm;          // id, host, fullUrl, time, color, hasTime

    try {
      // 1‑ Obtener el arreglo existente (o array vacío si aún no existe)
      const { blockedSites = [] } = await chrome.storage.local.get('blockedSites');

      // 2‑ Lanzar error si ya existe
      if (blockedSites.some(s => s.host === siteObj.host)) throw new Error('Ya existe');

      // 3‑ Añadir el nuevo
      blockedSites.push(siteObj);                

      // 4‑ Guardar el arreglo actualizado
      await chrome.storage.local.set({ blockedSites });

      sendResponse({ success: true });
    } catch (err) {
      console.error(err);
      sendResponse({ success: false, error: err.message });
    }

    // 5‑ Mantén abierto el puerto para la respuesta asíncrona
    return true;

  }

});