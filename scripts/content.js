// content.js
(function () {
  if (window.top !== window.self) return;

  const OVERLAY_ID = '__hyperfocus_overlay__';
  window.__hyperfocus_timer ??= null;

  // === Helpers de mensajería segura / vida del contexto ===
  function extAlive() {
    // true si la extensión sigue cargada (no desinstalada/recargada)
    return !!(chrome && chrome.runtime && chrome.runtime.id);
  }

  async function safeSendMessage(payload) {
    if (!extAlive()) return;
    try {
      await chrome.runtime.sendMessage(payload);
    } catch (e) {
      // Ignora errores típicos al descargar/recargar
      const msg = String(e && (e.message || e));
      if (
        msg.includes('Extension context invalidated') ||
        msg.includes('The message port closed before a response was received.') ||
        msg.includes('Could not establish connection') ||
        msg.includes('Receiving end does not exist')
      ) {
        return;
      }
      // Si quieres depurar otros casos:
      // console.debug('safeSendMessage error:', e);
    }
  }

  function ensureOverlay() {
    let el = document.getElementById(OVERLAY_ID);
    if (!el) {
      // contenedor principal
      el = document.createElement('div');
      el.id = OVERLAY_ID;
      Object.assign(el.style, {
        position: 'fixed',
        right: '12px',
        bottom: '12px',
        zIndex: '2147483647',
        display: 'flex',
        alignItems: 'center',
        padding: '8px 16px',
        borderRadius: '10px',
        background: '#051043',            // azul oscuro
        color: '#FFFFFF',                 // texto blanco
        fontSize: '16px',
        fontWeight: '600',
        fontFamily: 'system-ui, -apple-system, "Segoe UI", Roboto, Arial, sans-serif',
        pointerEvents: 'none'
      });
  
      // icono de cohete (puedes cambiar por tu propia URL o data-URI)
      const rocket = document.createElement('img');
      rocket.src = chrome.runtime.getURL('icons/icon48.png');
      rocket.style.width = '24px';
      rocket.style.height = '24px';
      rocket.style.marginRight = '8px';
      el.appendChild(rocket);
  
      // span para el texto del timer
      const text = document.createElement('span');
      text.id = 'timer-text';
      text.textContent = '00:00:00';    // valor inicial
      el.appendChild(text);


      // botón de cerrar
      const closeBtn = document.createElement('button');
      closeBtn.textContent = '✕';
      closeBtn.type = 'button';
      Object.assign(closeBtn.style, {
        color: '#FFFFFF',
        marginLeft: '12px',
        width: '24px',
        height: '24px',
        borderRadius: '12px',
        background: '#051043',
        border: 'none',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: '16px',
        cursor: 'pointer',
        pointerEvents: 'auto'               // que el botón sí reciba clics
      });
      closeBtn.addEventListener('click', () => {
        el.style.display = 'none';
      });
      el.appendChild(closeBtn);
  
      document.documentElement.appendChild(el);
    }
    return el;
  }

  function fmt(sec) {
    const s = Math.max(0, sec | 0);
    const h = String(Math.floor(s / 3600)).padStart(2, '0');
    const m = String(Math.floor((s % 3600) / 60)).padStart(2, '0');
    const ss = String(s % 60).padStart(2, '0');
    return `${h}:${m}:${ss}`;
  }

  function stopTimerOverlay() {
    if (window.__hyperfocus_timer) {
      clearInterval(window.__hyperfocus_timer);
      window.__hyperfocus_timer = null;
    }
    document.getElementById(OVERLAY_ID)?.remove();
  }

  function startTimer(pageUrl, initialRemaining) {
    if (window.__hyperfocus_timer) {
      clearInterval(window.__hyperfocus_timer);
      window.__hyperfocus_timer = null;
    }

    let remaining = initialRemaining | 0;
    const overlay = ensureOverlay();
    overlay.querySelector('#timer-text').textContent = fmt(remaining);
    let lastSync = Date.now();
    let unloading = false;

    const tick = () => {
      // Si la extensión se recargó o se está cerrando, no sigas
      if (!extAlive()) { stopTimerOverlay(); return; }
      if (unloading) return;

      if (document.visibilityState !== 'visible') return; // no consumir si no es visible
      if (remaining <= 0) return;

      remaining -= 1;
      overlay.querySelector('#timer-text').textContent = fmt(remaining);

      const now = Date.now();
      if (now - lastSync > 10_000) {
        lastSync = now;
        // <<< USAR helper seguro >>>
        safeSendMessage({ type: 'syncRemaining', pageUrl, remainingSeconds: remaining });
      }

      if (remaining <= 0) {
        overlay.querySelector('#timer-text').textContent = 'Tiempo agotado. Bloqueando…';
        safeSendMessage({ type: 'timeUp', pageUrl });
        stopTimerOverlay();
      }
    };

    window.__hyperfocus_timer = setInterval(tick, 1000);

    // Evita enviar durante descarga; además limpia el timer
    const beforeUnload = () => { unloading = true; stopTimerOverlay(); };
    const pageHide = () => { unloading = true; stopTimerOverlay(); };

    window.addEventListener('beforeunload', beforeUnload, { once: true });
    window.addEventListener('pagehide', pageHide, { once: true });

    // Última sincronización “best effort” (si aún hay contexto)
    window.addEventListener('beforeunload', () => {
      if (!extAlive()) return;
      safeSendMessage({ type: 'syncRemaining', pageUrl, remainingSeconds: remaining });
    }, { once: true });
  }

  // === Mensajería desde background ===
  chrome.runtime.onMessage.addListener((msg) => {
    try {
      if (msg?.type === 'stopTimerForHost') {
        const targetHost = new URL(msg.host).host;
        if (location.host !== targetHost) return;
        stopTimerOverlay();
      }
      if (msg?.type === 'dailyResetForHost') {
        const targetHost = new URL(msg.host).host;
        if (location.host !== targetHost) return;
        startTimer(location.href, msg.remainingSeconds | 0);
      }
    } catch {}
  });

  if (window.__hyperfocus_timer) return;

  (async function main() {
    // Si la extensión no está disponible (se recargó), no inicies el overlay
    if (!extAlive()) return;
    const pageUrl = location.href;
    let resp = null;
    try {
      resp = await chrome.runtime.sendMessage({ type: 'getTimeBudget', pageUrl });
    } catch (e) {
      // Si el contexto se invalidó justo aquí, abortar silenciosamente
      return;
    }
    if (!resp?.ok) return;
    if (resp.blockNow) return;
    startTimer(pageUrl, resp.remainingSeconds ?? 0);
  })();
})();
