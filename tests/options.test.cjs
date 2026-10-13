const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, '../src/content.js'), 'utf8');
function setup() {
  const state = { optionCache: new Map(), draftValues: new Map(), editedFieldIds: new Set(), hiddenFieldIds: new Set(), formClearFieldIds: new Set(), fields: [], panel: { style: {} } };
  let menus = [], fields = [];
  const document = {
    activeElement: null,
    getElementById: id => menus.find(menu => menu.id === id),
    querySelectorAll: () => menus,
    querySelector: () => fields[0]
  };
  const context = {
    IS_TOP_FRAME: false,
    ANALYSIS_OVERLAY_ID: 'jalfia-analysis-overlay',
    state, document, CSS: { escape: s => s },
    KeyboardEvent: class { constructor(type, init) { this.type = type; Object.assign(this, init); } },
    normalizeText: s => String(s || '').replace(/\s+/g, ' ').trim(),
    isVisible: node => node.visible !== false,
    fieldKind: () => 'autocomplete', getFieldId: node => node.id,
    inferLabel: () => 'Ubicacion', isInsidePanel: () => false, isInteractable: () => true,
    readFieldRules: () => ({}),
    getActiveContextRoot: () => ({ querySelectorAll: () => fields }), FIELD_SELECTOR: 'input',
    wait: async () => {}
  };
  vm.createContext(context);
  for (const [start, end] of [
    ['  function selectableOptionNode(', '  function getFieldId('],
    ['  function describeField(', '  function dispatchInputEvents('],
    ['  async function obtainFieldOptions(', '  async function analyzeOptions(']
  ]) vm.runInContext(source.slice(source.indexOf(start), source.indexOf(end)), context);
  const input = (id, controls) => ({
    id, tagName: 'INPUT', dataset: {}, value: 'Valor original', isConnected: true,
    matches: () => false,
    getAttribute: name => name === 'aria-controls' ? controls : null,
    closest: () => null,
    focus() { document.activeElement = this; }, blur() { document.activeElement = null; },
    click() { const menu = document.getElementById(controls); if (menu) menu.visible = true; },
    dispatchEvent(event) { if (event.key === 'Escape') { const menu = document.getElementById(controls); if (menu) menu.visible = false; } }
  });
  const menu = (id, texts) => ({ id, visible: true, querySelectorAll: () => texts.map(text => ({ innerText: text, closest: () => null, matches: () => true, getAttribute: () => null, classList: { contains: () => false } })) });
  return { context, state, input, menu, setMenus: value => { menus = value; }, setFields: value => { fields = value; } };
}

test('asocia overlays por ARIA sin mezclar opciones de otros campos', () => {
  const s = setup();
  s.setMenus([s.menu('ubicaciones', ['Mitre', 'Los Fresnos']), s.menu('otro', ['Otra opcion'])]);
  assert.deepEqual(Array.from(s.context.listboxOptionsFor(s.input('a', 'ubicaciones')), o => o.text), ['Mitre', 'Los Fresnos']);
  const unlinked = s.input('b', null);
  s.context.document.activeElement = unlinked;
  assert.equal(s.context.listboxOptionsFor(unlinked).length, 0);
});

test('incluye la selección visible de Vuetify aunque no esté en la lista desplegada', () => {
  const s = setup(), input = s.input('provider', null);
  input.value = ''; input.readOnly = true;
  input.closest = selector => selector === '.v-select, .v-autocomplete, .v-combobox'
    ? { querySelectorAll: () => [{ textContent: 'MEDICO DE PRUEBA' }] } : null;
  const field = s.context.describeField(input, 0);
  assert.ok(field.options.some(option => option.text === 'MEDICO DE PRUEBA' && option.selected));
});

test('no incluye campos calculados de solo lectura pero conserva combos de selección', () => {
  const s = setup();
  const calculated = s.input('imc', null); calculated.readOnly = true;
  const editable = s.input('weight', null);
  const combo = s.input('provider', null); combo.readOnly = true;
  s.context.fieldKind = element => element === combo ? 'combobox' : 'text';
  s.setFields([calculated, editable, combo]);
  assert.deepEqual(Array.from(s.context.scanFields(), field => field.id), ['weight', 'provider']);
});

test('descarta instrucciones, filas no interactivas y opciones deshabilitadas', () => {
  const s = setup();
  const node = {
    innerText: 'Inserte minimo tres letras o presione ENTER para buscar.',
    closest: () => null, matches: () => false,
    getAttribute: () => null, classList: { contains: () => false }
  };
  assert.equal(s.context.optionFromNode(node), null);
  const selectable = { ...node, innerText: 'Hospital', matches: () => true };
  assert.equal(s.context.optionFromNode(selectable).text, 'Hospital');
  const disabled = { ...selectable, closest: selector => selector.includes('[disabled]') ? {} : null };
  assert.equal(s.context.optionFromNode(disabled), null);
  const title = { closest: () => selectable };
  assert.equal(s.context.optionFromNode(title).text, 'Hospital');
});

test('conserva opciones al cerrar el menu y limpia campos desaparecidos', () => {
  const s = setup(), input = s.input('a', 'menu'), menu = s.menu('menu', ['Hospital']);
  s.setMenus([menu]); s.setFields([input]);
  s.context.scanFields(); menu.visible = false;
  assert.equal(s.context.scanFields()[0].options[0].text, 'Hospital');
  s.state.draftValues.set('a', 'Borrador'); s.state.formClearFieldIds.add('a');
  s.setFields([]); s.context.scanFields();
  assert.equal(s.state.optionCache.size, 0); assert.equal(s.state.draftValues.size, 0); assert.equal(s.state.formClearFieldIds.size, 0);
});

test('explora un menu cerrado sin cambiar el valor y restaura el foco', async () => {
  const s = setup(), input = s.input('a', 'menu'), menu = s.menu('menu', ['Hospital']);
  menu.visible = false; s.setMenus([menu]); s.setFields([input]);
  const previous = { isConnected: true, focus() { s.context.document.activeElement = this; } };
  s.context.document.activeElement = previous;
  assert.equal(await s.context.obtainFieldOptions('a'), true);
  assert.equal(input.value, 'Valor original'); assert.equal(menu.visible, false);
  assert.equal(s.context.document.activeElement, previous); assert.equal(s.state.optionCache.get('a').options.length, 1);
});

test('no cierra un menu que ya estaba abierto y tolera un campo eliminado', async () => {
  const s = setup(), input = s.input('a', 'menu'), menu = s.menu('menu', ['Hospital']);
  s.setMenus([menu]); s.setFields([input]);
  await s.context.obtainFieldOptions('a'); assert.equal(menu.visible, true);
  s.context.wait = async () => { input.isConnected = false; };
  assert.equal(await s.context.obtainFieldOptions('a'), false);
});

test('el loader bloquea eventos humanos, permite la exploracion y libera sus listeners', () => {
  const s = setup(), listeners = new Map(), progress = { textContent: '' };
  let removed = false;
  const host = { style: {}, attachShadow: () => ({ innerHTML: '', querySelector: () => progress }), remove() { removed = true; } };
  s.context.document.createElement = () => host;
  s.context.document.documentElement = { appendChild() {} };
  s.context.window = { addEventListener: (type, fn) => listeners.set(type, fn), removeEventListener: type => listeners.delete(type) };
  vm.runInContext(source.slice(source.indexOf('  function showAnalysisOverlay()'), source.indexOf('  async function analyzeOptions(')), s.context);
  const overlay = s.context.showAnalysisOverlay();
  let blocked = 0;
  const event = { isTrusted: true, preventDefault() { blocked++; }, stopImmediatePropagation() {} };
  listeners.get('click')(event); listeners.get('keydown')(event);
  listeners.get('click')({ ...event, isTrusted: false }); assert.equal(blocked, 2);
  overlay.update('1 de 2: Ubicacion'); assert.equal(progress.textContent, '1 de 2: Ubicacion');
  overlay.remove(); assert.equal(listeners.size, 0); assert.equal(removed, true); assert.equal(s.state.analysisOverlay, null);
});

test('el analisis retira el loader aunque falle la exploracion', async () => {
  const s = setup(); let removed = false;
  Object.assign(s.context, {
    updateDraftValues() {}, scanFields() {}, renderPanel() {}, showStatus() {},
    visibleFields: () => [{ id: 'a', kind: 'autocomplete', label: 'Ubicacion' }],
    showAnalysisOverlay: () => ({ update() {}, remove() { removed = true; } }),
    completeAnalysis: async () => {},
    obtainFieldOptions: async () => { throw new Error('fallo de prueba'); }
  });
  vm.runInContext(source.slice(source.indexOf('  async function analyzeOptions('), source.indexOf('  function normalizeComparable(')), s.context);
  await s.context.analyzeOptions();
  assert.equal(removed, true); assert.equal(s.state.analyzingOptions, false);
});

test('switches ARIA cambian con clic y verifican el estado de la aplicacion', async () => {
  const s = setup();
  vm.runInContext(source.slice(source.indexOf('  function normalizeBoolean('), source.indexOf('  function setSelectValue(')), s.context);
  let checked = false, clicks = 0;
  const control = { matches: () => false, getAttribute: () => String(checked), click() { clicks++; checked = !checked; } };
  assert.equal((await s.context.setBooleanValue(control, 'true', 'switch')).ok, true);
  assert.equal(checked, true); assert.equal(clicks, 1);
  await s.context.setBooleanValue(control, 'true', 'switch'); assert.equal(clicks, 1);
  control.click = () => { clicks++; };
  assert.equal((await s.context.setBooleanValue(control, 'false', 'switch')).ok, false);
  assert.equal((await s.context.setBooleanValue(control, 'false', 'radio')).ok, false);
});

test('el sector elegido limita el escaneo y vuelve al alcance automatico si desaparece', () => {
  const s = setup();
  Object.assign(s.context, { blockingContextSelectors: () => '', contextScore: () => 0, isAuxiliaryPopup: () => false });
  s.setMenus([]);
  vm.runInContext(source.slice(source.indexOf('  function getActiveContextRoot('), source.indexOf('  function isInteractable(')), s.context);
  const sector = { isConnected: true };
  s.state.scopeRoot = sector; assert.equal(s.context.getActiveContextRoot(), sector);
  sector.isConnected = false; assert.equal(s.context.getActiveContextRoot(), s.context.document); assert.equal(s.state.scopeRoot, null);
});

test('la altura se compacta sin campos, crece con contenido y respeta la ventana', () => {
  const s = setup();
  let contentHeight = 70;
  const content = { style: { flex: '' }, getBoundingClientRect: () => ({ height: contentHeight }) };
  const fixed = { getBoundingClientRect: () => ({ height: 60 }) };
  s.state.size = { width: 430, height: 475 };
  s.state.shadow = { querySelector: selector => selector.includes('.carousel') ? content : fixed };
  Object.assign(s.context, { window: { innerHeight: 900 }, visibleFields: () => s.state.fields, keepPanelInViewport() {} });
  vm.runInContext(source.slice(source.indexOf('  function panelMinimumHeight('), source.indexOf('  function applyExpandedHostSize(')), s.context);
  s.context.recalculatePanelSize(); assert.equal(s.state.panel.style.height, '252px');
  s.state.fields = [{}]; s.context.recalculatePanelSize(); assert.equal(s.state.panel.style.height, '475px');
  contentHeight = 1000; s.context.recalculatePanelSize(); assert.equal(s.state.panel.style.height, '868px');
  s.context.window.innerHeight = 400; s.context.recalculatePanelSize(); assert.equal(s.state.panel.style.height, '368px');
  s.state.minimized = true; contentHeight = 70; s.context.recalculatePanelSize(); assert.equal(s.state.panel.style.height, '368px');
});

test('la etapa final mantiene el bloqueo tres segundos sin contador visible', async () => {
  const s = setup(), waits = [], updates = [];
  s.context.wait = async ms => waits.push(ms);
  vm.runInContext(source.slice(source.indexOf('  async function completeAnalysis('), source.indexOf('  async function analyzeFields(')), s.context);
  await s.context.completeAnalysis({ update: (text, title) => updates.push([text, title]) });
  assert.deepEqual(waits, [3000]);
  assert.deepEqual(updates, [['', 'Completando análisis…']]);
});

test('valida obligatoriedad y longitudes sin escribir en el formulario', () => {
  const s = setup(); let probes = 0;
  s.context.normalizeBoolean = value => value === true || value === 'true';
  s.context.document.createElement = () => { probes++; return { type: 'text', value: '', validity: {}, setAttribute() {} }; };
  vm.runInContext(source.slice(source.indexOf('  function validateFieldValue('), source.indexOf('  function describeField(')), s.context);
  const field = { kind: 'text', rules: { required: true, minlength: '3', maxlength: '8' } };
  assert.equal(s.context.validateFieldValue(field, '').length, 1);
  assert.equal(s.context.validateFieldValue(field, 'ab').length, 1);
  assert.equal(s.context.validateFieldValue(field, '123456789').length, 1);
  assert.equal(s.context.validateFieldValue(field, 'abc').length, 0);
  assert.equal(s.context.validateFieldValue({ kind: 'switch', rules: { required: true } }, 'false').length, 1);
  assert.equal(probes, 3);
});

test('el modo voz agrupa acciones en una barra y oculta el texto hasta solicitarlo', () => {
  const s = setup();
  Object.assign(s.state, { voiceActions: [], voiceTranscript: 'texto original', voiceCorrectedText: 'Texto corregido.', voiceShowText: false });
  Object.assign(s.context, { visibleFields: () => [], escapeHtml: value => String(value), microphoneIcon: () => '', refreshIcon: () => '' });
  vm.runInContext(source.slice(source.indexOf('  function renderVoice('), source.indexOf('  async function processVoice(')), s.context);
  let html = s.context.renderVoice();
  assert.match(html, /voice-toolbar/); assert.doesNotMatch(html, /<p data-transcript>/);
  for (const action of ['interpret-voice', 'manual-mode', 'global-voice', 'show-recognized']) assert.ok(html.includes(`data-action="${action}"`));
  assert.ok(!html.includes('data-action="new-voice"'));
  s.state.voiceShowText = true; html = s.context.renderVoice();
  assert.match(html, /texto original/); assert.match(html, /Texto corregido\./);
});

test('los cambios de voz se muestran uno por uno y solo se aplican desde la vista previa', () => {
  const s = setup();
  const action = label => ({ field_id: label, label, value: label, evidence: 'dictado', include: true, errors: [] });
  Object.assign(s.state, { voiceActions: [action('Ubicación'), action('Detalle')], voiceActionIndex: 0, voicePreview: false, voiceTranscript: 'dictado', voiceShowText: false });
  Object.assign(s.context, { visibleFields: () => [], escapeHtml: value => String(value), microphoneIcon: () => '', refreshIcon: () => '' });
  vm.runInContext(source.slice(source.indexOf('  function renderVoice('), source.indexOf('  async function processVoice(')), s.context);
  let html = s.context.renderVoice();
  assert.match(html, /data-action="global-voice"/);
  assert.match(html, /Ubicación/); assert.doesNotMatch(html, /Detalle/);
  assert.match(html, /data-action="prev-voice"/); assert.match(html, /data-action="next-voice"/);
  assert.doesNotMatch(html, /data-action="apply-voice"/);
  s.state.voiceActionIndex = 1; html = s.context.renderVoice(); assert.match(html, /Detalle/); assert.doesNotMatch(html, /Ubicación/);
  s.state.voicePreview = true; html = s.context.renderVoice(); assert.match(html, /Ubicación/); assert.match(html, /Detalle/); assert.match(html, /Confirmar y aplicar/);
  s.state.voiceActions[0].include = false; html = s.context.renderVoice(); assert.doesNotMatch(html, /Ubicación/);
});

test('un input oculto con role switch se detecta mediante su contenedor visible de Vuetify', () => {
  const s = setup();
  vm.runInContext(source.slice(source.indexOf('  function isInteractable('), source.indexOf('  function fieldKind(')), s.context);
  const wrapper = { visible: true };
  const input = { visible: false, matches: () => true, parentElement: { closest: () => wrapper } };
  assert.equal(s.context.isInteractable(input), true);
  wrapper.visible = false; assert.equal(s.context.isInteractable(input), false);
});
