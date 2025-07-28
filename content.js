// content.js

function ensureOverlay() {
    let el = document.getElementById('__hyperfocus_overlay__');
    if (!el) {
      el = document.createElement('div');
      el.id = '__hyperfocus_overlay__';
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
};
function fmt(sec) {
    const s = Math.max(0, sec|0);
    const h = String(Math.floor(s/3600)).padStart(2,'0');
    const m = String(Math.floor((s%3600)/60)).padStart(2,'0');
    const ss = String(s%60).padStart(2,'0');
    return `${h}:${m}:${ss}`;
};
  
(async function main() {
    const pageUrl = location.href;
    const resp = await chrome.runtime.sendMessage({ type: 'getTimeBudget', pageUrl }).catch(()=>null);
    if (!resp?.ok) return;
  
    if (resp.blockNow) return; // background ya bloqueará
  
    let remaining = resp.remainingSeconds ?? 0;
    const overlay = ensureOverlay();
    overlay.textContent = 'Tiempo restante: ' + fmt(remaining);
  
    let lastSync = Date.now();
  
    function tick() {
      if (document.visibilityState !== 'visible') return; // solo consume en visible
      if (remaining <= 0) return;
  
      remaining -= 1;
      overlay.textContent = 'Tiempo restante: ' + fmt(remaining);
  
      const now = Date.now();
      if (now - lastSync > 10_000) { // sync cada ~10s
        lastSync = now;
        chrome.runtime.sendMessage({ type: 'syncRemaining', pageUrl, remainingSeconds: remaining }).catch(()=>{});
      }
  
      if (remaining <= 0) {
        overlay.textContent = 'Tiempo agotado. Bloqueando…';
        chrome.runtime.sendMessage({ type: 'timeUp', pageUrl }).catch(()=>{});
        clearInterval(timer);
      }
    }
  
    const timer = setInterval(tick, 1000);
  
    // Guarda lo último al salir
    window.addEventListener('beforeunload', () => {
      chrome.runtime.sendMessage({ type: 'syncRemaining', pageUrl, remainingSeconds: remaining }).catch(()=>{});
    });
})();
  