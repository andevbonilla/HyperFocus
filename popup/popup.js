// popup.js

// main variables
let blockedSites = [];
let siteObjForm = {
  id: null,
  domain: null,
  time: null,
  color: null,
  hasTime: false
};

// Obtener referencias a elementos
const addBtn     = document.getElementById('add-new-site-btn');
const addCurrentBtn = document.getElementById('add-current-site-btn');

const form       = document.getElementById('add-website-form');
const cancelBtn  = document.getElementById('form-cancel');
const submitBtn  = document.getElementById('form-submit');
const previewDot = document.getElementById('color-preview');
const colorInput = document.getElementById('color-input');
const urlInput   = document.getElementById('url-input');
const urlError   = document.getElementById('url-input-error');
const hrsInput   = document.getElementById('hrs-input');
const minsInput  = document.getElementById('mins-input');
const secsInput  = document.getElementById('secs-input');
const timeError  = document.getElementById('time-input-error');
const list       = document.getElementById('blocked-list');

const alwaysOption = document.getElementById('always-option');
const withTimeOption = document.getElementById('with-time-option');
const timeGroup = document.getElementById('time-group');

// Regex de validación
const urlRegex = /^(https?:\/\/)[^\s/$.?#].[^\s]*$/i;

/** Carga la lista desde chrome.storage.local al abrir el popup */
function loadBlockedSites() {
  chrome.storage.local.get({ blockedSites: [] }, ({ blockedSites: saved }) => {
    blockedSites = saved;
    blockedSites.forEach(site => {
      addBlockedSiteToDOM(site);
    });
  });
}

// Inyecta un sitio bloqueado en la UI
function addBlockedSiteToDOM({ id, domain, time, color }) {
  const li = document.createElement('li');
  li.className = 'blocked-item';
  li.id = `blocked-item-${id}`;
  li.innerHTML = `
    <span class="dot" id="dot-${id}" style="background:${color}"></span>
    <span class="domain" id="domain-${id}">${domain}</span>
    <time class="timer" id="timer-${id}">${time}</time>
    <button class="delete-btn" id="delete-${id}" title="Eliminar">
      <!-- icono SVG de caneca -->
      <svg xmlns="http://www.w3.org/2000/svg"
           viewBox="0 0 24 24" width="22" height="22">
        <!-- Tapa más ancha que sobresale -->
        <rect x="4" y="1" width="16" height="2" fill="currentColor" rx="1"/>
        <!-- Cuerpo de la lata -->
        <rect x="6" y="3" width="12" height="18" fill="currentColor" rx="2"/>
        <!-- Tres rayas verticales -->
        <rect x="8"  y="6" width="2" height="12" fill="#fff"/>
        <rect x="11" y="6" width="2" height="12" fill="#fff"/>
        <rect x="14" y="6" width="2" height="12" fill="#fff"/>
      </svg>
    </button>
  `;
  const btn = li.querySelector('.delete-btn');
  btn.addEventListener('click', () => removeBlockedSite(id));
  list.appendChild(li);
}

// Resetea y oculta el formulario
function resetForm() {
  form.reset();
  previewDot.style.background = '#ff3b3b';
  form.style.display = 'none';
  addBtn.style.display = 'block';
  addCurrentBtn.style.display = 'block';
}

// Validaciones y habilitación de submit
function validateUrl() {
  const v = urlInput.value.trim();
  if (urlRegex.test(v)) {
    urlInput.classList.remove('input-error');
    urlError.textContent = '';
    return true;
  } else {
    urlInput.classList.add('input-error');
    urlError.textContent = 'URL inválida, debe empezar por http:// o https://';
    return false;
  }
}

function validateTime() {
  const h = parseInt(hrsInput.value, 10);
  const m = parseInt(minsInput.value, 10);
  const s = parseInt(secsInput.value, 10);
  let err = '';

  if ([h,m,s].some(v => isNaN(v))) {
    err = 'El tiempo debe ser un número';
  } else if (h < 0 || h > 23 || m < 0 || m > 59 || s < 0 || s > 59) {
    err = 'Valores fuera de rango (max 23:59:59)';
  }

  if (err) {
    [hrsInput, minsInput, secsInput].forEach(i => i.classList.add('input-error'));
    timeError.textContent = err;
    return false;
  } else {
    [hrsInput, minsInput, secsInput].forEach(i => i.classList.remove('input-error'));
    timeError.textContent = '';
    return true;
  }
}

function toggleSubmit() {
  let isDisabled = !(validateUrl() && validateTime())
  submitBtn.disabled = isDisabled;
  isDisabled ? submitBtn.classList.add('disabled') : submitBtn.classList.remove('disabled');
}

function removeBlockedSite(id) {
    // 1) Quitar del array en memoria
    blockedSites = blockedSites.filter(site => site.id !== id);
    // 2) Guardar en storage
    chrome.storage.local.set({ blockedSites });
    // 3) Quitar del DOM
    const li = document.getElementById(`blocked-item-${id}`);
    if (li) li.remove();
}
  
// JS EVENTOS-----------------------------------------------------------------------------------------------
//=========================================================================================================

// Cerrar el popup al hacer click en la "X"
document.getElementById('popup-close').addEventListener('click', () => {
  window.close();
});

// Eventos de validación en tiempo real
urlInput.addEventListener('keyup', toggleSubmit);
[hrsInput, minsInput, secsInput].forEach(i => i.addEventListener('keyup', toggleSubmit));

// Color picker oculto
previewDot.addEventListener('click', () => colorInput.click());
colorInput.addEventListener('input', () => previewDot.style.background = colorInput.value);

// Eventos de las opciones de tiempo
alwaysOption.addEventListener('click', () => {
  alwaysOption.classList.add('selected');
  withTimeOption.classList.remove('selected');
  timeGroup.style.display = 'none';
  siteObjForm.hasTime = false;
});
withTimeOption.addEventListener('click', () => {
  withTimeOption.classList.add('selected');
  alwaysOption.classList.remove('selected');
  timeGroup.style.display = 'block';
  siteObjForm.hasTime = true;
});

// Mostrar form
addBtn.addEventListener('click', () => {
  form.style.display = 'block';
  addBtn.style.display = 'none';
  addCurrentBtn.style.display = 'none';
});
addCurrentBtn.addEventListener('click', () => {
  form.style.display = 'block';
  addBtn.style.display = 'none';
  addCurrentBtn.style.display = 'none';
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    if (tabs.length === 0) return;
    const activeTab = tabs[0];
    urlInput.value = activeTab.url || ''; 
  });
});

// Cancelar form
cancelBtn.addEventListener('click', resetForm);

// Manejar envío: validar, persistir, actualizar UI
form.addEventListener('submit', e => {
  e.preventDefault();
  if (!validateUrl() || !validateTime()) return;

  // Crear objeto de sitio
  siteObjForm.id     = Date.now() + Math.floor(Math.random() * 1000);
  siteObjForm.domain = urlInput.value.replace(/^https?:\/\//, '');
  siteObjForm.color  = colorInput.value;
  
  if (!!siteObjForm.hasTime) {
    siteObjForm.time   = `${hrsInput.value.padStart(2,'0')}:` +
                         `${minsInput.value.padStart(2,'0')}:` +
                         `${secsInput.value.padStart(2,'0')}`;
  }

  // sent to background to block save and block site
  chrome.runtime.sendMessage({ action: 'addBlockedSite', siteObjForm }, (response) => {
    if (response.success) {
      blockedSites.push(siteObjForm);
      addBlockedSiteToDOM(siteObjForm);
      resetForm();
    }
  });

});

// Arranca
document.addEventListener('DOMContentLoaded', loadBlockedSites); 

  