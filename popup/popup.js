// popup.js

// alias para chrome.i18n.getMessage
const t = chrome.i18n.getMessage;

// main variables
let blockedSites = [];
let hasTimeToggle = null;

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
const noBlockedSites = document.getElementById('no-blocked-sites');
const alwaysOption = document.getElementById('always-option');
const withTimeOption = document.getElementById('with-time-option');
const timeGroup = document.getElementById('time-group');
const subHours = document.getElementById('sub-hours');
const addHours = document.getElementById('add-hours');
const subMins = document.getElementById('sub-mins');
const addMins = document.getElementById('add-mins');
const subSecs = document.getElementById('sub-secs');
const addSecs = document.getElementById('add-secs');

const generalError  = document.getElementById('general-error')

// Regex de validación
const urlRegex = /^(https?:\/\/)[^\s/$.?#].[^\s]*$/i;

/** Carga la lista desde chrome.storage.local al abrir el popup */
function loadBlockedSites() {
  chrome.storage.local.get({ blockedSites: [] }, ({ blockedSites: saved }) => {
    blockedSites = saved;
    if(blockedSites.length === 0){
      noBlockedSites.style.display = 'block';
    }else{
      noBlockedSites.style.display = 'none';
    }
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
    displayDomain = u.host;
  } catch {
    displayDomain = urlStr.replace(/^https?:\/\//, '');
  }
  if (!displayDomain) {
    // si por alguna razón sigue vacío, no renderiza el item
    return;
  }

  // Etiquetas cortas localizadas
  const H = t('hoursShort')   || 'H';
  const M = t('minutesShort') || 'M';
  const S = t('secondsShort') || 'S';
  const deleteTitle = t('titleDelete') || 'Delete';

  const li = document.createElement('li');
  li.className = 'blocked-item glass-bg';
  li.id = `blocked-item-${id}`;

  li.innerHTML = `
    <div style="display: flex; align-items: center; overflow-x: hidden;">
      <span class="dot" id="dot-${id}" style="background:${color}"></span>
      <span class="domain" id="domain-${id}">${displayDomain}</span>
    </div>
    <div style="display: flex; align-items: center; padding-left: .6rem;">
      ${
        time ? 
        `
          <div style="display: flex; align-items: center; margin-left: .4rem;">
            <time class="timer" style="font-size: .9rem;" id="timer-${id}">${time.split(':')[0]}</time>
            <span style="font-size: .8rem; font-weight: bold; padding-left: .2rem;">${H}</span>
          </div>
          <div style="display: flex; align-items: center; margin-left: .4rem;">
            <time class="timer" style="font-size: .9rem;" id="timer-${id}">${time.split(':')[1]}</time>
            <span style="font-size: .8rem; font-weight: bold; padding-left: .2rem;">${M}</span>
          </div>
          <div style="display: flex; align-items: center; margin-left: .4rem;">
            <time class="timer" style="font-size: .9rem;" id="timer-${id}">${time.split(':')[2]}</time>
            <span style="font-size: .8rem; font-weight: bold; padding-left: .2rem;">${S}</span>
          </div>
        `
        : ''
      }
      <button class="delete-btn" id="delete-${id}" title="${deleteTitle}">
          <svg xmlns="http://www.w3.org/2000/svg"
              width="24" height="24"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round">
            <!-- Tapa de la papelera -->
            <path d="M3 6h18"/>
            <path d="M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2"/>
            <!-- Cuerpo de la papelera -->
            <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>
            <!-- Líneas internas (barras de documento) -->
            <line x1="10" y1="11" x2="10" y2="17"/>
            <line x1="14" y1="11" x2="14" y2="17"/>
          </svg>
        </button>
    </div>
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
  hasTimeToggle = null;
  alwaysOption.classList.remove('selected');
  withTimeOption.classList.remove('selected');
  timeGroup.style.display = 'none';
  submitBtn.classList.add('disabled')
};
function validateURL() {
  if (!urlRegex.test(urlInput.value)) {
    urlInput.classList.add('input-error');
    urlError.textContent = t('errUrlInvalid');
    return false;
  } else {
    urlInput.classList.remove('input-error');
    urlError.textContent = '';
    return true;
  }
}
function validateAndClampTime() {
  let isValid = true;
  
  // Helper function to clamp value between min and max
  const clampValue = (value, min, max) => {
    const num = parseInt(value, 10) || min;
    return Math.min(Math.max(num, min), max);
  };

  // Validate and clamp hours (0-23)
  if (hrsInput.value !== '') {
    const clamped = clampValue(hrsInput.value, 0, 23);
    if (clamped.toString() !== hrsInput.value) {
      hrsInput.value = clamped;
    }
    hrsInput.classList.toggle('input-error', isNaN(clamped));
    isValid = isValid && !isNaN(clamped);
  }

  // Validate and clamp minutes (0-59)
  if (minsInput.value !== '') {
    const clamped = clampValue(minsInput.value, 0, 59);
    if (clamped.toString() !== minsInput.value) {
      minsInput.value = clamped;
    }
    minsInput.classList.toggle('input-error', isNaN(clamped));
    isValid = isValid && !isNaN(clamped);
  }

  // Validate and clamp seconds (0-59)
  if (secsInput.value !== '') {
    const clamped = clampValue(secsInput.value, 0, 59);
    if (clamped.toString() !== secsInput.value) {
      secsInput.value = clamped;
    }
    secsInput.classList.toggle('input-error', isNaN(clamped));
    isValid = isValid && !isNaN(clamped);
  }

  // Check if total time is at least 1 second
  if (isValid) {
    const hours = parseInt(hrsInput.value || '0', 10);
    const minutes = parseInt(minsInput.value || '0', 10);
    const seconds = parseInt(secsInput.value || '0', 10);
    const totalSeconds = (hours * 3600) + (minutes * 60) + seconds;
    
    if (totalSeconds < 1) {
      timeError.textContent = t('errTimeMin');;
      timeError.style.display = 'block';
      isValid = false;
    } else {
      timeError.style.display = 'none';
    }
  } else {
    timeError.textContent = t('errTimeInvalid');
    timeError.style.display = 'block';
  }

  return isValid;
}

function toggleSummitButton() {
  const isURLValid = validateURL();
  let isTimeValid = true;
  
  if (hasTimeToggle === true) {
    isTimeValid = validateAndClampTime();
  }
  
  const isDisabled = hasTimeToggle === null || !isURLValid || (hasTimeToggle && !isTimeValid);
  
  submitBtn.disabled = isDisabled;
  isDisabled ? submitBtn.classList.add('disabled') : submitBtn.classList.remove('disabled');
  return isDisabled;
}

async function removeBlockedSite(id) {
  let resp;
  try {
    resp = await chrome.runtime.sendMessage({ action: 'removeBlockedSite', id });
  } catch (e) {
    console.error('removeBlockedSite error:', e);
    return;
  }
  if (!resp?.success) {
    console.error('removeBlockedSite error:', resp?.error || 'Desconocido');
    return;
  }

  blockedSites = blockedSites.filter(site => site.id !== id);

  const li = document.getElementById(`blocked-item-${id}`);
  if (li) li.remove();
}

  
// JS EVENTOS-----------------------------------------------------------------------------------------------
//=========================================================================================================

// Cerrar el popup al hacer click en la "X"
document.getElementById('popup-close').addEventListener('click', () => {
  window.close();
});

addHours.addEventListener('click', () => {
  if(hrsInput.value.length === 0){
    hrsInput.value = 1;
  } else {
    let newValue = parseInt(hrsInput.value, 10) + 1;
    hrsInput.value = newValue > 23 ? 0 : newValue;
    timeError.style.display = 'none';
    hrsInput.classList.remove('input-error');
  }
  toggleSummitButton();
})
addMins.addEventListener('click', () => {
  if(minsInput.value.length === 0){
    minsInput.value = 1;
  } else {
    let newValue = parseInt(minsInput.value, 10) + 1;
    minsInput.value = newValue > 59 ? 0 : newValue;
    timeError.style.display = 'none';
    minsInput.classList.remove('input-error');
  }
  toggleSummitButton();
})
addSecs.addEventListener('click', () => {
  if(secsInput.value.length === 0){
    secsInput.value = 1;
  } else {
    let newValue = parseInt(secsInput.value, 10) + 1;
    secsInput.value = newValue > 59 ? 0 : newValue;
    timeError.style.display = 'none';
    secsInput.classList.remove('input-error');
  }
  toggleSummitButton();
})
subHours.addEventListener('click', () => {
  if(hrsInput.value.length === 0){
    hrsInput.value = 23;
  } else {
    let newValue = parseInt(hrsInput.value, 10) - 1;
    hrsInput.value = newValue < 0 ? 23 : newValue;
    timeError.style.display = 'none';
    hrsInput.classList.remove('input-error');
  }
  toggleSummitButton();
})
subMins.addEventListener('click', () => {
  if(minsInput.value.length === 0){
    minsInput.value = 59;
  } else {
    let newValue = parseInt(minsInput.value, 10) - 1;
    minsInput.value = newValue < 0 ? 59 : newValue;
    timeError.style.display = 'none';
    minsInput.classList.remove('input-error');
  }
  toggleSummitButton();
})
subSecs.addEventListener('click', () => { 
  if(secsInput.value.length === 0){
    secsInput.value = 59;
  } else {
    let newValue = parseInt(secsInput.value, 10) - 1;
    secsInput.value = newValue < 0 ? 59 : newValue;
    timeError.style.display = 'none';
    secsInput.classList.remove('input-error');
  }
  toggleSummitButton();
})

// Eventos de validación en tiempo real
const validateInput = (e) => {
  // Only allow numbers
  e.target.value = e.target.value.replace(/[^0-9]/g, '');
  toggleSummitButton();
};

urlInput.addEventListener('input', toggleSummitButton);
[hrsInput, minsInput, secsInput].forEach(input => {
  input.addEventListener('input', validateInput);
  input.addEventListener('blur', () => {
    // Ensure values are clamped when input loses focus
    if (input.value !== '') {
      const min = 0;
      const max = input === hrsInput ? 23 : 59;
      const num = parseInt(input.value, 10) || min;
      input.value = Math.min(Math.max(num, min), max);
    }
    toggleSummitButton();
  });
});

// Color picker oculto
previewDot.addEventListener('click', () => colorInput.click());
colorInput.addEventListener('input', () => previewDot.style.background = colorInput.value);

// Eventos de las opciones de tiempo
alwaysOption.addEventListener('click', () => {
  alwaysOption.classList.add('selected');
  withTimeOption.classList.remove('selected');
  timeGroup.style.display = 'none';
  hasTimeToggle = false;
  toggleSummitButton();
});
withTimeOption.addEventListener('click', () => {
  withTimeOption.classList.add('selected');
  alwaysOption.classList.remove('selected');
  timeGroup.style.display = 'block';
  hasTimeToggle = true;
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
  if (hasTimeToggle === null) return;

  const url= new URL(urlInput.value.trim());
  const urlWithoutPathname = `${url.protocol}//${url.host}`;

  const siteToSave = {
    id: Date.now() + Math.floor(Math.random() * 1000),
    fullUrl: urlWithoutPathname,
    color: colorInput.value,
    hasTime: !!hasTimeToggle,
    time: hasTimeToggle
      ? `${hrsInput.value.padStart(2,'0')}:${minsInput.value.padStart(2,'0')}:${secsInput.value.padStart(2,'0')}`
      : null,
  };

  if (blockedSites.some(s => s.fullUrl === siteToSave.fullUrl)) {
    generalError.style.display = 'block';
    generalError.textContent = t('errDuplicateUrl');
    return;
  }

  generalError.textContent = '';
  generalError.style.display = 'none';

  try {
    const resp = await chrome.runtime.sendMessage({ action: 'addBlockedSite', siteObjForm: siteToSave });
    if (resp?.success) {
      blockedSites.push(resp?.site);
      addBlockedSiteToDOM(resp?.site);
      noBlockedSites.style.display = 'none';
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
document.addEventListener('DOMContentLoaded', () => {
  document.documentElement.lang = chrome.i18n.getMessage('@@ui_locale');
  loadBlockedSites();
});
