(function () {
  if (window.__jalfiaContentLoaded) return;
  window.__jalfiaContentLoaded = true;
  const IS_TOP_FRAME = window.top === window;

  const PANEL_ID = 'jalfia-assistant-panel';
  const ANALYSIS_OVERLAY_ID = 'jalfia-analysis-overlay';
  const FIELD_SELECTOR = [
    'input:not([type="hidden"]):not([disabled])',
    'textarea:not([disabled])',
    'select:not([disabled])',
    '[role="switch"]:not([aria-disabled="true"])',
    '[role="checkbox"]:not([aria-disabled="true"])',
    '[role="radio"]:not([aria-disabled="true"])',
    '[contenteditable="true"]'
  ].join(',');

  const state = {
    fields: [],
    frameFields: [],
    frames: [],
    memory: null,
    memorySignature: '',
    memoryBusy: false,
    memoryForgotten: '',
    frameScope: 'all',
    frameRefresh: null,
    frameUnlock: null,
    scopeRoot: null,
    cancelScopeSelection: null,
    optionCache: new Map(),
    analyzingOptions: false,
    analysisOverlay: null,
    panel: null,
    shadow: null,
    minimized: false,
    dragging: false,
    recognition: null,
    stopVoice: null,
    listening: false,
    activeVoiceFieldId: '',
    pendingFocusFieldId: '',
    draftValues: new Map(),
    domObserver: null,
    rescanTimer: 0,
    rescanInterval: 0,
    lastFieldSignature: '',
    lastDetectedCount: 0,
    statusMessage: '',
    activeFieldIndex: 0,
    previewMode: false,
    previewValues: [],
    formClearFieldIds: new Set(),
    hiddenFieldIds: new Set(),
    opacity: 0.96,
    settingsMode: false,
    voiceMode: true,
    voiceTranscript: '',
    voiceCorrectedText: '',
    voiceShowText: false,
    voiceActions: [],
    voiceActionIndex: 0,
    voicePreview: false,
    voiceBusy: false,
    voiceSubmit: false,
    darkMode: false,
    position: { x: 24, y: 24 },
    size: { width: 430, height: 475 }
  };

  function normalizeText(value) {
    return String(value || '').replace(/\s+/g, ' ').trim();
  }

  function saveSettings() {
    chrome.runtime.sendMessage({ type: 'JALFIA_SAVE_UI_SETTINGS', settings: { opacity: state.opacity, darkMode: state.darkMode } })
      .catch(() => showStatus('No pude guardar los ajustes.'));
  }

  chrome.runtime.sendMessage({ type: 'JALFIA_GET_UI_SETTINGS' }).then(({ jalfiaSettings }) => {
    if (!jalfiaSettings) return;
    if (Number.isFinite(jalfiaSettings.opacity)) state.opacity = Math.min(1, Math.max(0.55, jalfiaSettings.opacity));
    state.darkMode = jalfiaSettings.darkMode === true;
    if (state.shadow && !state.minimized && !state.listening) renderPanel();
  }).catch(() => {});

  function escapeHtml(value) {
    return String(value || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  function isVisible(element) {
    const rect = element.getBoundingClientRect();
    const style = window.getComputedStyle(element);
    return rect.width > 0 &&
      rect.height > 0 &&
      style.visibility !== 'hidden' &&
      style.display !== 'none' &&
      style.opacity !== '0';
  }

  function numericZIndex(element) {
    const value = window.getComputedStyle(element).zIndex;
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  function isInsidePanel(element) {
    return Boolean(element.closest(`#${PANEL_ID}, #${ANALYSIS_OVERLAY_ID}`));
  }

  function blockingContextSelectors() {
    return [
      '[aria-modal="true"]',
      '[role="dialog"][aria-modal="true"]',
      '[role="alertdialog"]',
      'dialog[open]',
      '.modal.show',
      '.modal[style*="display: block"]',
      '.v-dialog',
      '.MuiDialog-root',
      '.MuiDialog-container',
      '.mat-mdc-dialog-container',
      '.mat-dialog-container',
      '.p-dialog',
      '.ant-modal',
      '.el-dialog',
      '[class*="modal"]',
      '[class*="dialog"]',
      '[class*="drawer"]'
    ].join(',');
  }

  function isAuxiliaryPopup(element) {
    return Boolean(element.closest([
      '[role="listbox"]',
      '[role="menu"]',
      '[role="tooltip"]',
      '.v-overlay__content',
      '.v-overlay-container',
      '.v-menu',
      '.v-list',
      '.MuiPopover-root',
      '.MuiAutocomplete-popper',
      '.cdk-overlay-pane',
      '.ant-select-dropdown',
      '.p-dropdown-panel',
      '[class*="popover"]'
    ].join(',')));
  }

  function contextScore(element, index) {
    const rect = element.getBoundingClientRect();
    const style = window.getComputedStyle(element);
    const positioned = ['fixed', 'absolute', 'sticky'].includes(style.position) ? 1000 : 0;
    const modal = element.matches('[aria-modal="true"], [role="dialog"][aria-modal="true"], [role="alertdialog"], dialog[open]') ? 5000 : 0;
    return modal + positioned + numericZIndex(element) + index / 1000 + Math.min(rect.width * rect.height, 500000) / 1000000;
  }

  function getActiveContextRoot() {
    if (state.scopeRoot?.isConnected) return state.scopeRoot;
    state.scopeRoot = null;
    const candidates = Array.from(document.querySelectorAll(blockingContextSelectors()))
      .filter((element) => !isInsidePanel(element))
      .filter((element) => !isAuxiliaryPopup(element))
      .filter(isVisible)
      .filter((element) => element.querySelector(FIELD_SELECTOR));

    if (!candidates.length) return document;

    return candidates
      .map((element, index) => ({ element, score: contextScore(element, index) }))
      .sort((a, b) => b.score - a.score)[0].element;
  }

  function isInteractable(element) {
    if (element.matches('input[type="checkbox"], input[type="radio"]')) {
      const visual = element.parentElement?.closest('.v-input, .v-selection-control, label, [role="switch"], [role="checkbox"], [role="radio"]');
      if (visual && isVisible(visual)) return true;
    }
    return isVisible(element);
  }

  function fieldKind(element) {
    const tag = element.tagName.toLowerCase();
    const type = (element.getAttribute('type') || '').toLowerCase();
    const role = (element.getAttribute('role') || '').toLowerCase();
    const hasPopup = (element.getAttribute('aria-haspopup') || '').toLowerCase();
    const vuetifyRoot = element.closest('.v-select, .v-autocomplete, .v-combobox');
    if (role === 'switch') return 'switch';
    if (role === 'checkbox') return 'checkbox';
    if (role === 'radio') return 'radio';
    if (type === 'checkbox' && element.closest('.v-switch, .v-input--switch, [role="switch"]')) return 'switch';

    if (tag !== 'select' && (role === 'combobox' || hasPopup === 'listbox' || vuetifyRoot)) {
      if (element.closest('.v-autocomplete')) return 'autocomplete';
      if (element.closest('.v-combobox')) return 'combobox';
      if (element.readOnly || element.getAttribute('readonly') !== null || element.closest('.v-select')) return 'combobox';
      return 'autocomplete';
    }

    if (tag === 'select') return 'select';
    if (tag === 'textarea') return 'textarea';
    if (element.isContentEditable) return 'richtext';
    if (type === 'checkbox') return 'checkbox';
    if (type === 'radio') return 'radio';
    if (type === 'number' || type === 'range') return 'number';
    if (type === 'date' || type === 'datetime-local' || type === 'month' || type === 'time') return type;
    if (type === 'email' || type === 'tel' || type === 'url' || type === 'password') return type;
    return 'text';
  }

  function selectableOptionNode(node) {
    const option = node.closest('[role="option"], .v-list-item, button, a[href]') || node;
    if (!isVisible(option) || option.closest('[disabled], [aria-disabled="true"], [inert], .v-list-item--disabled, .v-list-item--non-interactive, .v-autocomplete__no-data, [role="status"], [role="alert"]')) return null;
    const selectable = option.matches('[role="option"], button, a[href], [role="button"], .v-list-item--link, .v-list-item--clickable, [tabindex]');
    return selectable ? option : null;
  }

  function optionFromNode(node) {
    node = selectableOptionNode(node);
    if (!node) return null;
    const text = normalizeText(node.innerText || node.textContent || node.getAttribute('aria-label'));
    if (!text) return null;
    return {
      value: node.getAttribute('data-value') || node.getAttribute('value') || text,
      text,
      selected: node.getAttribute('aria-selected') === 'true' || node.classList.contains('v-list-item--active')
    };
  }

  function uniqueOptions(options) {
    const seen = new Set();
    return options.filter((option) => {
      const key = `${option.value}|${option.text}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  function listboxesFor(element) {
    const wrapper = element.closest('[role="combobox"], .v-select, .v-autocomplete, .v-combobox');
    const controls = [element, wrapper].filter(Boolean)
      .flatMap((node) => [node.getAttribute('aria-controls'), node.getAttribute('aria-owns')])
      .filter(Boolean).join(' ');
    const byControls = controls
      ? controls
        .split(/\s+/)
        .map((id) => document.getElementById(id))
        .filter(Boolean)
      : [];

    const expandedListboxes = (element.getAttribute('aria-expanded') === 'true' || wrapper?.getAttribute('aria-expanded') === 'true' || document.activeElement === element)
      ? Array.from(document.querySelectorAll('[role="listbox"]')).filter(isVisible)
      : [];

    // Sin una relacion explicita, no mezclar varios menus abiertos.
    return byControls.length ? byControls : expandedListboxes.length === 1 ? expandedListboxes : [];
  }

  function listboxOptionsFor(element) {
    const listboxes = listboxesFor(element);
    return uniqueOptions(listboxes.filter(isVisible).flatMap((listbox) =>
      Array.from(listbox.querySelectorAll('[role="option"], .v-list-item, .v-list-item-title'))
        .map(optionFromNode)
        .filter(Boolean)
    ));
  }

  function getFieldId(element, index) {
    if (!element.dataset.jalfiaFieldId) {
      element.dataset.jalfiaFieldId = `jalfia-${Date.now()}-${index}-${Math.random().toString(36).slice(2)}`;
    }
    return element.dataset.jalfiaFieldId;
  }

  function labelFromFor(element) {
    if (!element.id) return '';
    const label = document.querySelector(`label[for="${CSS.escape(element.id)}"]`);
    return label ? normalizeText(label.innerText || label.textContent) : '';
  }

  function labelFromWrapper(element) {
    const label = element.closest('label');
    return label ? normalizeText(label.innerText || label.textContent) : '';
  }

  function labelFromAria(element) {
    const ariaLabel = element.getAttribute('aria-label');
    if (ariaLabel) return normalizeText(ariaLabel);

    const ariaLabelledBy = element.getAttribute('aria-labelledby');
    if (!ariaLabelledBy) return '';

    return normalizeText(
      ariaLabelledBy
        .split(/\s+/)
        .map((id) => document.getElementById(id))
        .filter(Boolean)
        .map((node) => node.innerText || node.textContent)
        .join(' ')
    );
  }

  function labelFromNearbyText(element) {
    const candidates = [];
    let current = element.parentElement;

    for (let depth = 0; current && depth < 3; depth += 1) {
      const text = normalizeText(current.innerText || current.textContent);
      if (text) candidates.push(text);
      current = current.parentElement;
    }

    return candidates
      .map((text) => text.replace(normalizeText(element.value || ''), '').trim())
      .find(Boolean) || '';
  }

  function inferLabel(element) {
    return normalizeText(
      labelFromFor(element) ||
      labelFromWrapper(element) ||
      labelFromAria(element) ||
      normalizeText(element.closest('.v-input, .v-selection-control')?.querySelector('label')?.textContent) ||
      element.getAttribute('placeholder') ||
      element.getAttribute('name') ||
      element.id ||
      labelFromNearbyText(element) ||
      'Campo sin nombre'
    );
  }

  function readFieldRules(element) {
    const attributes = {};
    for (const name of ['minlength', 'maxlength', 'pattern', 'min', 'max', 'step', 'inputmode']) {
      const value = element.getAttribute(name);
      if (value !== null && value !== '') attributes[name] = value;
    }
    const ids = [element.getAttribute('aria-describedby'), element.getAttribute('aria-errormessage')].filter(Boolean).join(' ').split(/\s+/).filter(Boolean);
    const related = ids.map(id => document.getElementById(id)).filter(Boolean);
    const wrapper = element.closest('.v-input, .v-field, .form-group, .MuiFormControl-root');
    const messages = related.map(node => normalizeText(node.textContent)).filter(Boolean);
    const errors = related.filter(node => node.getAttribute('role') === 'alert' || element.getAttribute('aria-errormessage')?.split(/\s+/).includes(node.id))
      .concat(Array.from(wrapper?.querySelectorAll('.v-messages__message, .invalid-feedback, .Mui-error, [role="alert"]') || []).filter(isVisible))
      .map(node => normalizeText(node.textContent)).filter(Boolean);
    if (element.validationMessage && element.validity?.valid === false) errors.push(element.validationMessage);
    return {
      ...attributes,
      required: Boolean(element.required || element.getAttribute('aria-required') === 'true'),
      mask: element.getAttribute('data-mask') || element.getAttribute('data-inputmask') || '',
      hint: element.getAttribute('placeholder') || '',
      messages: [...new Set(messages)], errors: [...new Set(errors)]
    };
  }

  function renderFieldRules(field) {
    const rules = field.rules;
    if (!rules) return '';
    const labels = [];
    if (rules.required) labels.push('Obligatorio');
    if (field.kind === 'number') labels.push('Número');
    if (['email', 'url', 'date', 'time'].includes(field.kind)) labels.push(`Tipo: ${field.kind}`);
    if (rules.minlength) labels.push(`Mínimo ${rules.minlength} caracteres`);
    if (rules.maxlength) labels.push(`Máximo ${rules.maxlength} caracteres`);
    if (rules.min) labels.push(`Valor mínimo: ${rules.min}`);
    if (rules.max) labels.push(`Valor máximo: ${rules.max}`);
    if (rules.step) labels.push(`Incremento: ${rules.step}`);
    if (rules.pattern) labels.push(`Patrón: ${rules.pattern}`);
    if (rules.mask) labels.push(`Máscara declarada: ${rules.mask}`);
    if (rules.inputmode) labels.push(`Teclado sugerido: ${rules.inputmode} (no restringe caracteres)`);
    return `<details class="field-rules"><summary>Reglas y validación</summary>
      <p>${labels.length ? escapeHtml(labels.join(' · ')) : 'Restricciones no declaradas. Puede haber validación adicional al enviar.'}</p>
      ${rules.hint ? `<p>Ejemplo o indicación: ${escapeHtml(rules.hint)}</p>` : ''}
      ${rules.messages.map(message => `<p>${escapeHtml(message)}</p>`).join('')}
      ${rules.errors.map(message => `<p class="validation-error">Mensaje actual del formulario: ${escapeHtml(message)}</p>`).join('')}
      <small>Lectura del formulario; no se probó qué caracteres rechaza.</small>
    </details>`;
  }

  function validateFieldValue(field, value) {
    const rules = field.rules || {};
    const text = String(value ?? '');
    const errors = [];
    if (rules.required && (!text || (['switch', 'checkbox'].includes(field.kind) && !normalizeBoolean(value)))) errors.push('El campo es obligatorio.');
    if (!text || ['switch', 'checkbox', 'radio', 'select', 'combobox', 'autocomplete'].includes(field.kind)) return errors;
    if (rules.minlength && text.length < Number(rules.minlength)) errors.push(`Requiere al menos ${rules.minlength} caracteres.`);
    if (rules.maxlength && text.length > Number(rules.maxlength)) errors.push(`Admite como máximo ${rules.maxlength} caracteres.`);
    const probe = document.createElement('input');
    probe.type = ['number', 'email', 'url', 'date', 'datetime-local', 'month', 'time'].includes(field.kind) ? field.kind : 'text';
    for (const name of ['pattern', 'min', 'max', 'step']) if (rules[name]) probe.setAttribute(name, rules[name]);
    probe.value = text;
    if (!probe.value && text && probe.type !== 'text') errors.push('El valor no tiene el formato esperado.');
    const validity = probe.validity;
    if (validity?.typeMismatch) errors.push('El valor no tiene el formato esperado.');
    if (validity?.patternMismatch) errors.push('El valor no coincide con el patrón del campo.');
    if (validity?.rangeUnderflow) errors.push(`El valor debe ser mayor o igual a ${rules.min}.`);
    if (validity?.rangeOverflow) errors.push(`El valor debe ser menor o igual a ${rules.max}.`);
    if (validity?.stepMismatch) errors.push('El valor no respeta el incremento permitido.');
    return [...new Set(errors)];
  }

  function describeField(element, index) {
    const id = getFieldId(element, index);
    const kind = fieldKind(element);
    const tag = element.tagName.toLowerCase();
    let options = tag === 'select'
      ? Array.from(element.options).map((option) => ({
        value: option.value,
        text: normalizeText(option.textContent),
        selected: option.selected
      }))
      : ['combobox', 'autocomplete'].includes(kind)
        ? listboxOptionsFor(element)
      : [];

    if (['combobox', 'autocomplete'].includes(kind)) {
      if (options.length) state.optionCache.set(id, { options, loaded: true });
      else options = state.optionCache.get(id)?.options || [];
    }

    return {
      id,
      label: inferLabel(element),
      kind,
      tag,
      type: element.getAttribute('type') || tag,
      name: element.getAttribute('name') || '',
      nativeId: element.id || '',
      placeholder: element.getAttribute('placeholder') || '',
      required: Boolean(element.required || element.getAttribute('aria-required') === 'true'),
      currentValue: ['switch', 'checkbox', 'radio'].includes(kind)
        ? booleanState(element)
        : element.value || element.textContent || '',
      options,
      rules: readFieldRules(element),
      optionsLoaded: state.optionCache.get(id)?.loaded === true
    };
  }

  function scanFields() {
    const root = getActiveContextRoot();
    state.fields = Array.from(root.querySelectorAll(FIELD_SELECTOR))
      .filter((element) => !isInsidePanel(element))
      .filter((element) => !element.closest('[aria-disabled="true"], [inert]'))
      .filter((element) => !element.matches('[role="switch"], [role="checkbox"], [role="radio"]') || !element.querySelector('input[type="checkbox"], input[type="radio"]'))
      .filter((element) => isInteractable(element, root))
      .map(describeField);
    for (const field of state.fields) {
      const remembered = state.memory?.fields?.filter(item => item.key === memoryFieldKey(field) && item.kind === field.kind) || [];
      if (remembered.length === 1) field.rememberedStrategy = remembered[0].strategy;
    }
    if (IS_TOP_FRAME && !state.scopeRoot) {
      if (state.frameScope !== 'all' && state.frameScope !== 'top') state.fields = [];
      if (state.frameScope !== 'top') state.fields.push(...state.frameFields.filter(field => state.frameScope === 'all' || String(field.frameId) === state.frameScope));
    }
    const ids = new Set(state.fields.map((field) => field.id));
    for (const map of [state.optionCache, state.draftValues]) {
      for (const id of map.keys()) if (!ids.has(id)) map.delete(id);
    }
    for (const set of [state.hiddenFieldIds, state.formClearFieldIds]) {
      for (const id of set) if (!ids.has(id)) set.delete(id);
    }
    return state.fields;
  }

  function memoryFieldKey(field) {
    const stableId = (field.nativeId || '').replace(/\d+/g, '#');
    return JSON.stringify([stableId, field.name || '', field.label, field.kind]);
  }

  function memorySnapshot() {
    const root = getActiveContextRoot();
    const context = root === document ? 'document' : [root.tagName, root.id?.replace(/\d+/g, '#'), root.getAttribute('role'), root.getAttribute('aria-label')].filter(Boolean).join(':');
    const route = new URLSearchParams(location.search).get('id') || '';
    return { origin: location.origin === 'null' ? 'file:///' : location.origin, path: location.pathname, context,
      route: /^[A-Za-z]+\/[A-Za-z/]+$/.test(route) ? route : '',
      fields: state.fields.filter(field => !field.frameId).map(field => ({ key: memoryFieldKey(field), label: field.label, kind: field.kind, name: field.name, nativeId: field.nativeId?.replace(/\d+/g, '#'), rules: field.rules })) };
  }

  async function syncMemory(force = false) {
    if (state.memoryBusy) return;
    const snapshot = memorySnapshot();
    const signature = JSON.stringify(snapshot);
    if ((!force && signature === state.memorySignature) || signature === state.memoryForgotten) return;
    state.memoryBusy = true;
    try {
      const response = await chrome.runtime.sendMessage({ type: 'JALFIA_MEMORY_SYNC', snapshot });
      if (!response?.ok) return;
      state.memory = response; state.memorySignature = signature;
      if (state.settingsMode && state.shadow) renderPanel();
    } finally { state.memoryBusy = false; }
  }

  async function rememberSuccess(fieldId, strategy, expected) {
    await wait(120);
    const field = state.fields.find(field => field.id === fieldId);
    if (!field || field.frameId) return;
    const element = document.querySelector(`[data-jalfia-field-id="${CSS.escape(fieldId)}"]`);
    if (!element?.isConnected || element.validity?.valid === false || element.getAttribute('aria-invalid') === 'true') return;
    const actual = ['switch', 'checkbox', 'radio'].includes(field.kind) ? String(booleanState(element)) : element.isContentEditable ? element.textContent : element.value;
    const selected = element.selectedOptions?.[0]?.textContent;
    if (normalizeComparable(actual) !== normalizeComparable(expected) && normalizeComparable(selected) !== normalizeComparable(expected)) return;
    const snapshot = memorySnapshot();
    if (JSON.stringify(snapshot) === state.memoryForgotten) return;
    const response = await chrome.runtime.sendMessage({ type: 'JALFIA_MEMORY_SUCCESS', snapshot, fieldKey: memoryFieldKey(field), strategy });
    if (response?.ok) state.memory = response;
  }

  async function refreshFrames() {
    if (!IS_TOP_FRAME) return;
    if (state.frameRefresh) return state.frameRefresh;
    state.frameRefresh = (async () => {
      const response = await chrome.runtime.sendMessage({ type: 'JALFIA_COLLECT_FRAMES' });
      if (!response?.ok) throw new Error(response?.error || 'No pude leer los iframes.');
      state.frames = response.frames;
      state.frameFields = response.frames.flatMap(frame => frame.fields.map(field => ({ ...field, id: `frame-${frame.frameId}-${frame.documentId}-${field.id}`, localFieldId: field.id, frameId: frame.frameId, documentId: frame.documentId, frameTitle: frame.title })));
      if (!['all', 'top'].includes(state.frameScope) && !state.frames.some(frame => String(frame.frameId) === state.frameScope)) state.frameScope = 'all';
    })();
    try { await state.frameRefresh; } finally { state.frameRefresh = null; }
  }

  function frameRequest(field, operation, value) {
    return chrome.runtime.sendMessage({ type: 'JALFIA_FRAME_REQUEST', frameId: field.frameId, documentId: field.documentId, fieldId: field.localFieldId, operation, value });
  }

  function dispatchInputEvents(element) {
    element.dispatchEvent(new Event('input', { bubbles: true }));
    element.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function normalizeBoolean(value) {
    if (typeof value === 'boolean') return value;
    return ['1', 'si', 'true', 'x', 'on', 'checked', 'marcado'].includes(
      String(value || '').trim().toLowerCase()
    );
  }

  function booleanState(element) {
    return element.matches('input[type="checkbox"], input[type="radio"]')
      ? element.checked : element.getAttribute('aria-checked') === 'true';
  }

  async function setBooleanValue(element, value, kind) {
    const desired = normalizeBoolean(value);
    if (booleanState(element) === desired) return { ok: true };
    if (kind === 'radio' && !desired) return { ok: false, reason: 'Selecciona otra opcion del grupo para desmarcar este radio' };
    element.click();
    await wait(80);
    return booleanState(element) === desired
      ? { ok: true } : { ok: false, reason: 'El control no confirmo el cambio de estado' };
  }

  function setSelectValue(element, rawValue) {
    const value = String(rawValue || '').trim().toLowerCase();
    const options = Array.from(element.options);
    const match = options.find((option) =>
      option.value.toLowerCase() === value ||
      normalizeText(option.textContent).toLowerCase() === value
    ) || options.find((option) =>
      option.value.toLowerCase().includes(value) ||
      normalizeText(option.textContent).toLowerCase().includes(value)
    );

    if (!match) return false;

    element.value = match.value;
    dispatchInputEvents(element);
    return true;
  }

  function wait(ms) {
    return new Promise((resolve) => {
      window.setTimeout(resolve, ms);
    });
  }

  async function obtainFieldOptions(fieldId) {
    const remote = state.fields.find(field => field.id === fieldId && field.frameId);
    if (remote) {
      const response = await frameRequest(remote, 'options');
      if (!response?.ok || !response.field) throw new Error(response?.reason || 'El campo del iframe ya no está disponible.');
      Object.assign(remote, response.field, { id: fieldId });
      return remote.options.length > 0;
    }
    const element = document.querySelector(`[data-jalfia-field-id="${CSS.escape(fieldId)}"]`);
    if (!element?.isConnected || !['combobox', 'autocomplete'].includes(fieldKind(element))) return false;
    const previousFocus = document.activeElement;
    const wasOpen = listboxesFor(element).some(isVisible);
    try {
      if (!wasOpen) {
        element.focus({ preventScroll: true });
        element.click();
        await wait(100);
        if (!listboxesFor(element).some(isVisible)) {
          element.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', code: 'ArrowDown', bubbles: true }));
        }
      }
      let options = [];
      // Esperar menus y respuestas asincronicas sin escribir ni seleccionar opciones.
      for (let attempt = 0; attempt < 15; attempt += 1) {
        await wait(100);
        if (!element.isConnected || state.panel?.style.display === 'none') return false;
        options = listboxOptionsFor(element);
        if (options.length) break;
      }
      state.optionCache.set(fieldId, { options, loaded: true });
      return options.length > 0;
    } finally {
      if (!wasOpen && element.isConnected) {
        element.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true }));
        element.blur();
      }
      if (previousFocus?.isConnected) previousFocus.focus({ preventScroll: true });
    }
  }

  function showAnalysisOverlay() {
    const host = document.createElement('div');
    host.id = ANALYSIS_OVERLAY_ID;
    host.style.cssText = 'all:initial;position:fixed;inset:0;z-index:2147483647;display:block;pointer-events:auto;';
    const shadow = host.attachShadow({ mode: 'closed' });
    shadow.innerHTML = `<style>
      .overlay { position:absolute; inset:0; display:grid; place-items:center; background:rgba(15,23,42,.65); backdrop-filter:blur(3px); cursor:wait; touch-action:none; font-family:system-ui,sans-serif; }
      .card { display:grid; justify-items:center; gap:16px; max-width:calc(100vw - 64px); padding:28px; border-radius:20px; background:#fff; color:#172033; box-shadow:0 20px 60px #0004; text-align:center; }
      .spinner { display:block; box-sizing:border-box; width:44px; height:44px; border:4px solid #dbeafe; border-top-color:#2563eb; border-right-color:#2563eb; border-radius:50%; transform-origin:center; will-change:transform; animation:jalfia-analysis-spin .9s linear infinite; }
      strong { font-size:18px; } p { margin:0; font-size:14px; } small { color:#64748b; }
      @keyframes jalfia-analysis-spin { from { transform:rotate(0deg); } to { transform:rotate(360deg); } }
      @media(prefers-reduced-motion:reduce) { .spinner { animation-duration:2s; } }
    </style><div class="overlay"><div class="card" role="status" aria-live="polite" aria-atomic="true">
      <div class="spinner" aria-hidden="true"></div><strong data-analysis-title>Analizando…</strong>
      <p data-progress>Preparando el analisis…</p><small>Espera a que termine para continuar.</small>
    </div></div>`;
    document.documentElement.appendChild(host);
    state.analysisOverlay = host;
    if (IS_TOP_FRAME) chrome.runtime.sendMessage({ type: 'JALFIA_LOCK_FRAMES', locked: true }).catch(() => {});
    // Bloquear solo eventos humanos: los clics y teclas del analizador siguen funcionando.
    const block = (event) => {
      if (!event.isTrusted) return;
      event.preventDefault();
      event.stopImmediatePropagation();
    };
    const events = ['pointerdown', 'pointerup', 'pointermove', 'click', 'dblclick', 'auxclick', 'contextmenu', 'keydown', 'keyup', 'wheel', 'touchstart', 'touchmove'];
    events.forEach((type) => window.addEventListener(type, block, { capture: true, passive: false }));
    return {
      update(text, title) {
        const progress = shadow.querySelector('[data-progress]');
        progress.textContent = text;
        progress.hidden = !text;
        if (title) shadow.querySelector('[data-analysis-title]').textContent = title;
      },
      remove() {
        if (IS_TOP_FRAME) chrome.runtime.sendMessage({ type: 'JALFIA_LOCK_FRAMES', locked: false }).catch(() => {});
        events.forEach((type) => window.removeEventListener(type, block, true));
        host.remove();
        state.analysisOverlay = null;
      }
    };
  }

  async function completeAnalysis(overlay) {
    overlay.update('', 'Completando análisis…');
    await wait(3000);
  }

  async function analyzeFields(reset = false) {
    if (state.analyzingOptions || state.listening) {
      showStatus('Termina el analisis o dictado actual antes de analizar los campos.');
      return;
    }
    state.analyzingOptions = true;
    let overlay;
    try {
      overlay = showAnalysisOverlay();
      overlay.update('Detectando campos del formulario…');
      await refreshFrames();
      if (reset) recalculatePanel();
      else renderPanel();
    } catch (error) {
      showStatus(`No pude analizar los campos: ${error.message || error}.`);
    } finally {
      try {
        if (overlay) await completeAnalysis(overlay);
      } finally {
        overlay?.remove();
        state.analyzingOptions = false;
        if (state.panel && !state.minimized) renderPanel();
      }
    }
  }

  async function analyzeOptions(fieldId = null) {
    if (state.analyzingOptions || state.listening) {
      showStatus('Termina el dictado o el analisis actual antes de obtener opciones.');
      return;
    }
    updateDraftValues();
    await refreshFrames();
    scanFields();
    const fields = visibleFields().filter((field) => ['combobox', 'autocomplete'].includes(field.kind) && (!fieldId || field.id === fieldId));
    state.analyzingOptions = true;
    let overlay;
    let loaded = 0;
    try {
      renderPanel();
      overlay = showAnalysisOverlay();
      for (const [index, field] of fields.entries()) {
        if (state.panel?.style.display === 'none') break;
        showStatus(`Obteniendo opciones de ${field.label}...`);
        overlay.update(`${index + 1} de ${fields.length}: ${field.label}`);
        if (await obtainFieldOptions(field.id)) loaded += 1;
      }
    } catch (error) {
      showStatus(`No pude terminar el analisis: ${error.message || error}.`);
      return;
    } finally {
      try {
        if (overlay) await completeAnalysis(overlay);
      } finally {
        overlay?.remove();
        state.analyzingOptions = false;
        if (state.panel && !state.minimized) renderPanel();
      }
    }
    showStatus(fields.length ? `Opciones obtenidas en ${loaded} de ${fields.length} campos. Los menus vacios pueden requerir una busqueda o no estar disponibles.` : 'No hay combos o autocompletos para analizar.');
  }

  function normalizeComparable(value) {
    return normalizeText(value)
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase();
  }

  function findVisibleOption(rawValue, element) {
    const value = normalizeComparable(rawValue);
    if (!value) return null;
    const options = listboxesFor(element).flatMap((listbox) => Array.from(listbox.querySelectorAll('[role="option"], .v-list-item, .v-list-item-title')))
      .map(selectableOptionNode)
      .filter(Boolean)
      .map((node) => {
        const optionRoot = node.closest('[role="option"], .v-list-item') || node;
        return {
          node: optionRoot,
          text: normalizeComparable(optionRoot.innerText || optionRoot.textContent || node.innerText || node.textContent)
        };
      });

    return options.find((option) => option.text === value)?.node ||
      options.find((option) => option.text.includes(value) || value.includes(option.text))?.node ||
      null;
  }

  async function setComboboxValue(element, value, kind) {
    const previousValue = element.value;
    element.focus();
    element.click();
    await wait(120);

    const option = findVisibleOption(value, element);
    if (option) {
      option.click();
      dispatchInputEvents(element);
      return true;
    }

    if (kind === 'combobox' || element.readOnly || element.getAttribute('readonly') !== null) {
      return false;
    }

    element.value = value;
    dispatchInputEvents(element);
    for (let attempt = 0; attempt < 15; attempt += 1) {
      await wait(100);
      const suggestion = findVisibleOption(value, element);
      if (suggestion) { suggestion.click(); return true; }
    }
    element.value = previousValue;
    dispatchInputEvents(element);
    return false;
  }

  async function setFieldValue(fieldId, value) {
    const remote = state.fields.find(field => field.id === fieldId && field.frameId);
    if (remote) {
      const result = await frameRequest(remote, 'fill', value);
      return result.ok && !result.verified ? { ...result, ok: false, reason: 'No se pudo comprobar el valor aplicado en el iframe.' } : result;
    }
    const element = document.querySelector(`[data-jalfia-field-id="${CSS.escape(fieldId)}"]`);
    if (!element) return { ok: false, reason: 'Campo no encontrado' };

    const kind = fieldKind(element);
    element.focus();

    if (String(value).trim() === '' && !['switch', 'checkbox', 'radio', 'select'].includes(kind)) {
      if (element.isContentEditable) {
        element.textContent = '';
      } else {
        element.value = '';
      }
      dispatchInputEvents(element);
      return { ok: true };
    }

    if (['switch', 'checkbox', 'radio'].includes(kind)) {
      const result = await setBooleanValue(element, value, kind);
      if (result.ok) rememberSuccess(fieldId, 'click-state', String(normalizeBoolean(value))).catch(() => {});
      return result;
    }

    if (kind === 'select') {
      const ok = setSelectValue(element, value);
      if (ok) rememberSuccess(fieldId, 'select-option', value).catch(() => {});
      return ok ? { ok: true } : { ok: false, reason: 'No coincide con ninguna opcion' };
    }

    if (kind === 'combobox' || kind === 'autocomplete') {
      const ok = await setComboboxValue(element, value, kind);
      if (ok && normalizeComparable(element.value) === normalizeComparable(value)) rememberSuccess(fieldId, 'select-option', value).catch(() => {});
      return ok ? { ok: true } : { ok: false, reason: 'No coincide con ninguna opcion' };
    }

    if (element.isContentEditable) {
      element.textContent = value;
      dispatchInputEvents(element);
      if (normalizeText(element.textContent) === normalizeText(value)) rememberSuccess(fieldId, 'contenteditable-events', value).catch(() => {});
      return { ok: true };
    }

    element.value = value;
    dispatchInputEvents(element);
    if (String(element.value) === String(value)) rememberSuccess(fieldId, 'input-events', value).catch(() => {});
    return { ok: true };
  }

  function applySpeechToField(text, fieldId) {
    const input = state.shadow.querySelector(`[data-jalfia-value="${CSS.escape(fieldId)}"]`);
    if (!input) {
      showStatus('No encontre el campo donde aplicar el dictado.');
      return;
    }

    const value = normalizeText(text);
    const prototype = Object.getPrototypeOf(input);
    const descriptor = Object.getOwnPropertyDescriptor(prototype, 'value');

    if (descriptor?.set) {
      descriptor.set.call(input, value);
    } else {
      input.value = value;
    }

    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
    state.draftValues.set(fieldId, value);
    state.formClearFieldIds.delete(fieldId);
    state.pendingFocusFieldId = fieldId;
    showStatus('Voz transcripta.');
  }

  function focusPanelField(fieldId) {
    const input = state.shadow?.querySelector(`[data-jalfia-value="${CSS.escape(fieldId)}"]`);
    if (!input) return;

    input.focus({ preventScroll: true });

    if (typeof input.setSelectionRange === 'function') {
      try {
        const end = input.value.length;
        input.setSelectionRange(end, end);
      } catch (error) {
        // Algunos inputs nativos, como date o number, no permiten seleccionar texto.
      }
    }
  }

  function startVoiceRecognition(fieldId = null) {
    if (state.analyzingOptions) { showStatus('Espera a que termine el analisis de opciones.'); return; }
    const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!Recognition) {
      showStatus('Este navegador no expone reconocimiento de voz para la extension.');
      return;
    }

    if (state.listening) {
      state.stopVoice?.();
      return;
    }

    const recognition = new Recognition();
    state.recognition = recognition;
    state.listening = true;
    state.activeVoiceFieldId = fieldId;
    recognition.lang = 'es-AR';
    recognition.interimResults = false;
    recognition.continuous = true;

    let keepListening = true;
    let restartTimer = null;
    let transcript = '';
    let resultCount = 0;
    let failed = false;

    const finish = () => {
      window.clearTimeout(restartTimer);
      state.listening = false;
      state.activeVoiceFieldId = '';
      state.recognition = null;
      state.stopVoice = null;
      updateVoiceButtons();
      if (!failed) showStatus('Dictado detenido.');
      if (!fieldId) {
        renderPanel();
        const submit = state.voiceSubmit;
        state.voiceSubmit = false;
        if (submit && !failed) processVoice();
      }
      if (state.pendingFocusFieldId) {
        const fieldToFocus = state.pendingFocusFieldId;
        state.pendingFocusFieldId = '';
        window.setTimeout(() => focusPanelField(fieldToFocus), 0);
      }
    };

    const start = () => {
      restartTimer = null;
      if (!keepListening) return;
      resultCount = 0;
      try {
        recognition.start();
      } catch (error) {
        keepListening = false;
        failed = true;
        showStatus(`No pude iniciar el microfono: ${error.message || error}.`);
        finish();
      }
    };

    state.stopVoice = () => {
      keepListening = false;
      if (restartTimer !== null) {
        finish();
      } else {
        recognition.stop();
      }
    };

    updateVoiceButtons();
    if (!fieldId) {
      state.voiceTranscript = ''; state.voiceCorrectedText = ''; state.voiceActions = [];
      updateGlobalMicrophone();
    }
    showStatus('Escuchando... Pulsa detener para terminar.');

    recognition.onresult = (event) => {
      for (; resultCount < event.results.length; resultCount += 1) {
        const result = event.results[resultCount];
        if (!result.isFinal) break;
        transcript = normalizeText(`${transcript} ${result[0]?.transcript || ''}`);
      }
      if (fieldId) applySpeechToField(transcript, fieldId);
      else {
        state.voiceTranscript = transcript;
        const output = state.shadow.querySelector('[data-transcript]');
        if (output) output.textContent = transcript;
      }
      if (keepListening) showStatus('Escuchando... Pulsa detener para terminar.');
    };

    recognition.onerror = (event) => {
      if (event.error === 'no-speech') return;
      keepListening = false;
      failed = true;
      showStatus(`No pude usar el microfono: ${event.error || 'error desconocido'}.`);
    };

    recognition.onend = () => {
      if (keepListening) {
        restartTimer = window.setTimeout(start, 250);
      } else {
        finish();
      }
    };

    start();
  }

  function fieldTypeLabel(field) {
    const labels = {
      checkbox: 'Casilla',
      switch: 'Interruptor',
      date: 'Fecha',
      'datetime-local': 'Fecha y hora',
      email: 'Email',
      number: 'Numero',
      radio: 'Opcion',
      richtext: 'Texto',
      select: 'Combo',
      combobox: 'Combo',
      autocomplete: 'Autocomplete',
      tel: 'Telefono',
      textarea: 'Texto largo',
      text: 'Texto',
      time: 'Hora',
      url: 'URL'
    };

    return labels[field.kind] || field.kind || 'Campo';
  }

  function renderInput(field) {
    const value = state.formClearFieldIds.has(field.id)
      ? ''
      : state.draftValues.has(field.id)
      ? state.draftValues.get(field.id)
      : field.currentValue ?? '';

    if (field.kind === 'select') {
      const options = field.options.map((option) => {
        const label = option.text || option.value || 'Opcion sin texto';
        const optionValue = option.text || option.value;
        const selected = String(value) === String(optionValue) || (!state.draftValues.has(field.id) && option.selected);
        return `<option value="${escapeHtml(optionValue)}" ${selected ? 'selected' : ''}>${escapeHtml(label)}</option>`;
      }).join('');
      return `<select data-jalfia-value="${escapeHtml(field.id)}"><option value="">Sin cambios</option>${options}</select>`;
    }

    if (['switch', 'checkbox', 'radio'].includes(field.kind)) {
      return `
        <select data-jalfia-value="${escapeHtml(field.id)}">
          <option value="">Sin cambios</option>
          <option value="true" ${String(value) === 'true' ? 'selected' : ''}>${field.kind === 'radio' ? 'Seleccionar' : 'Si'}</option>
          <option value="false" ${String(value) === 'false' ? 'selected' : ''}>${field.kind === 'radio' ? 'No seleccionado' : 'No'}</option>
        </select>
      `;
    }

    if (field.kind === 'textarea' || field.kind === 'richtext') {
      return `<textarea rows="3" data-jalfia-value="${escapeHtml(field.id)}">${escapeHtml(value)}</textarea>`;
    }

    const inputType = ['date', 'datetime-local', 'email', 'number', 'tel', 'time', 'url'].includes(field.kind)
      ? field.kind
      : 'text';

    const listId = `options-${field.id}`;
    const suggestions = ['combobox', 'autocomplete'].includes(field.kind) && field.options.length
      ? `<datalist id="${escapeHtml(listId)}">${field.options.map((option) => `<option value="${escapeHtml(option.text)}"></option>`).join('')}</datalist>` : '';
    return `<input type="${inputType}" value="${escapeHtml(value)}" ${suggestions ? `list="${escapeHtml(listId)}"` : ''} data-jalfia-value="${escapeHtml(field.id)}">${suggestions}`;
  }

  function eraserIcon() {
    return `
      <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        <path d="m7 21-4-4 9.5-9.5 4 4L7 21Z"></path>
        <path d="m14 6 4-4 4 4-4 4"></path>
        <path d="m12.5 7.5 4 4"></path>
        <path d="M7 21h14"></path>
      </svg>
    `;
  }

  function trashIcon() {
    return `
      <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        <path d="M3 6h18"></path>
        <path d="M8 6V4h8v2"></path>
        <path d="M19 6l-1 15H6L5 6"></path>
        <path d="M10 11v6"></path>
        <path d="M14 11v6"></path>
      </svg>
    `;
  }

  function refreshIcon() {
    return `
      <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        <path d="M21 12a9 9 0 0 1-15.3 6.4"></path>
        <path d="M3 12A9 9 0 0 1 18.3 5.6"></path>
        <path d="M18 2v4h-4"></path>
        <path d="M6 22v-4h4"></path>
      </svg>
    `;
  }

  function recalculateIcon() {
    return `
      <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        <path d="M20 12a8 8 0 1 1-2.3-5.7"></path>
        <path d="M20 4v5h-5"></path>
        <path d="M12 8v4l3 2"></path>
        <path d="M4 4l16 16"></path>
      </svg>
    `;
  }

  function removeFieldIcon() {
    return `
      <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        <path d="M18 6 6 18"></path>
        <path d="m6 6 12 12"></path>
      </svg>
    `;
  }

  function minimizeIcon() {
    return `
      <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        <path d="M6 12h12"></path>
      </svg>
    `;
  }

  function microphoneIcon() {
    return `
      <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        <path d="M12 14a3 3 0 0 0 3-3V6a3 3 0 0 0-6 0v5a3 3 0 0 0 3 3Z"></path>
        <path d="M19 11a7 7 0 0 1-14 0"></path>
        <path d="M12 18v3"></path>
        <path d="M8 21h8"></path>
      </svg>
    `;
  }

  function stopIcon() {
    return `
      <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        <rect x="7" y="7" width="10" height="10" rx="2"></rect>
      </svg>
    `;
  }

  function voiceButtonIcon(fieldId) {
    return state.listening && state.activeVoiceFieldId === fieldId
      ? stopIcon()
      : microphoneIcon();
  }

  function updateVoiceButtons() {
    if (!state.shadow) return;

    state.shadow.querySelectorAll('[data-action="voice"]').forEach((button) => {
      const isActive = state.listening && button.dataset.fieldId === state.activeVoiceFieldId;
      button.classList.toggle('voice-active', isActive);
      button.innerHTML = isActive ? stopIcon() : microphoneIcon();
      button.title = isActive ? 'Detener dictado' : 'Dictar este campo';
      button.setAttribute('aria-label', isActive ? 'Detener dictado' : 'Dictar este campo');
    });
  }

  function visibleFields() {
    return state.fields.filter((field) => !state.hiddenFieldIds.has(field.id));
  }

  function styles() {
    return `
      :host {
        all: initial;
        color-scheme: light;
        --ink: #111827;
        --muted: #64748b;
        --line: rgba(148, 163, 184, 0.28);
        --panel: rgba(255, 255, 255, 0.9);
        --blue: #2563eb;
        --cyan: #06b6d4;
        --violet: #7c3aed;
        font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      }

      * {
        box-sizing: border-box;
      }

      .shell {
        width: 100%;
        height: 100%;
        min-width: 430px;
        min-height: 0;
        display: flex;
        flex-direction: column;
        overflow: hidden;
        border: 1px solid rgba(255, 255, 255, 0.62);
        border-radius: 22px;
        background: linear-gradient(145deg, rgba(255,255,255,0.94), rgba(245,249,255,0.86));
        box-shadow: 0 24px 70px rgba(15, 23, 42, 0.28), 0 0 0 1px rgba(59, 130, 246, 0.08);
        backdrop-filter: blur(18px);
      }

      .shell.dark {
        --ink: #e2e8f0;
        --muted: #a8b7cc;
        --line: rgba(148, 163, 184, 0.3);
        --panel: #1e293b;
        color-scheme: dark;
        color: var(--ink);
        background: #0f172a;
        border-color: var(--line);
      }

      .dark .body, .dark .footer { background: #0f172a; }
      .dark input, .dark select, .dark textarea,
      .dark .empty, .dark .preview-item { background: #1e293b; color: var(--ink); }
      .dark .badge { background: #35275b; color: #ddd6fe; }
      .dark .field-remove { color: #cbd5e1; }
      .dark .field-mic { color: #93c5fd; }
      .dark .draft-clear, .dark .real-clear { color: #fca5a5; }
      .dark .preview-item-danger { background: #442129; }
      .dark .preview-item-danger .preview-value { color: #fca5a5; }

      .settings { padding: 16px; display: grid; gap: 18px; overflow: auto; flex: 1; align-content: start; }
      .voice-view { display:flex; flex-direction:column; flex:1; min-height:0; color:var(--ink); }
      .voice-scroll { display:flex; flex-direction:column; align-items:center; gap:16px; flex:1; min-height:0; overflow:auto; padding:20px; }
      .voice-scroll > * { flex-shrink:0; }
      .voice-scroll.voice-idle { justify-content:safe center; min-height:180px; }
      .voice-toolbar { display:flex; justify-content:center; gap:10px; padding:12px 16px; flex-shrink:0; border-top:1px solid var(--line); }
      .voice-toolbar button { width:42px; height:42px; padding:0; display:grid; place-items:center; color:var(--ink); background:var(--panel); border:1px solid var(--line); }
      .voice-toolbar svg { width:20px; height:20px; fill:none; stroke:currentColor; stroke-width:1.8; stroke-linecap:round; stroke-linejoin:round; }
      .recognized-text { width:100%; display:grid; gap:8px; color:var(--muted); font-size:13px; }
      .voice-view h2 { font-size:16px; margin:0; }
      .voice-view .setting { width:100%; flex-shrink:0; }
      .voice-view .setting input[type="checkbox"] { width:18px; min-height:18px; vertical-align:middle; }
      .voice-view p { margin:0; width:100%; text-align:center; overflow-wrap:anywhere; }
      .global-mic { width:112px; height:112px; flex-shrink:0; display:grid; place-items:center; border-radius:50%; color:white; background:linear-gradient(135deg,var(--blue),var(--cyan)); box-shadow:0 12px 28px #2563eb33; }
      .global-mic.recording { background:#dc2626; }
      .global-mic svg { width:48px; height:48px; fill:none; stroke:currentColor; stroke-width:1.8; stroke-linecap:round; stroke-linejoin:round; }
      .voice-view .primary { flex:0 0 auto; min-height:42px; padding:10px 16px; }
      .settings h2 { margin: 0; color: var(--ink); font-size: 16px; }
      .setting { display: grid; gap: 8px; padding: 14px; border: 1px solid var(--line); border-radius: 14px; background: var(--panel); }
      .setting-heading { display: flex; align-items: center; justify-content: space-between; gap: 12px; color: var(--ink); }
      .setting input[type="range"] { padding: 0; accent-color: var(--blue); }
      .setting input[type="checkbox"] { width: 20px; min-height: 20px; height: 20px; accent-color: var(--blue); }
      .settings-tab[aria-pressed="true"] { background: rgba(255,255,255,0.32); }

      .header {
        flex-shrink: 0;
        cursor: grab;
        padding: 16px;
        color: #fff;
        background: linear-gradient(135deg, var(--blue), var(--cyan) 52%, var(--violet));
        user-select: none;
      }

      .header:active {
        cursor: grabbing;
      }

      .header-top {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
        min-width: 0;
      }

      .brand {
        display: flex;
        align-items: center;
        min-width: 0;
        gap: 12px;
      }

      .logo {
        width: 42px;
        height: 42px;
        display: grid;
        place-items: center;
        flex: 0 0 auto;
        border-radius: 14px;
        background: rgba(255, 255, 255, 0.18);
        border: 1px solid rgba(255, 255, 255, 0.36);
        font-size: 20px;
        font-weight: 850;
      }

      h1 {
        margin: 0;
        font-size: 19px;
        font-weight: 820;
        letter-spacing: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .subtitle {
        margin-top: 2px;
        color: rgba(255, 255, 255, 0.78);
        font-size: 12px;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .actions {
        display: flex;
        align-items: center;
        flex: 0 0 auto;
        gap: 8px;
      }

      .icon-button {
        width: 34px;
        height: 34px;
        display: grid;
        place-items: center;
        border: 1px solid rgba(255, 255, 255, 0.34);
        border-radius: 11px;
        background: rgba(255, 255, 255, 0.16);
        color: #fff;
        cursor: pointer;
        font: inherit;
      }

      .icon-button svg {
        width: 16px;
        height: 16px;
        fill: none;
        stroke: currentColor;
        stroke-linecap: round;
        stroke-linejoin: round;
        stroke-width: 2;
      }

      .bubble {
        position: relative;
        width: 64px;
        height: 64px;
        margin: 6px;
        padding: 0;
        touch-action: none;
        display: grid;
        place-items: center;
        border: 1px solid rgba(255, 255, 255, 0.58);
        border-radius: 999px;
        background: linear-gradient(135deg, var(--blue), var(--cyan) 52%, var(--violet));
        color: #fff;
        box-shadow: 0 6px 16px rgba(15, 23, 42, 0.22);
        cursor: grab;
        font-size: 24px;
        font-weight: 850;
        user-select: none;
      }

      .bubble:active { cursor: grabbing; }
      .bubble:focus-visible { outline: 3px solid var(--blue); outline-offset: 3px; }

      .bubble-count {
        position: absolute;
        top: 0;
        right: 0;
        min-width: 24px;
        height: 24px;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        border: 2px solid #fff;
        border-radius: 999px;
        background: #ef4444;
        color: #fff;
        padding: 0 6px;
        font-size: 11px;
        font-weight: 850;
      }

      .meta {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
        margin-top: 14px;
        min-width: 0;
      }

      .count-group {
        display: flex;
        align-items: center;
        min-width: 0;
        gap: 8px;
      }

      .count-group .secondary {
        width: 32px;
        min-height: 28px;
        display: grid;
        place-items: center;
        border: 1px solid rgba(255, 255, 255, 0.28);
        background: rgba(255, 255, 255, 0.16);
        color: #fff;
        padding: 0;
        box-shadow: none;
      }

      .count-group .secondary svg {
        width: 15px;
        height: 15px;
        fill: none;
        stroke: currentColor;
        stroke-linecap: round;
        stroke-linejoin: round;
        stroke-width: 2;
      }

      .voice-active {
        background: rgba(239, 68, 68, 0.12);
        border-color: rgba(239, 68, 68, 0.28);
        color: #dc2626;
        box-shadow: 0 0 0 4px rgba(239, 68, 68, 0.1);
      }

      .count {
        min-height: 28px;
        display: inline-flex;
        align-items: center;
        min-width: 0;
        border: 1px solid rgba(255, 255, 255, 0.28);
        border-radius: 999px;
        background: rgba(255, 255, 255, 0.16);
        padding: 0 10px;
        font-size: 12px;
        font-weight: 720;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .opacity {
        display: flex;
        align-items: stretch;
        flex: 0 1 145px;
        flex-direction: column;
        min-width: 0;
        gap: 4px;
        color: rgba(255,255,255,0.84);
        font-size: 12px;
      }

      .opacity input {
        width: 100%;
        min-width: 48px;
        accent-color: #fff;
      }

      .body {
        display: flex;
        min-height: 0;
        flex: 1;
        flex-direction: column;
        background: rgba(248, 250, 252, 0.82);
      }

      .fields {
        display: grid;
        gap: 12px;
        min-height: 0;
        overflow: auto;
        padding: 14px;
      }

      .carousel {
        flex: 1;
        display: grid;
        gap: 12px;
        min-height: 0;
        align-content: start;
        overflow: auto;
        padding: 14px;
      }

      .carousel-meta {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 10px;
        color: var(--muted);
        font-size: 12px;
      }

      .dots {
        display: flex;
        flex-wrap: wrap;
        gap: 5px;
        justify-content: flex-end;
      }

      .dot {
        width: 7px;
        height: 7px;
        border-radius: 999px;
        background: rgba(100, 116, 139, 0.32);
      }

      .dot-active {
        width: 18px;
        background: linear-gradient(135deg, var(--blue), var(--cyan));
      }

      .field {
        display: grid;
        gap: 10px;
        border: 1px solid var(--line);
        border-radius: 16px;
        background: var(--panel);
        padding: 12px;
        box-shadow: 0 12px 28px rgba(15, 23, 42, 0.08);
      }

      .field-head {
        display: grid;
        grid-template-columns: minmax(0, 1fr) auto;
        align-items: start;
        gap: 10px;
        min-width: 0;
      }

      .field-actions {
        display: flex;
        align-items: center;
        flex: 0 0 auto;
        min-width: max-content;
        gap: 8px;
      }

      .field-mic {
        width: 30px;
        height: 28px;
        display: grid;
        place-items: center;
        flex: 0 0 auto;
        border: 1px solid rgba(37, 99, 235, 0.18);
        border-radius: 999px;
        background: rgba(37, 99, 235, 0.08);
        color: #1d4ed8;
        padding: 0;
      }

      .field-remove {
        width: 30px;
        height: 28px;
        display: grid;
        place-items: center;
        flex: 0 0 auto;
        border: 1px solid rgba(100, 116, 139, 0.18);
        border-radius: 999px;
        background: rgba(100, 116, 139, 0.08);
        color: #475569;
        padding: 0;
      }

      .field-mic svg,
      .field-remove svg {
        width: 15px;
        height: 15px;
        fill: none;
        stroke: currentColor;
        stroke-linecap: round;
        stroke-linejoin: round;
        stroke-width: 2;
      }

      .input-row {
        display: grid;
        grid-template-columns: minmax(0, 1fr) 34px;
        gap: 8px;
        align-items: start;
      }
      .input-row datalist { display: none; }
      .field-options { display: grid; gap: 8px; color: var(--muted); font-size: 12px; }
      .field-options ul { margin: 0; padding-left: 20px; max-height: 120px; overflow: auto; }
      .field-rules { color: var(--muted); font-size: 12px; overflow-wrap: anywhere; }
      .field-rules p { margin: 8px 0; }
      .validation-error { color: #b91c1c; font-size: 12px; }
      .dark .validation-error { color: #fca5a5; }
      button:disabled { opacity: .5; cursor: not-allowed; }
      .option-choice { padding: 6px 8px; background: transparent; color: var(--ink); text-align: left; white-space: normal; overflow-wrap: anywhere; }
      .option-choice:hover, .option-choice:focus-visible { background: rgba(37,99,235,.15); }
      .field-options .secondary { color: var(--ink); background: var(--panel); border: 1px solid var(--line); }

      .draft-clear {
        width: 34px;
        min-height: 39px;
        display: grid;
        place-items: center;
        border: 1px solid rgba(220, 38, 38, 0.2);
        border-radius: 13px;
        background: rgba(239, 68, 68, 0.08);
        color: #dc2626;
        padding: 0;
      }

      .draft-clear svg {
        width: 16px;
        height: 16px;
        fill: none;
        stroke: currentColor;
        stroke-linecap: round;
        stroke-linejoin: round;
        stroke-width: 2;
      }

      .real-clear {
        width: 30px;
        height: 28px;
        display: grid;
        place-items: center;
        border: 1px solid rgba(220, 38, 38, 0.2);
        border-radius: 999px;
        background: rgba(239, 68, 68, 0.08);
        color: #dc2626;
        padding: 0;
      }

      .real-clear-active {
        background: rgba(239, 68, 68, 0.16);
        box-shadow: 0 0 0 3px rgba(239, 68, 68, 0.1);
      }

      .real-clear svg {
        width: 16px;
        height: 16px;
        fill: none;
        stroke: currentColor;
        stroke-linecap: round;
        stroke-linejoin: round;
        stroke-width: 2;
      }

      .field-title {
        display: flex;
        align-items: center;
        min-width: 0;
        gap: 9px;
      }

      .field-name {
        display: flex;
        align-items: center;
        flex-wrap: wrap;
        gap: 6px;
        min-width: 0;
      }

      .index {
        width: 24px;
        height: 24px;
        display: inline-grid;
        place-items: center;
        flex: 0 0 24px;
        border-radius: 999px;
        background: linear-gradient(135deg, rgba(37,99,235,0.14), rgba(6,182,212,0.18));
        color: #075985;
        font-size: 12px;
        font-weight: 820;
      }

      label {
        overflow: hidden;
        color: var(--ink);
        font-size: 13px;
        font-weight: 760;
        line-height: 1.25;
        overflow-wrap: anywhere;
      }

      .badge {
        flex: 0 0 auto;
        border-radius: 999px;
        background: rgba(124, 58, 237, 0.1);
        color: #5b21b6;
        padding: 4px 8px;
        font-size: 11px;
        font-weight: 720;
        white-space: nowrap;
      }

      input,
      select,
      textarea {
        width: 100%;
        min-width: 0;
        border: 1px solid rgba(148, 163, 184, 0.38);
        border-radius: 13px;
        background: rgba(255, 255, 255, 0.92);
        color: var(--ink);
        outline: none;
        font: inherit;
        font-size: 13px;
      }

      input,
      select {
        min-height: 39px;
        padding: 8px 10px;
      }

      textarea {
        resize: vertical;
        min-height: 76px;
        padding: 10px;
      }

      input:focus,
      select:focus,
      textarea:focus {
        border-color: rgba(37, 99, 235, 0.74);
        box-shadow: 0 0 0 4px rgba(37, 99, 235, 0.14);
      }

      .empty {
        border: 1px dashed rgba(148, 163, 184, 0.48);
        border-radius: 16px;
        background: rgba(255, 255, 255, 0.82);
        color: var(--muted);
        padding: 18px;
        text-align: center;
        font-size: 13px;
      }

      .empty-state {
        display: grid;
        place-items: center;
        flex: 1;
        min-height: 120px;
        padding: 24px;
        text-align: center;
        color: var(--muted);
        font-size: 14px;
        line-height: 1.5;
      }

      .empty-state p { margin: 0; max-width: 300px; }

      .status {
        display: flex;
        align-items: flex-start;
        gap: 7px;
        flex-shrink: 0;
        min-height: 18px;
        padding: 0 16px 10px;
        color: var(--muted);
        font-size: 12px;
      }

      .status[hidden] { display: none; }
      .status svg { width: 16px; height: 16px; flex: 0 0 16px; fill: none; stroke: currentColor; stroke-width: 1.8; stroke-linecap: round; }
      .status span { min-width: 0; line-height: 1.4; }

      .preview {
        flex: 1;
        display: grid;
        gap: 12px;
        min-height: 0;
        overflow: auto;
        padding: 14px;
      }

      .preview-title {
        margin: 0;
        color: var(--ink);
        font-size: 15px;
        font-weight: 820;
      }

      .preview-list {
        display: grid;
        gap: 8px;
      }

      .preview-item {
        display: grid;
        gap: 3px;
        border: 1px solid var(--line);
        border-radius: 14px;
        background: rgba(255, 255, 255, 0.86);
        padding: 10px;
      }

      .preview-item-danger {
        border-color: rgba(220, 38, 38, 0.22);
        background: rgba(254, 242, 242, 0.9);
      }

      .preview-item-danger .preview-value {
        color: #b91c1c;
      }

      .preview-label {
        color: var(--muted);
        font-size: 11px;
        font-weight: 760;
      }

      .preview-value {
        color: var(--ink);
        font-size: 13px;
        font-weight: 700;
        overflow-wrap: anywhere;
      }

      .footer {
        display: flex;
        flex-shrink: 0;
        margin-top: auto;
        gap: 10px;
        min-width: 0;
        padding: 12px 14px 14px;
        border-top: 1px solid var(--line);
        background: rgba(255, 255, 255, 0.76);
      }

      .footer-navigation {
        display: grid;
        grid-template-columns: 40px minmax(0, 1fr) 40px;
        align-items: center;
      }

      .footer-navigation .secondary {
        width: 40px;
        padding: 0;
        display: grid;
        place-items: center;
      }

      .footer-navigation svg {
        width: 20px;
        height: 20px;
        fill: none;
        stroke: currentColor;
        stroke-width: 2;
        stroke-linecap: round;
        stroke-linejoin: round;
      }

      button {
        border: 0;
        border-radius: 13px;
        cursor: pointer;
        font: inherit;
      }

      .secondary,
      .primary {
        min-width: 0;
        min-height: 40px;
        padding: 0 13px;
        font-size: 13px;
        font-weight: 760;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .secondary {
        flex: 0 0 auto;
        background: rgba(15, 23, 42, 0.07);
        color: var(--ink);
      }

      .primary {
        flex: 1;
        color: #fff;
        background: linear-gradient(135deg, var(--blue), var(--cyan) 55%, var(--violet));
        box-shadow: 0 12px 24px rgba(37, 99, 235, 0.28);
      }

      @container (max-width: 340px) {
        .header {
          padding: 12px;
        }

        .logo {
          width: 34px;
          height: 34px;
          border-radius: 11px;
          font-size: 17px;
        }

        h1 {
          font-size: 16px;
        }

        .subtitle {
          display: none;
        }

        .meta {
          align-items: stretch;
          flex-direction: column;
          gap: 8px;
        }

        .count-group {
          align-items: stretch;
          flex-direction: column;
        }

        .opacity {
          flex: 0 1 auto;
        }

        .field-head {
          align-items: flex-start;
        }

        .field-actions {
          justify-content: flex-end;
          min-width: 0;
        }

        .badge {
          max-width: 100%;
          overflow-wrap: anywhere;
          text-align: right;
          white-space: normal;
        }

        .footer {
          flex-direction: column;
        }

        .secondary,
        .primary {
          width: 100%;
        }
      }
    `;
  }

  function renderFieldCard(field, index) {
    return `
      <article class="field">
        <div class="field-head">
          <div class="field-title">
            <span class="index">${index + 1}</span>
            <div class="field-name">
              <label title="${escapeHtml(field.label)}">${escapeHtml(field.label)}</label>
              <span class="badge">${escapeHtml(fieldTypeLabel(field))}${field.required ? ' requerido' : ''}</span>
            </div>
          </div>
          <div class="field-actions">
            <button class="field-mic" type="button" data-action="voice" data-field-id="${escapeHtml(field.id)}" title="Dictar este campo" aria-label="Dictar este campo">${voiceButtonIcon(field.id)}</button>
            <button class="real-clear ${state.formClearFieldIds.has(field.id) ? 'real-clear-active' : ''}" type="button" data-action="clear-real" data-field-id="${escapeHtml(field.id)}" title="Vaciar este campo en el formulario real" aria-label="Vaciar este campo en el formulario real">${trashIcon()}</button>
            <button class="field-remove" type="button" data-action="hide-field" data-field-id="${escapeHtml(field.id)}" title="Quitar del carrusel" aria-label="Quitar del carrusel">${removeFieldIcon()}</button>
          </div>
        </div>
        <div class="input-row">
          ${renderInput(field)}
          <button class="draft-clear" type="button" data-action="clear-draft" data-field-id="${escapeHtml(field.id)}" title="Limpiar texto ingresado en JALFIA" aria-label="Limpiar texto ingresado en JALFIA">${eraserIcon()}</button>
        </div>
        ${renderFieldRules(field)}
        ${['combobox', 'autocomplete'].includes(field.kind) ? `<div class="field-options">
          <button class="secondary" type="button" data-action="obtain-options" data-field-id="${escapeHtml(field.id)}" ${state.analyzingOptions ? 'disabled' : ''}>${field.optionsLoaded ? 'Actualizar opciones' : 'Obtener opciones'}</button>
          ${field.options.length ? `<details><summary>Mostrar opciones (${field.options.length})</summary><ul>${field.options.map((option) => `<li><button class="option-choice" type="button" data-action="choose-option" data-field-id="${escapeHtml(field.id)}" data-option-value="${escapeHtml(option.text)}">${escapeHtml(option.text)}</button></li>`).join('')}</ul></details>` : field.optionsLoaded ? '<span>No se encontraron opciones seleccionables. Puede requerir escribir una busqueda en el formulario.</span>' : ''}
        </div>` : ''}
      </article>
    `;
  }

  function renderCarousel() {
    const fields = visibleFields();
    if (!state.fields.length) {
      return '<div class="empty-state" role="status"><p>No se encontraron campos editables en esta página.</p></div>';
    }

    if (!fields.length) {
      return '<div class="empty-state" role="status"><p>No hay campos visibles para completar.</p></div>';
    }

    state.activeFieldIndex = Math.min(Math.max(0, state.activeFieldIndex), fields.length - 1);
    const field = fields[state.activeFieldIndex];
    const dots = fields.map((_, index) =>
      `<span class="dot ${index === state.activeFieldIndex ? 'dot-active' : ''}"></span>`
    ).join('');

    return `
      <section class="carousel">
        <div class="carousel-meta">
          <span>Campo ${state.activeFieldIndex + 1} de ${fields.length}</span>
          <div class="dots" aria-hidden="true">${dots}</div>
        </div>
        ${renderFieldCard(field, state.activeFieldIndex)}
      </section>
    `;
  }

  function renderPreview() {
    const items = state.previewValues.length
      ? state.previewValues.map((item) => `
        <article class="preview-item ${item.clearReal ? 'preview-item-danger' : ''}">
          <div class="preview-label">${escapeHtml(item.label)}</div>
          <div class="preview-value">${item.clearReal ? 'Vaciar campo en formulario real' : escapeHtml(item.value)}</div>
          ${(item.errors || []).map(error => `<p class="validation-error">${escapeHtml(error)}</p>`).join('')}
        </article>
      `).join('')
      : '<div class="empty">No hay valores cargados para completar.</div>';

    return `
      <section class="preview">
        <h2 class="preview-title">Vista previa</h2>
        <div class="preview-list">${items}</div>
      </section>
    `;
  }

  function chooseScope() {
    if (state.analyzingOptions || state.listening) { showStatus('Termina el analisis o dictado antes de elegir un sector.'); return; }
    state.cancelScopeSelection?.();
    showStatus('Senala el formulario o sector y haz clic para elegirlo. Escape cancela.');
    let candidate = null;
    let previousOutline = '';
    let previousOffset = '';
    const clearHighlight = () => {
      if (candidate) { candidate.style.outline = previousOutline; candidate.style.outlineOffset = previousOffset; }
    };
    const rootFor = (target) => {
      const semantic = target.closest('form, [role="form"], section, article, main, [role="dialog"]');
      if (semantic?.querySelector(FIELD_SELECTOR)) return semantic;
      for (let node = target; node && node !== document.body && node !== document.documentElement; node = node.parentElement) {
        if (node.querySelectorAll(FIELD_SELECTOR).length >= 2) return node;
      }
      return null;
    };
    const move = (event) => {
      if (!(event.target instanceof Element) || isInsidePanel(event.target)) return;
      const next = rootFor(event.target);
      if (next === candidate) return;
      clearHighlight(); candidate = next;
      if (candidate) {
        previousOutline = candidate.style.outline; previousOffset = candidate.style.outlineOffset;
        candidate.style.outline = '3px solid #2563eb'; candidate.style.outlineOffset = '3px';
      }
    };
    const cleanup = () => {
      clearHighlight();
      window.removeEventListener('pointermove', move, true);
      window.removeEventListener('click', select, true);
      window.removeEventListener('keydown', key, true);
      state.cancelScopeSelection = null;
    };
    const select = (event) => {
      if (!(event.target instanceof Element) || isInsidePanel(event.target)) return;
      event.preventDefault(); event.stopImmediatePropagation();
      const selected = rootFor(event.target);
      if (!selected) { showStatus('No encontre campos en ese sector. Elige el contenedor del formulario.'); return; }
      cleanup(); state.scopeRoot = selected; state.previewMode = false; state.optionCache.clear();
      renderPanel(); showStatus('Analizando solo el sector elegido. Puedes volver al alcance automatico.');
    };
    const key = (event) => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopImmediatePropagation(); cleanup(); showStatus('Seleccion de sector cancelada.'); }
    };
    state.cancelScopeSelection = cleanup;
    window.addEventListener('pointermove', move, true);
    window.addEventListener('click', select, true);
    window.addEventListener('keydown', key, true);
  }

  function renderSettings() {
    return `<form class="settings" aria-label="Ajustes de JALFIA">
      <h2>Ajustes</h2>
      <div class="setting"><h2>Memoria del documento principal</h2>
        <p>${state.memory ? `${state.memory.known ? 'Pantalla conocida' : 'Estructura registrada'} · ${state.memory.fields.length} campos · ${state.memory.fields.filter(field => field.strategy).length} estrategias comprobadas` : 'Todavía no hay memoria disponible.'}</p>
        ${state.memory?.fields?.filter(field => field.strategy).map(field => `<small>${escapeHtml(field.label)}: ${escapeHtml({ 'click-state': 'cambio mediante clic', 'select-option': 'selección de una opción', 'input-events': 'ingreso y eventos de edición', 'contenteditable-events': 'edición de contenido' }[field.strategy] || field.strategy)}</small>`).join('') || ''}
        <small>Solo estructura y funcionamiento. No guarda valores, dictados ni opciones.</small>
        <button class="secondary" type="button" data-action="memory-refresh">Reanalizar conservando memoria</button><button class="secondary" type="button" data-action="memory-forget">Olvidar esta pantalla</button>
      </div>
      ${state.frames.filter(frame => frame.memory).map(frame => `<div class="setting"><strong>Memoria: ${escapeHtml(frame.title)}</strong><small>${frame.memory.fields.length} campos · ${frame.memory.fields.filter(field => field.strategy).length} estrategias comprobadas</small><button class="secondary" type="button" data-action="forget-frame-memory" data-frame-id="${frame.frameId}">Olvidar esta pantalla del iframe</button></div>`).join('')}
      <div class="setting"><label for="jalfia-frame-scope">Documentos a analizar</label><select id="jalfia-frame-scope" data-action="frame-scope"><option value="all" ${state.frameScope === 'all' ? 'selected' : ''}>Página e iframes disponibles</option><option value="top" ${state.frameScope === 'top' ? 'selected' : ''}>Solo página principal</option>${state.frames.map(frame => `<option value="${frame.frameId}" ${state.frameScope === String(frame.frameId) ? 'selected' : ''}>${escapeHtml(frame.title)} (iframe ${frame.frameId})</option>`).join('')}</select></div>
      <div class="setting">
        <div class="setting-heading"><label for="jalfia-opacity">Opacidad</label><output for="jalfia-opacity" data-opacity-value>${Math.round(state.opacity * 100)}%</output></div>
        <input id="jalfia-opacity" type="range" min="55" max="100" value="${Math.round(state.opacity * 100)}" data-action="opacity">
      </div>
      <div class="setting setting-heading"><label for="jalfia-dark">Modo oscuro</label><input id="jalfia-dark" type="checkbox" role="switch" data-action="dark-mode" ${state.darkMode ? 'checked' : ''}></div>
      <div class="setting"><h2>Inteligencia artificial</h2><p>Configura el proveedor, servidor, clave y modelo, y prueba la conexión.</p><button class="primary" type="button" data-action="configure-ai">Configurar IA</button></div>
    </form>`;
  }

  function settingsNavigationIcon() {
    return state.settingsMode
      ? `<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
          <rect x="5" y="3" width="14" height="18" rx="2"></rect>
          <path d="M9 8h6M9 12h6M9 16h4"></path>
        </svg>`
      : `<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
          <path d="m9 3-.5 2.5-2 1.2L4 6l-2 3.5L4 11v2l-2 1.5L4 18l2.5-.7 2 1.2L9 21h6l.5-2.5 2-1.2 2.5.7 2-3.5L20 13v-2l2-1.5L20 6l-2.5.7-2-1.2L15 3Z"></path>
          <circle cx="12" cy="12" r="3"></circle>
        </svg>`;
  }

  function updateGlobalMicrophone() {
    const button = state.shadow.querySelector('[data-action="global-voice"]');
    if (!button) return;
    button.innerHTML = state.listening ? stopIcon() : microphoneIcon();
    button.setAttribute('aria-label', state.listening ? 'Detener y procesar dictado' : 'Comenzar dictado');
    button.classList.toggle('recording', state.listening);
    const label = state.shadow.querySelector('[data-voice-label]');
    if (label) label.textContent = state.voiceBusy ? 'Interpretando…' : state.listening ? 'Escuchando… Tocá para terminar' : 'Tocá para hablar';
  }

  function renderVoice() {
    state.voiceActionIndex = Math.min(state.voiceActionIndex, Math.max(0, state.voiceActions.length - 1));
    const actions = state.voiceActions.filter((action, index) => state.voicePreview ? action.include : index === state.voiceActionIndex).map((action) => {
      const index = state.voiceActions.indexOf(action);
      const field = state.fields.find(field => field.id === action.field_id);
      return `<article class="field setting">
      <div class="field-head"><div class="field-title"><span class="index">${index + 1}</span><div class="field-name"><label>${escapeHtml(action.label)}</label>${field ? `<span class="badge">${escapeHtml(fieldTypeLabel(field))}</span>` : ''}</div></div></div>
      ${state.voicePreview ? '' : `<label><input type="checkbox" data-voice-include="${index}" ${action.include ? 'checked' : ''}> Incluir este cambio ${action.needs_confirmation ? '· Requiere tu confirmación' : ''}</label>`}
      <div>${escapeHtml(action.value === 'true' ? 'Sí' : action.value === 'false' ? 'No' : action.value)}</div>
      <small>Dijiste: ${escapeHtml(action.evidence)}</small>
      ${action.errors.map(error => `<span class="validation-error">${escapeHtml(error)}</span>`).join('')}
      ${action.result ? `<span>${escapeHtml(action.result)}</span>` : ''}
    </article>`; }).join('');
    return `<section class="voice-view"><div class="voice-scroll ${state.voiceActions.length ? '' : 'voice-idle'}">
      ${state.voiceActions.length ? `<h2>${state.voicePreview ? 'Vista previa de cambios seleccionados' : 'Revisá los cambios propuestos'}</h2>${state.voicePreview ? '' : `<small>Cambio ${state.voiceActionIndex + 1} de ${state.voiceActions.length}</small>`}${actions}` : `<button class="global-mic" type="button" data-action="global-voice" aria-label="Comenzar dictado" ${state.voiceBusy ? 'disabled' : ''}>${microphoneIcon()}</button><strong data-voice-label>${state.voiceBusy ? 'Interpretando…' : 'Tocá para hablar'}</strong><small>${visibleFields().length} campos detectados</small>`}
      ${state.voiceShowText ? `<div class="recognized-text"><strong>Texto reconocido</strong><p data-transcript>${escapeHtml(state.voiceTranscript || 'Todavía no hay texto reconocido.')}</p>${state.voiceCorrectedText ? `<strong>Texto corregido por IA</strong><p>${escapeHtml(state.voiceCorrectedText)}</p>` : ''}</div>` : ''}
      </div>
      ${state.voiceActions.length ? `<div class="footer ${state.voicePreview ? '' : 'footer-navigation'}">
        ${state.voicePreview ? `<button class="secondary" type="button" data-action="voice-preview-back">Volver</button><button class="primary" type="button" data-action="apply-voice" ${state.voiceBusy || state.voiceActions.some(action => action.include && action.errors.length) ? 'disabled' : ''}>Confirmar y aplicar</button>` : `<button class="secondary" type="button" data-action="prev-voice" title="Cambio anterior" aria-label="Cambio anterior"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M19 12H5m7-7-7 7 7 7"></path></svg></button><button class="primary" type="button" data-action="voice-preview">Vista previa</button><button class="secondary" type="button" data-action="next-voice" title="Cambio siguiente" aria-label="Cambio siguiente"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14m-7-7 7 7-7 7"></path></svg></button>`}
      </div>` : ''}
      <div class="voice-toolbar">
        <button type="button" data-action="interpret-voice" title="Interpretar nuevamente" aria-label="Interpretar nuevamente" ${!state.voiceTranscript || state.listening || state.voiceBusy ? 'disabled' : ''}>${refreshIcon()}</button>
        <button type="button" data-action="manual-mode" title="Completar manualmente" aria-label="Completar manualmente" ${state.voiceBusy || state.listening ? 'disabled' : ''}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m15 5 4 4M4 20l4-1L20 7a2.8 2.8 0 0 0-4-4L4 15Z"></path></svg></button>
        <button type="button" data-action="new-voice" title="Nuevo dictado" aria-label="Nuevo dictado" ${state.voiceBusy || state.listening ? 'disabled' : ''}>${microphoneIcon()}</button>
        <button type="button" data-action="show-recognized" title="Ver texto reconocido" aria-label="Ver texto reconocido" aria-pressed="${state.voiceShowText}"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7S2 12 2 12Z"></path><circle cx="12" cy="12" r="3"></circle></svg></button>
      </div>
    </section>`;
  }

  async function processVoice() {
    if (state.voiceBusy || !state.voiceTranscript.trim()) { showStatus('No hay dictado para interpretar.'); return; }
    state.voiceBusy = true;
    try {
      await refreshFrames(); scanFields();
      if (visibleFields().some(field => ['combobox', 'autocomplete'].includes(field.kind) && !field.options.length)) await analyzeOptions();
      scanFields(); renderPanel();
      const fields = visibleFields().map(({ id, label, kind, options, rules }) => ({ id, label, kind, options, rules: { required: rules.required, pattern: rules.pattern, min: rules.min, max: rules.max, maxlength: rules.maxlength } }));
      const response = await chrome.runtime.sendMessage({ type: 'JALFIA_INTERPRET', transcript: state.voiceTranscript, fields });
      if (!response?.ok) throw new Error(response?.error || 'No pude interpretar el dictado.');
      state.voiceCorrectedText = response.corrected_text;
      state.voiceActionIndex = 0; state.voicePreview = false;
      state.voiceActions = response.actions.map(action => {
        const field = state.fields.find(field => field.id === action.field_id);
        return { ...action, label: field.label, include: !action.needs_confirmation, errors: validateFieldValue(field, action.value) };
      });
      showStatus(state.voiceActions.length ? `${state.voiceActions.length} cambios propuestos. Los demás campos quedarán intactos.` : 'No encontré cambios aplicables en el dictado.');
    } catch (error) { showStatus(error.message || 'No pude interpretar el dictado.'); }
    finally { state.voiceBusy = false; renderPanel(); }
  }

  async function applyVoiceActions() {
    if (state.voiceBusy || !state.voicePreview) return;
    const actions = state.voiceActions.filter(action => action.include);
    if (!actions.length) { showStatus('Selecciona al menos un cambio.'); return; }
    state.voiceBusy = true;
    let applied = 0;
    try {
      for (const action of actions) {
        scanFields();
        const field = state.fields.find(field => field.id === action.field_id);
        action.errors = field ? validateFieldValue(field, action.value) : ['El campo ya no está disponible.'];
        if (field && ['select', 'combobox', 'autocomplete'].includes(field.kind) && !field.options.some(option => option.text === action.value || option.value === action.value)) action.errors.push('La opción ya no está disponible. Actualiza el análisis.');
        if (action.errors.length) { action.result = 'No aplicado'; continue; }
        const result = await setFieldValue(action.field_id, action.value);
        const element = document.querySelector(`[data-jalfia-field-id="${CSS.escape(action.field_id)}"]`);
        const actual = element ? (['switch', 'checkbox', 'radio'].includes(field.kind) ? String(booleanState(element)) : element.isContentEditable ? element.textContent : element.value) : '';
        const selected = field.kind === 'select' ? element?.selectedOptions?.[0]?.textContent : '';
        const verified = field.frameId ? result.ok && result.verified : result.ok && (normalizeComparable(actual) === normalizeComparable(action.value) || normalizeComparable(selected) === normalizeComparable(action.value));
        action.result = verified ? '✓ Completado y comprobado' : result.reason || 'No se pudo comprobar el valor aplicado';
        if (verified) { applied++; action.include = false; state.draftValues.set(field.id, action.value); }
      }
      showStatus(`${applied} de ${actions.length} cambios completados y comprobados.`);
    } catch (error) { showStatus(error.message); }
    finally { state.voiceBusy = false; state.voicePreview = false; renderPanel(); }
  }

  function renderPanel() {
    updateDraftValues();
    scanFields();
    state.lastFieldSignature = fieldSignature(state.fields);
    state.lastDetectedCount = state.fields.length;

    state.shadow.innerHTML = `
      <style>${styles()}</style>
      <section class="shell ${state.darkMode ? 'dark' : ''}" style="opacity: ${state.opacity};">
        <header class="header" data-drag-handle>
          <div class="header-top">
            <div class="brand">
              <div class="logo">J</div>
              <div>
                <h1>JALFIA</h1>
                <div class="subtitle">Form Assistant</div>
              </div>
            </div>
            <div class="actions">
              <button class="icon-button settings-tab" type="button" data-action="settings" aria-pressed="${state.settingsMode}" title="${state.settingsMode ? 'Volver al formulario' : 'Abrir ajustes'}" aria-label="${state.settingsMode ? 'Volver al formulario' : 'Abrir ajustes'}">${settingsNavigationIcon()}</button>
              <button class="icon-button" type="button" data-action="minimize" title="Minimizar" aria-label="Minimizar">${minimizeIcon()}</button>
              <button class="icon-button" type="button" data-action="close" title="Cerrar">X</button>
            </div>
          </div>
          ${state.settingsMode ? '' : `<div class="meta">
            <div class="count-group">
              <div class="count">${state.fields.length} campo${state.fields.length === 1 ? '' : 's'} detectado${state.fields.length === 1 ? '' : 's'}</div>
              <button class="secondary" type="button" data-action="refresh" title="Reanalizar sin modificar los campos encontrados" aria-label="Reanalizar sin modificar los campos encontrados">${refreshIcon()}</button>
              <button class="secondary" type="button" data-action="recalculate" title="Limpia los datos cargados en JALFIA, cancela papeleras marcadas y vuelve a detectar desde cero" aria-label="Limpia los datos cargados en JALFIA, cancela papeleras marcadas y vuelve a detectar desde cero">${recalculateIcon()}</button>
              <button class="secondary" type="button" data-action="choose-scope" title="Elegir el formulario o sector a analizar" aria-label="Elegir el formulario o sector a analizar"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9V4h5m6 0h5v5m0 6v5h-5m-6 0H4v-5M9 9h6v6H9Z"></path></svg></button>
              ${!state.voiceMode ? `<button class="secondary" type="button" data-action="voice-mode" title="Completar con voz e IA" aria-label="Completar con voz e IA">${microphoneIcon()}</button>` : ''}
              ${state.scopeRoot ? `<button class="secondary" type="button" data-action="reset-scope" title="Volver a detectar en toda la pagina o dialogo activo" aria-label="Volver al alcance automatico">${removeFieldIcon()}</button>` : ''}
            </div>
            <button class="icon-button" type="button" data-action="analyze-options" ${state.analyzingOptions ? 'disabled' : ''} title="Analizar en profundidad: obtener opciones de combos y autocompletos" aria-label="Analizar en profundidad: obtener opciones de combos y autocompletos">
              <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                <circle cx="10" cy="10" r="7"></circle>
                <path d="m15 15 6 6M7 10h6M10 7v6"></path>
              </svg>
            </button>
          </div>`}
        </header>
        <div class="body">
          ${state.settingsMode ? renderSettings() : state.voiceMode ? renderVoice() : state.previewMode ? renderPreview() : renderCarousel()}
          <div class="status" data-status role="status" ${state.statusMessage ? '' : 'hidden'}>
            <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><circle cx="12" cy="12" r="9"></circle><path d="M12 11v6M12 7h.01"></path></svg>
            <span data-status-text>${escapeHtml(state.statusMessage)}</span>
          </div>
          ${state.settingsMode || state.voiceMode ? '' : `<footer class="footer ${state.previewMode ? '' : 'footer-navigation'}">
            ${state.previewMode
              ? `<button class="secondary" type="button" data-action="preview-back">Volver</button><button class="primary" type="button" data-action="confirm-fill" ${state.previewValues.some(item => item.errors?.length) ? 'disabled' : ''}>OK, completar</button>`
              : '<button class="secondary" type="button" data-action="prev-field" title="Campo anterior" aria-label="Campo anterior"><svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M19 12H5m7-7-7 7 7 7"></path></svg></button><button class="primary" type="button" data-action="preview-fill" title="Revisar los valores antes de rellenar">Rellenar</button><button class="secondary" type="button" data-action="next-field" title="Campo siguiente" aria-label="Campo siguiente"><svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M5 12h14m-7-7 7 7-7 7"></path></svg></button>'}
          </footer>`}
        </div>
      </section>
    `;

    wirePanelEvents();
    if (!state.analyzingOptions && !state.voiceBusy) syncMemory().catch(() => {});
    if (state.voiceMode && !state.settingsMode) updateGlobalMicrophone();
    schedulePanelSize();
  }

  function renderBubble() {
    scanFields();
    state.lastDetectedCount = state.fields.length;
    const tooltip = state.lastDetectedCount
      ? `Se detectaron ${state.lastDetectedCount} campo${state.lastDetectedCount === 1 ? '' : 's'} a rellenar. Hemos encontrado nuevos cambios o campos disponibles.`
      : 'No se detectaron campos a rellenar.';

    state.shadow.innerHTML = `
      <style>${styles()}</style>
      <button class="bubble" type="button" data-action="restore" title="${escapeHtml(tooltip)}" aria-label="${escapeHtml(tooltip)}">
        J
        ${state.lastDetectedCount ? `<span class="bubble-count" aria-hidden="true">${state.lastDetectedCount > 99 ? '99+' : state.lastDetectedCount}</span>` : ''}
      </button>
    `;

    wireBubbleEvents();
  }

  function showStatus(message) {
    state.statusMessage = message || '';
    const status = state.shadow?.querySelector('[data-status]');
    if (status) {
      status.hidden = !state.statusMessage;
      status.querySelector('[data-status-text]').textContent = state.statusMessage;
    }
    schedulePanelSize();
  }

  function updateDraftValues() {
    if (!state.shadow) return;

    state.shadow.querySelectorAll('[data-jalfia-value]').forEach((input) => {
      state.draftValues.set(input.dataset.jalfiaValue, input.value);
    });
  }

  function collectValues() {
    updateDraftValues();
    return Array.from(state.shadow.querySelectorAll('[data-jalfia-value]'))
      .map((input) => ({ id: input.dataset.jalfiaValue, value: input.value }))
      .filter(({ value }) => String(value).trim() !== '');
  }

  function collectPreviewValues() {
    updateDraftValues();
    return visibleFields()
      .map((field) => ({
        id: field.id,
        label: field.label,
        value: state.formClearFieldIds.has(field.id)
          ? ''
          : state.draftValues.has(field.id)
            ? state.draftValues.get(field.id)
            : '',
        clearReal: state.formClearFieldIds.has(field.id)
      }))
      .filter(({ value, clearReal }) => clearReal || String(value).trim() !== '')
      .map(item => ({ ...item, errors: validateFieldValue(state.fields.find(field => field.id === item.id), item.value) }));
  }

  function fieldSignature(fields) {
    return fields.map((field) => [
      field.id,
      field.label,
      field.kind,
      field.required ? '1' : '0',
      JSON.stringify(field.rules),
      field.options.map((option) => `${option.value}:${option.text}`).join('|')
    ].join('~')).join('||');
  }

  function autoRescan() {
    if (!state.panel || state.panel.style.display === 'none' || state.listening || state.previewMode || state.analyzingOptions || state.voiceBusy || state.dragging || state.cancelScopeSelection) return;
    if (!state.frameRefresh) refreshFrames().then(() => {
      scanFields();
      if (fieldSignature(state.fields) !== state.lastFieldSignature) {
        if (state.minimized) renderBubble(); else renderPanel();
      }
    }).catch(() => {});

    updateDraftValues();
    const previousSignature = state.lastFieldSignature;
    scanFields();
    const nextSignature = fieldSignature(state.fields);
    state.lastDetectedCount = state.fields.length;

    if (nextSignature !== previousSignature) {
      if (state.minimized) {
        state.lastFieldSignature = nextSignature;
        renderBubble();
        return;
      }
      renderPanel();
      showStatus('Formulario actualizado.');
    }
  }

  function scheduleAutoRescan(mutations = []) {
    if (state.listening) return;
    if (mutations.some((mutation) => mutation.target instanceof Element && isInsidePanel(mutation.target))) return;

    window.clearTimeout(state.rescanTimer);
    state.rescanTimer = window.setTimeout(autoRescan, 350);
  }

  function startAutoRescan() {
    if (!state.domObserver) {
      state.domObserver = new MutationObserver(scheduleAutoRescan);
      state.domObserver.observe(document.documentElement, {
        attributes: true,
        childList: true,
        subtree: true,
        attributeFilter: ['class', 'style', 'hidden', 'aria-hidden', 'aria-modal', 'aria-expanded', 'aria-controls', 'disabled', 'required', 'aria-required', 'aria-invalid', 'aria-checked', 'aria-describedby', 'aria-errormessage', 'pattern', 'minlength', 'maxlength', 'min', 'max', 'step', 'inputmode', 'data-mask', 'data-inputmask']
      });
    }

    if (!state.rescanInterval) {
      state.rescanInterval = window.setInterval(autoRescan, 4000);
    }
  }

  function stopAutoRescan() {
    if (state.domObserver) {
      state.domObserver.disconnect();
      state.domObserver = null;
    }

    window.clearTimeout(state.rescanTimer);
    state.rescanTimer = 0;

    window.clearInterval(state.rescanInterval);
    state.rescanInterval = 0;
  }

  function openPreview() {
    state.previewValues = collectPreviewValues();
    if (!state.previewValues.length) {
      showStatus('No hay valores cargados para completar.');
      return;
    }

    state.previewMode = true;
    renderPanel();
  }

  function closePreview() {
    state.previewMode = false;
    renderPanel();
  }

  async function fillForm(values = collectValues()) {
    if (!values.length) {
      showStatus('No hay valores cargados para completar.');
      return;
    }

    const results = await Promise.all(values.map(async ({ id, value }) => ({
      id,
      ...(await setFieldValue(id, value))
    })));
    const failures = results.filter((result) => !result.ok);

    if (failures.length) {
      showStatus(`Complete con observaciones: ${failures.length} campo${failures.length === 1 ? '' : 's'} no se pudo aplicar.`);
      return;
    }

    showStatus(`Formulario completado: ${values.length} campo${values.length === 1 ? '' : 's'} aplicado${values.length === 1 ? '' : 's'}.`);
  }

  async function confirmPreviewFill() {
    scanFields();
    state.previewValues = state.previewValues.map(item => {
      const field = state.fields.find(field => field.id === item.id);
      return { ...item, errors: field ? validateFieldValue(field, item.value) : ['El campo ya no está disponible.'] };
    });
    if (state.previewValues.some(item => item.errors.length)) {
      renderPanel(); showStatus('Corrige los valores señalados antes de completar.'); return;
    }
    const values = state.previewValues.map(({ id, value }) => ({ id, value }));
    state.previewMode = false;
    renderPanel();
    await fillForm(values);
  }

  function goToField(offset) {
    const fields = visibleFields();
    if (!fields.length) return;
    updateDraftValues();
    state.previewMode = false;
    state.activeFieldIndex = (state.activeFieldIndex + offset + fields.length) % fields.length;
    renderPanel();
  }

  function clearDraftField(fieldId) {
    const input = state.shadow.querySelector(`[data-jalfia-value="${CSS.escape(fieldId)}"]`);
    state.draftValues.set(fieldId, '');

    if (input) {
      input.value = '';
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
      input.focus({ preventScroll: true });
    }

    showStatus('Texto de JALFIA limpiado.');
  }

  function toggleClearRealField(fieldId) {
    const willClear = !state.formClearFieldIds.has(fieldId);
    const input = state.shadow.querySelector(`[data-jalfia-value="${CSS.escape(fieldId)}"]`);

    if (willClear) {
      state.formClearFieldIds.add(fieldId);
      state.draftValues.set(fieldId, '');
      if (input) {
        input.value = '';
      }
      showStatus('Marcado para vaciar en el formulario real.');
      renderPanel();
      return;
    }

    state.formClearFieldIds.delete(fieldId);
    showStatus('Vaciado del formulario real cancelado.');
    renderPanel();
  }

  function hideField(fieldId) {
    state.hiddenFieldIds.add(fieldId);
    const fields = visibleFields();
    state.activeFieldIndex = Math.min(state.activeFieldIndex, Math.max(0, fields.length - 1));
    state.previewMode = false;
    renderPanel();
    showStatus('Campo quitado del carrusel.');
  }

  function recalculatePanel() {
    state.optionCache.clear();
    state.draftValues.clear();
    state.formClearFieldIds.clear();
    state.hiddenFieldIds.clear();
    state.previewValues = [];
    state.previewMode = false;
    state.activeFieldIndex = 0;
    state.statusMessage = '';
    renderPanel();
    showStatus('Recalculado. Se limpiaron los cambios cargados en JALFIA.');
  }

  function keepPanelInViewport() {
    if (!state.panel) return;
    const rect = state.panel.getBoundingClientRect();
    const maxX = Math.max(8, window.innerWidth - rect.width - 8);
    const maxY = Math.max(8, window.innerHeight - rect.height - 8);
    state.position.x = Math.min(Math.max(8, state.position.x), maxX);
    state.position.y = Math.min(Math.max(8, state.position.y), maxY);
    state.panel.style.left = `${state.position.x}px`;
    state.panel.style.top = `${state.position.y}px`;
  }

  function panelMinimumHeight() {
    return state.settingsMode ? 300 : visibleFields().length ? 475 : 240;
  }

  function schedulePanelSize() {
    window.requestAnimationFrame(recalculatePanelSize);
  }

  function recalculatePanelSize() {
    if (!state.panel || state.minimized || state.panel.style.display === 'none') return;
    const content = state.shadow.querySelector('.carousel, .preview, .settings, .empty-state, .voice-view');
    if (!content) return;
    // Medir la altura natural sin el espacio extra que distribuye flex.
    const previousFlex = content.style.flex;
    content.style.flex = '0 0 auto';
    const scroll = content.querySelector?.('.voice-scroll');
    const contentHeight = scroll
      ? scroll.scrollHeight + (content.querySelector('.voice-toolbar')?.getBoundingClientRect().height || 0)
      : content.getBoundingClientRect().height;
    content.style.flex = previousFlex;
    const fixedHeight = ['.header', '.status', '.footer'].reduce((total, selector) =>
      total + (state.shadow.querySelector(selector)?.getBoundingClientRect().height || 0), 2);
    const minimum = panelMinimumHeight();
    const available = Math.max(240, window.innerHeight - 32);
    const effectiveMinimum = Math.min(minimum, available);
    const height = Math.min(available, Math.max(effectiveMinimum, Math.ceil(fixedHeight + contentHeight)));
    state.panel.style.minHeight = `${effectiveMinimum}px`;
    state.panel.style.height = `${height}px`;
    state.size.height = height;
    keepPanelInViewport();
  }

  function applyExpandedHostSize() {
    if (!state.panel) return;
    state.panel.style.width = `${Math.max(430, state.size.width)}px`;
    state.panel.style.height = `${Math.max(panelMinimumHeight(), Math.min(state.size.height, window.innerHeight - 32))}px`;
    state.panel.style.minWidth = '430px';
    state.panel.style.minHeight = `${panelMinimumHeight()}px`;
    state.panel.style.resize = 'both';
    state.panel.style.overflow = 'hidden';
    state.panel.style.borderRadius = '22px';
  }

  function applyMinimizedHostSize() {
    if (!state.panel) return;
    state.panel.style.width = '76px';
    state.panel.style.height = '76px';
    state.panel.style.minWidth = '76px';
    state.panel.style.minHeight = '76px';
    state.panel.style.resize = 'none';
    state.panel.style.overflow = 'visible';
    state.panel.style.borderRadius = '50%';
  }

  function enableDrag() {
    const handle = state.shadow.querySelector('[data-drag-handle]');
    if (!handle) return;

    handle.addEventListener('pointerdown', (event) => {
      if (event.target.closest('button, input')) return;

      const startX = event.clientX;
      const startY = event.clientY;
      const startLeft = state.position.x;
      const startTop = state.position.y;

      handle.setPointerCapture(event.pointerId);

      const move = (moveEvent) => {
        state.position.x = startLeft + moveEvent.clientX - startX;
        state.position.y = startTop + moveEvent.clientY - startY;
        keepPanelInViewport();
      };

      const up = () => {
        handle.removeEventListener('pointermove', move);
        handle.removeEventListener('pointerup', up);
        handle.removeEventListener('pointercancel', up);
      };

      handle.addEventListener('pointermove', move);
      handle.addEventListener('pointerup', up);
      handle.addEventListener('pointercancel', up);
    });
  }

  function wirePanelEvents() {
    state.shadow.querySelectorAll('[data-action="forget-frame-memory"]').forEach(button => button.addEventListener('click', async () => {
      const frame = state.frames.find(frame => String(frame.frameId) === button.dataset.frameId);
      if (!frame) return;
      const response = await frameRequest(frame, 'forget-memory');
      if (!response?.ok) { showStatus(response?.reason || 'No pude borrar la memoria del iframe.'); return; }
      frame.memory = null; renderPanel(); showStatus('Memoria de la pantalla del iframe eliminada.');
    }));
    state.shadow.querySelector('[data-action="memory-refresh"]')?.addEventListener('click', async () => {
      state.memoryForgotten = ''; state.memorySignature = '';
      await analyzeFields(); await syncMemory(true); renderPanel();
    });
    state.shadow.querySelector('[data-action="memory-forget"]')?.addEventListener('click', async () => {
      const snapshot = memorySnapshot();
      const response = await chrome.runtime.sendMessage({ type: 'JALFIA_MEMORY_FORGET', snapshot });
      if (!response?.ok) { showStatus(response?.error || 'No pude borrar la memoria.'); return; }
      state.memoryForgotten = JSON.stringify(snapshot); state.memory = null; state.memorySignature = '';
      renderPanel(); showStatus('Memoria de esta pantalla eliminada. Reanaliza para registrarla nuevamente.');
    });
    state.shadow.querySelector('[data-action="frame-scope"]')?.addEventListener('change', event => {
      state.frameScope = event.target.value; state.scopeRoot = null; state.previewMode = false;
      renderPanel(); showStatus('Alcance actualizado.');
    });
    for (const [action, offset] of [['prev-voice', -1], ['next-voice', 1]]) {
      state.shadow.querySelector(`[data-action="${action}"]`)?.addEventListener('click', () => {
        state.voiceActionIndex = (state.voiceActionIndex + offset + state.voiceActions.length) % state.voiceActions.length;
        renderPanel();
      });
    }
    state.shadow.querySelector('[data-action="voice-preview"]')?.addEventListener('click', () => {
      if (!state.voiceActions.some(action => action.include)) { showStatus('Selecciona al menos un cambio para revisar.'); return; }
      state.voicePreview = true; renderPanel();
    });
    state.shadow.querySelector('[data-action="voice-preview-back"]')?.addEventListener('click', () => { state.voicePreview = false; renderPanel(); });
    if (state.voiceBusy) state.shadow.querySelectorAll('button, input, select, textarea').forEach(control => { control.disabled = true; });
    state.shadow.querySelector('[data-action="global-voice"]')?.addEventListener('click', () => {
      if (state.voiceBusy) return;
      state.voiceSubmit = state.listening;
      startVoiceRecognition();
    });
    state.shadow.querySelector('[data-action="interpret-voice"]')?.addEventListener('click', processVoice);
    state.shadow.querySelector('[data-action="apply-voice"]')?.addEventListener('click', applyVoiceActions);
    state.shadow.querySelector('[data-action="new-voice"]')?.addEventListener('click', () => { state.voiceActions = []; state.voiceActionIndex = 0; state.voicePreview = false; state.voiceTranscript = ''; state.voiceCorrectedText = ''; renderPanel(); });
    state.shadow.querySelector('[data-action="show-recognized"]')?.addEventListener('click', () => { state.voiceShowText = !state.voiceShowText; renderPanel(); });
    state.shadow.querySelector('[data-action="manual-mode"]')?.addEventListener('click', () => { state.voiceMode = false; renderPanel(); });
    state.shadow.querySelector('[data-action="voice-mode"]')?.addEventListener('click', () => { state.voiceMode = true; state.previewMode = false; renderPanel(); });
    state.shadow.querySelectorAll('[data-voice-include]').forEach(input => input.addEventListener('change', () => { state.voiceActions[Number(input.dataset.voiceInclude)].include = input.checked; }));
    state.shadow.querySelector('[data-action="configure-ai"]')?.addEventListener('click', () => {
      chrome.runtime.sendMessage({ type: 'JALFIA_OPEN_AI_SETTINGS' }).catch(() => showStatus('No pude abrir la configuración de IA.'));
    });
    state.shadow.querySelectorAll('details').forEach((details) => details.addEventListener('toggle', schedulePanelSize));
    state.shadow.querySelector('[data-action="choose-scope"]')?.addEventListener('click', chooseScope);
    state.shadow.querySelector('[data-action="reset-scope"]')?.addEventListener('click', () => {
      state.cancelScopeSelection?.(); state.scopeRoot = null; state.previewMode = false; state.optionCache.clear();
      renderPanel(); showStatus('Alcance automatico restablecido.');
    });
    state.shadow.querySelectorAll('[data-action="choose-option"]').forEach((button) => {
      button.addEventListener('click', () => {
        const input = state.shadow.querySelector(`[data-jalfia-value="${CSS.escape(button.dataset.fieldId)}"]`);
        if (!input) return;
        input.value = button.dataset.optionValue;
        dispatchInputEvents(input);
        showStatus('Opcion elegida en JALFIA. Pulsa Rellenar para revisar y confirmar.');
      });
    });
    if (state.analyzingOptions) {
      state.shadow.querySelectorAll('button, input, select, textarea').forEach((control) => {
        if (control.dataset.action !== 'close') control.disabled = true;
      });
    }
    state.shadow.querySelector('[data-action="analyze-options"]')?.addEventListener('click', () => analyzeOptions());
    state.shadow.querySelectorAll('[data-action="obtain-options"]').forEach((button) => {
      button.addEventListener('click', () => analyzeOptions(button.dataset.fieldId));
    });
    state.shadow.querySelector('.settings')?.addEventListener('submit', (event) => event.preventDefault());
    state.shadow.querySelector('[data-action="settings"]')?.addEventListener('click', () => {
      state.stopVoice?.();
      state.settingsMode = !state.settingsMode;
      renderPanel();
    });
    state.shadow.querySelector('[data-action="dark-mode"]')?.addEventListener('change', (event) => {
      state.darkMode = event.target.checked;
      state.shadow.querySelector('.shell').classList.toggle('dark', state.darkMode);
      saveSettings();
    });
    state.shadow.querySelectorAll('[data-action="refresh"]').forEach((button) => {
      button.addEventListener('click', () => analyzeFields());
    });
    state.shadow.querySelector('[data-action="recalculate"]')?.addEventListener('click', () => analyzeFields(true));

    state.shadow.querySelector('[data-action="minimize"]')?.addEventListener('click', minimizePanel);
    state.shadow.querySelector('[data-action="close"]')?.addEventListener('click', hidePanel);
    state.shadow.querySelector('[data-action="prev-field"]')?.addEventListener('click', () => goToField(-1));
    state.shadow.querySelector('[data-action="next-field"]')?.addEventListener('click', () => goToField(1));
    state.shadow.querySelector('[data-action="preview-fill"]')?.addEventListener('click', openPreview);
    state.shadow.querySelector('[data-action="preview-back"]')?.addEventListener('click', closePreview);
    state.shadow.querySelector('[data-action="confirm-fill"]')?.addEventListener('click', confirmPreviewFill);
    state.shadow.querySelectorAll('[data-action="clear-draft"]').forEach((button) => {
      button.addEventListener('click', () => clearDraftField(button.dataset.fieldId));
    });
    state.shadow.querySelectorAll('[data-action="clear-real"]').forEach((button) => {
      button.addEventListener('click', () => toggleClearRealField(button.dataset.fieldId));
    });
    state.shadow.querySelectorAll('[data-action="hide-field"]').forEach((button) => {
      button.addEventListener('click', () => hideField(button.dataset.fieldId));
    });
    state.shadow.querySelectorAll('[data-action="voice"]').forEach((button) => {
      button.addEventListener('click', () => startVoiceRecognition(button.dataset.fieldId));
    });
    state.shadow.querySelectorAll('[data-jalfia-value]').forEach((input) => {
      input.addEventListener('input', () => {
        state.draftValues.set(input.dataset.jalfiaValue, input.value);
        state.formClearFieldIds.delete(input.dataset.jalfiaValue);
      });
      input.addEventListener('change', () => {
        state.draftValues.set(input.dataset.jalfiaValue, input.value);
        state.formClearFieldIds.delete(input.dataset.jalfiaValue);
      });
    });
    state.shadow.querySelector('[data-action="opacity"]')?.addEventListener('input', (event) => {
      state.opacity = Number(event.target.value) / 100;
      state.shadow.querySelector('.shell').style.opacity = String(state.opacity);
      state.shadow.querySelector('[data-opacity-value]').textContent = `${Math.round(state.opacity * 100)}%`;
    });
    state.shadow.querySelector('[data-action="opacity"]')?.addEventListener('change', saveSettings);

    enableDrag();
  }

  function wireBubbleEvents() {
    const bubble = state.shadow.querySelector('[data-action="restore"]');
    if (!bubble) return;
    let suppressClick = false;
    bubble.addEventListener('click', (event) => {
      if (suppressClick && event.detail !== 0) {
        event.preventDefault();
        suppressClick = false;
        return;
      }
      suppressClick = false;
      restorePanel();
    });
    bubble.addEventListener('pointerdown', (event) => {
      if (event.button !== 0 || !event.isPrimary) return;
      suppressClick = false;
      state.dragging = true;
      const start = { x: event.clientX, y: event.clientY, left: state.position.x, top: state.position.y };
      bubble.setPointerCapture(event.pointerId);
      const move = (next) => {
        const dx = next.clientX - start.x;
        const dy = next.clientY - start.y;
        if (!suppressClick && Math.hypot(dx, dy) < 5) return;
        suppressClick = true;
        state.position.x = start.left + dx;
        state.position.y = start.top + dy;
        keepPanelInViewport();
      };
      const end = () => {
        state.dragging = false;
        bubble.removeEventListener('pointermove', move);
        bubble.removeEventListener('pointerup', end);
        bubble.removeEventListener('pointercancel', end);
        bubble.removeEventListener('lostpointercapture', end);
      };
      bubble.addEventListener('pointermove', move);
      bubble.addEventListener('pointerup', end);
      bubble.addEventListener('pointercancel', end);
      bubble.addEventListener('lostpointercapture', end);
    });
  }

  function createPanel() {
    const host = document.createElement('div');
    host.id = PANEL_ID;
    host.style.position = 'fixed';
    host.style.left = `${state.position.x}px`;
    host.style.top = `${state.position.y}px`;
    host.style.maxWidth = 'calc(100vw - 16px)';
    host.style.maxHeight = 'calc(100vh - 16px)';
    host.style.containerType = 'inline-size';
    host.style.zIndex = '2147483647';
    host.style.pointerEvents = 'auto';
    host.style.resize = 'both';
    host.style.overflow = 'hidden';

    document.documentElement.appendChild(host);
    state.panel = host;
    state.shadow = host.attachShadow({ mode: 'open' });
    applyExpandedHostSize();
    renderPanel();
    keepPanelInViewport();
  }

  function showPanel() {
    if (!IS_TOP_FRAME) return;
    if (!state.panel) createPanel();
    state.minimized = false;
    state.panel.style.display = 'block';
    applyExpandedHostSize();
    renderPanel();
    startAutoRescan();
    refreshFrames().then(() => { if (state.panel.style.display !== 'none') renderPanel(); }).catch(error => showStatus(error.message));
  }

  function hidePanel() {
    state.cancelScopeSelection?.();
    state.stopVoice?.();
    state.minimized = false;
    if (state.panel) state.panel.style.display = 'none';
    stopAutoRescan();
  }

  function minimizePanel() {
    state.cancelScopeSelection?.();
    if (!state.panel) return;
    state.stopVoice?.();
    const rect = state.panel.getBoundingClientRect();
    state.size = { width: Math.max(430, rect.width), height: Math.max(475, rect.height) };
    updateDraftValues();
    state.minimized = true;
    state.previewMode = false;
    applyMinimizedHostSize();
    renderBubble();
    keepPanelInViewport();
    startAutoRescan();
  }

  function restorePanel() {
    if (!state.panel) return;
    state.minimized = false;
    applyExpandedHostSize();
    renderPanel();
    keepPanelInViewport();
    startAutoRescan();
  }

  function togglePanel() {
    if (!state.panel || state.panel.style.display === 'none') {
      showPanel();
      return;
    }
    if (state.minimized) {
      restorePanel();
      return;
    }
    hidePanel();
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (_sender.id !== chrome.runtime.id) return false;
    if (message?.type === 'JALFIA_FRAME_LOCK' && !IS_TOP_FRAME) {
      state.frameUnlock?.();
      if (message.locked) {
        const events = ['pointerdown', 'pointerup', 'click', 'keydown', 'keyup', 'wheel', 'touchstart', 'touchmove'];
        const block = event => { if (event.isTrusted) { event.preventDefault(); event.stopImmediatePropagation(); } };
        events.forEach(type => window.addEventListener(type, block, { capture: true, passive: false }));
        const timeout = window.setTimeout(() => state.frameUnlock?.(), 60000);
        state.frameUnlock = () => { window.clearTimeout(timeout); events.forEach(type => window.removeEventListener(type, block, true)); state.frameUnlock = null; };
      }
      sendResponse({ ok: true }); return false;
    }
    if (message?.type === 'JALFIA_FRAME_SCAN' && !IS_TOP_FRAME) {
      scanFields();
      syncMemory().then(() => sendResponse({ ok: true, title: document.title, fields: scanFields(), memory: state.memory }), () => sendResponse({ ok: true, title: document.title, fields: scanFields() }));
      return true;
    }
    if (message?.type === 'JALFIA_FRAME_OPERATION' && !IS_TOP_FRAME) {
      (async () => {
        scanFields();
        if (message.operation === 'forget-memory') {
          const snapshot = memorySnapshot();
          const response = await chrome.runtime.sendMessage({ type: 'JALFIA_MEMORY_FORGET', snapshot });
          if (response?.ok) { state.memoryForgotten = JSON.stringify(snapshot); state.memorySignature = ''; state.memory = null; }
          return response;
        }
        const field = state.fields.find(field => field.id === message.fieldId);
        if (!field) throw new Error('El campo del iframe ya no está disponible.');
        if (message.operation === 'options') {
          await obtainFieldOptions(field.id); scanFields();
          return { ok: true, field: state.fields.find(item => item.id === field.id) };
        }
        if (message.operation !== 'fill') throw new Error('Operación no admitida.');
        const errors = validateFieldValue(field, message.value);
        if (errors.length) return { ok: false, reason: errors.join(' ') };
        const result = await setFieldValue(field.id, message.value);
        const element = document.querySelector(`[data-jalfia-field-id="${CSS.escape(field.id)}"]`);
        const actual = element ? (['switch', 'checkbox', 'radio'].includes(field.kind) ? String(booleanState(element)) : element.isContentEditable ? element.textContent : element.value) : '';
        const selected = element?.selectedOptions?.[0]?.textContent || '';
        return { ...result, verified: result.ok && (normalizeComparable(actual) === normalizeComparable(message.value) || normalizeComparable(selected) === normalizeComparable(message.value)) };
      })().then(sendResponse, error => sendResponse({ ok: false, reason: error.message }));
      return true;
    }
    if (message?.type === 'JALFIA_TOGGLE_PANEL') {
      if (!IS_TOP_FRAME) return false;
      togglePanel();
      sendResponse({ ok: true });
      return true;
    }

    if (message?.type === 'JALFIA_SCAN') {
      sendResponse({ ok: true, fields: scanFields() });
      return true;
    }

    if (message?.type === 'JALFIA_FILL') {
      Promise.all((message.values || []).map(async ({ id, value }) => ({
        id,
        ...(await setFieldValue(id, value))
      }))).then((results) => {
        sendResponse({ ok: true, results });
      });
      return true;
    }

    return false;
  });

  window.addEventListener('resize', () => {
    schedulePanelSize();
    keepPanelInViewport();
  });
  document.addEventListener('change', (event) => {
    if (!(event.target instanceof Element) || isInsidePanel(event.target) || !event.target.matches(FIELD_SELECTOR)) return;
    // Las opciones de otros campos pueden depender del valor que acaba de cambiar.
    const changedId = event.target.dataset.jalfiaFieldId;
    for (const id of state.optionCache.keys()) if (id !== changedId) state.optionCache.delete(id);
    scheduleAutoRescan();
  }, true);
})();
