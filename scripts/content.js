// content.js
(function () {
  if (window.top !== window.self) return;

  const OVERLAY_ID = '__hyperfocus_overlay__';
  window.__hyperfocus_timer ??= null;

  function ensureOverlay() {
    let el = document.getElementById(OVERLAY_ID);
    if (!el) {
      el = document.createElement('div');
      el.id = OVERLAY_ID;
      el.style.position = 'fixed';
      el.style.right = '12px';
      el.style.bottom = '12px';
      el.style.zIndex = '2147483647';
      el.style.padding = '8px 12px';
      el.style.borderRadius = '10px';
      el.style.background = 'rgba(0,0,0,0.75)';
      el.style.color = '#fff';
      el.style.font = '13px/1 system-ui,-apple-system,Segoe UI,Roboto,Arial';
      el.style.pointerEvents = 'none';
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

  function startTimer(pageUrl, initialRemaining) {
    if (window.__hyperfocus_timer) {
      clearInterval(window.__hyperfocus_timer);
      window.__hyperfocus_timer = null;
    }

    let remaining = initialRemaining | 0;
    const overlay = ensureOverlay();
    overlay.textContent = 'Tiempo restante: ' + fmt(remaining);
    let lastSync = Date.now();

    const tick = () => {
      if (document.visibilityState !== 'visible') return;
      if (remaining <= 0) return;

      remaining -= 1;
      overlay.textContent = 'Tiempo restante: ' + fmt(remaining);

      const now = Date.now();
      if (now - lastSync > 10_000) {
        lastSync = now;
        chrome.runtime.sendMessage({ type: 'syncRemaining', pageUrl, remainingSeconds: remaining }).catch(() => {});
      }

      if (remaining <= 0) {
        overlay.textContent = 'Tiempo agotado. Bloqueando…';
        chrome.runtime.sendMessage({ type: 'timeUp', pageUrl }).catch(() => {});
        clearInterval(window.__hyperfocus_timer);
        window.__hyperfocus_timer = null;
      }
    };

    window.__hyperfocus_timer = setInterval(tick, 1000);

    window.addEventListener('beforeunload', () => {
      chrome.runtime.sendMessage({ type: 'syncRemaining', pageUrl, remainingSeconds: remaining }).catch(() => {});
    }, { once: true });
  }

  chrome.runtime.onMessage.addListener((msg) => {
    try {
      if (msg?.type === 'stopTimerForHost') {
        const targetHost = new URL(msg.host).host;
        if (location.host !== targetHost) return;
        if (window.__hyperfocus_timer) {
          clearInterval(window.__hyperfocus_timer);
          window.__hyperfocus_timer = null;
        }
        document.getElementById(OVERLAY_ID)?.remove();
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
    const pageUrl = location.href;
    const resp = await chrome.runtime.sendMessage({ type: 'getTimeBudget', pageUrl }).catch(() => null);
    if (!resp?.ok) return;
    if (resp.blockNow) return;
    startTimer(pageUrl, resp.remainingSeconds ?? 0);
  })();
})();
