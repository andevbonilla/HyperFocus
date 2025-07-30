// blocked.js
(() => {
    const params = new URLSearchParams(location.search);
    const host = params.get('host') || '';
    const el = document.getElementById('host');
    if (el) el.textContent = host.replace(/^https?:\/\//,'');
})();
  