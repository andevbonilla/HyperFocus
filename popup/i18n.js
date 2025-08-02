
(function () {
      function log(msg, ...args) {
        try { console.log('[i18n]', msg, ...args); } catch {}
      }

      function applyI18n() {
        if (!chrome || !chrome.i18n) {
          log('chrome.i18n NO disponible');
          return;
        }

        const t = chrome.i18n.getMessage;
        log('default_locale =', (chrome.runtime.getManifest()||{}).default_locale);
        log('popupTitle =', t('popupTitle'));

        // Verifica que el archivo en/messages.json exista y sea válido
        const url = chrome.runtime.getURL('_locales/en/messages.json');
        fetch(url)
          .then(r => { log('fetch messages.json status', r.status); return r.text(); })
          .then(txt => { try { JSON.parse(txt); log('messages.json (en) OK'); } catch(e){ console.error('messages.json inválido:', e); }})
          .catch(err => console.error('No se pudo leer _locales/en/messages.json', err));

        // Aplica textos
        document.querySelectorAll('[data-i18n]').forEach(el => {
          const key = el.getAttribute('data-i18n');
          const msg = t(key);
          el.textContent = msg || key;   // fallback: muestra la clave
        });
        document.querySelectorAll('[data-i18n-title]').forEach(el => {
          const key = el.getAttribute('data-i18n-title');
          const msg = t(key);
          el.title = msg || key;
        });
        document.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
          const key = el.getAttribute('data-i18n-placeholder');
          const msg = t(key);
          el.placeholder = msg || key;
        });

        document.documentElement.lang = t('@@ui_locale') || 'en';
        document.documentElement.dir  = t('@@bidi_dir') || 'ltr';
      }

      if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', applyI18n);
      } else {
        applyI18n();
      }
}) ();