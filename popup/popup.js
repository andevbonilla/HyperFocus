// popup.js

// main variables
let blockedSites = [];
let siteObjForm = {
  id: null,
  fullUrl: null,
  time: null,
  color: null,
  hasTime: null
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

const generalError  = document.getElementById('general-error')

// Regex de validación
const urlRegex = /^(https?:\/\/)[^\s/$.?#].[^\s]*$/i;

/** Carga la lista desde chrome.storage.local al abrir el popup */
function loadBlockedSites() {
  chrome.storage.local.get({ blockedSites: [] }, ({ blockedSites: saved }) => {
    blockedSites = saved;
    console.log(blockedSites, "8888");
    blockedSites.forEach(site => {
      addBlockedSiteToDOM(site);
    });
  });
}

async function addBlockedSiteToDOM(site) {
  if (!site) return;
  const { id, fullUrl, time, color } = site;

  const urlStr = typeof fullUrl === 'string' ? fullUrl : '';
  let displayDomain = urlStr;
  try {
    const u = new URL(urlStr);
    displayDomain = u.host + (u.pathname !== '/' ? u.pathname : '');
  } catch {
    displayDomain = urlStr.replace(/^https?:\/\//, '');
  }
  if (!displayDomain) {
    // si por alguna razón sigue vacío, no renderiza el item
    return;
  }

  const li = document.createElement('li');
  li.className = 'blocked-item';
  li.id = `blocked-item-${id}`;
  li.innerHTML = `
    <span class="dot" id="dot-${id}" style="background:${color}"></span>
    <span class="domain" id="domain-${id}">${displayDomain}</span>
    <time class="timer" id="timer-${id}">${time ?? ''}</time>
    <button class="delete-btn" id="delete-${id}" title="Eliminar">
      <!-- svg -->
    </button>
  `;
  li.querySelector('.delete-btn').addEventListener('click', async () => await removeBlockedSite(id));
  list.appendChild(li);
}


// Resetea y oculta el formulario
function resetForm() {
  form.reset();
  previewDot.style.background = '#ff3b3b';
  form.style.display = 'none';
  addBtn.style.display = 'block';
  addCurrentBtn.style.display = 'block';
  siteObjForm.id = null;
  siteObjForm.fullUrl = null;
  siteObjForm.time = null;
  siteObjForm.color = null;
  siteObjForm.hasTime = null;
  submitBtn.classList.add('disabled')
};
function validateURL() {
  if (!urlRegex.test(urlInput.value)) {
    urlInput.classList.add('input-error');
    urlError.textContent = 'URL inválida, debe empezar por http:// o https://';
    return false;
  } else {
    urlInput.classList.remove('input-error');
    urlError.textContent = '';
    return true;
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

function toggleSummitButton() {

  let isDisabled = true;

  if(siteObjForm.hasTime === null){
    isDisabled = true;
  }else if(siteObjForm.hasTime === true){
    isDisabled = !(validateURL() && validateTime())
  }else{
    isDisabled = !validateURL()
  }

  submitBtn.disabled = isDisabled;
  isDisabled ? submitBtn.classList.add('disabled') : submitBtn.classList.remove('disabled');
  return isDisabled;
}

async function removeBlockedSite(id) {
    // 1) Quitar del array en memoria
    blockedSites = blockedSites.filter(site => site.id !== id);
    // 2) Guardar en storage
    await chrome.storage.local.set({ blockedSites });
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
urlInput.addEventListener('keyup', toggleSummitButton);
[hrsInput, minsInput, secsInput].forEach(i => i.addEventListener('keyup', toggleSummitButton));

// Color picker oculto
previewDot.addEventListener('click', () => colorInput.click());
colorInput.addEventListener('input', () => previewDot.style.background = colorInput.value);

// Eventos de las opciones de tiempo
alwaysOption.addEventListener('click', () => {
  alwaysOption.classList.add('selected');
  withTimeOption.classList.remove('selected');
  timeGroup.style.display = 'none';
  siteObjForm.hasTime = false;
  siteObjForm.time = null;
  toggleSummitButton();
});
withTimeOption.addEventListener('click', () => {
  withTimeOption.classList.add('selected');
  alwaysOption.classList.remove('selected');
  timeGroup.style.display = 'block';
  siteObjForm.hasTime = true;
  toggleSummitButton();
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
form.addEventListener('submit', async (e) => {
  e.preventDefault();
  if (!!toggleSummitButton() && !validateURL()) return;

  const siteToSave = {
    id: Date.now() + Math.floor(Math.random() * 1000),
    fullUrl: urlInput.value.trim(),
    color: colorInput.value,
    hasTime: !!siteObjForm.hasTime,
    time: siteObjForm.hasTime
      ? `${hrsInput.value.padStart(2,'0')}:${minsInput.value.padStart(2,'0')}:${secsInput.value.padStart(2,'0')}`
      : null,
  };

  if (blockedSites.some(s => s.fullUrl === siteToSave.fullUrl)) {
    generalError.style.display = 'block';
    generalError.textContent = 'Ya existe un sitio con esa URL';
    return;
  }

  generalError.textContent = '';
  generalError.style.display = 'none';

  try {
    const resp = await chrome.runtime.sendMessage({ action: 'addBlockedSite', siteObjForm: siteToSave });
    if (resp?.success) {
      blockedSites.push(siteToSave);
      addBlockedSiteToDOM(siteToSave);
      resetForm();
    } else {
      console.error('addBlockedSite error:', resp?.error);
      generalError.textContent = resp?.error;
    }
  } catch (e) {
    console.error('addBlockedSite error:', e);
    generalError.textContent = e.message;
  }

});


// Arranca
document.addEventListener('DOMContentLoaded', loadBlockedSites); 

  