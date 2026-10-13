const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, '../src/content.js'), 'utf8');

function setup() {
  class Input {
    constructor(value) { this._value = value; this.tagName = 'INPUT'; this.isConnected = true; this.style = {}; this.type = 'text'; this.selectionStart = 5; this.selectionEnd = 10; }
    get value() { return this._value; } set value(value) { this._value = value; }
    closest(selector) { return selector.startsWith('textarea') ? this : null; }
    focus() {} setSelectionRange(start, end) { this.selectionStart = start; this.selectionEnd = end; }
  }
  const listeners = new Map(), statuses = [], state = { fields: [], voiceTranscript: '', voiceActions: [], voiceTarget: null };
  let starts = 0, aiCalls = 0, events = 0;
  const context = {
    location: { hostname: 'example.com', pathname: '/form', origin: 'https://example.com', href: 'https://example.com/form' },
    URL, AbortSignal,
    state, PANEL_ID: 'jalfia-assistant-panel', FIELD_SELECTOR: 'input', Element: Input, HTMLInputElement: Input, HTMLTextAreaElement: Input,
    document: { body: {}, documentElement: {} }, window: {
      addEventListener: (name, handler) => listeners.set(name, handler),
      removeEventListener: (name, handler) => { if (listeners.get(name) === handler) listeners.delete(name); }
    },
    inferLabel: () => 'Detalle', isInsidePanel: () => false, renderPanel() {},
    showStatus: message => statuses.push(message), startVoiceRecognition: () => { starts++; },
    dispatchInputEvents: () => { events++; },
    chrome: { runtime: { sendMessage: async () => { aiCalls++; } } },
    sendExtensionMessage: async () => { aiCalls++; }
  };
  vm.createContext(context);
  vm.runInContext(source.slice(source.indexOf('  function voiceDestinationFor('), source.indexOf('  function renderSettings(')), context);
  vm.runInContext(source.slice(source.indexOf('  async function processVoice('), source.indexOf('  async function applyVoiceActions(')), context);
  return { context, Input, state, listeners, statuses, starts: () => starts, aiCalls: () => aiCalls, events: () => events };
}

test('el selector resalta el destino y al elegirlo inicia voz sin escribir', () => {
  const s = setup(), input = new s.Input('Hola mundo');
  input.style.outline = '1px solid red';
  const event = { target: input, preventDefault() {}, stopImmediatePropagation() {} };
  s.context.chooseVoiceDestination();
  assert.equal(s.starts(), 0);
  s.listeners.get('pointermove')(event);
  assert.equal(input.style.outline, '3px solid #2563eb');
  s.listeners.get('click')(event);
  assert.equal(input.style.outline, '1px solid red');
  assert.equal(s.listeners.size, 0);
  assert.equal(s.starts(), 1);
  assert.equal(input.value, 'Hola mundo');
  assert.equal(s.state.voiceTarget.kind, 'text');
});

test('Escape cancela la selección y restaura el borde sin iniciar voz', () => {
  const s = setup(), input = new s.Input('Hola mundo');
  input.style.outline = 'none';
  s.context.chooseVoiceDestination();
  s.listeners.get('pointermove')({ target: input });
  s.listeners.get('keydown')({ key: 'Escape', preventDefault() {}, stopImmediatePropagation() {} });
  assert.equal(input.style.outline, 'none');
  assert.equal(s.listeners.size, 0);
  assert.equal(s.starts(), 0);
});

test('seleccionar el fondo de un formulario limita la interpretación a ese formulario', () => {
  const s = setup(), element = new s.Input('');
  const form = { style: {}, querySelector: () => ({}), isConnected: true };
  element.closest = selector => selector.startsWith('form') ? form : null;
  s.context.chooseVoiceDestination();
  s.listeners.get('click')({ target: element, preventDefault() {}, stopImmediatePropagation() {} });
  assert.equal(s.state.voiceTarget.kind, 'form');
  assert.equal(s.state.scopeRoot, form);
  assert.equal(s.state.frameScope, 'top');
  assert.equal(s.starts(), 1);
});

test('hacer clic en un campo dentro de un formulario elige el formulario completo', () => {
  const s = setup(), input = new s.Input('');
  const form = { querySelector: () => input };
  input.closest = selector => selector.startsWith('form') ? form : input;
  assert.equal(s.context.voiceDestinationFor(input).element, form);
  assert.equal(s.context.voiceDestinationFor(input).kind, 'form');
});

test('el rectángulo incluye únicamente los campos visibles que se superponen al área', () => {
  const s = setup();
  const input = (left, visible = true) => {
    const element = new s.Input('');
    element.visible = visible;
    element.getBoundingClientRect = () => ({ left, right: left + 20, top: 10, bottom: 30, width: 20, height: 20 });
    return element;
  };
  const a = input(10), b = input(40), outside = input(150), hidden = input(15, false);
  s.context.document.querySelectorAll = () => [a, b, outside, hidden];
  s.context.isVisible = element => element.visible;
  const result = s.context.voiceDestinationInRect({ left: 0, top: 0, right: 100, bottom: 50 });
  assert.equal(result.kind, 'form');
  assert.deepEqual(Array.from(result.elements), [a, b]);
  const single = s.context.voiceDestinationInRect({ left: 0, top: 0, right: 35, bottom: 50 });
  assert.equal(single.kind, 'text');
  assert.equal(single.element, a);
});

test('el glow se anima al señalar y se cancela al salir de la selección', () => {
  const s = setup(), input = new s.Input(''); let animated = false, cancelled = false;
  input.animate = () => { animated = true; return { cancel() { cancelled = true; } }; };
  s.context.chooseVoiceDestination();
  s.listeners.get('pointermove')({ target: input });
  assert.equal(animated, true);
  s.state.cancelScopeSelection();
  assert.equal(cancelled, true);
  assert.equal(s.listeners.size, 0);
});

test('arrastrar delimita campos y no dispara el clic posterior del formulario', () => {
  const s = setup(), a = new s.Input(''), b = new s.Input('');
  a.getBoundingClientRect = () => ({ left: 10, top: 10, right: 25, bottom: 25, width: 15, height: 15 });
  b.getBoundingClientRect = () => ({ left: 40, top: 10, right: 55, bottom: 25, width: 15, height: 15 });
  s.context.document.querySelectorAll = () => [a, b];
  s.context.document.createElement = () => ({ style: {}, remove() {} });
  s.context.document.documentElement.appendChild = () => {};
  s.context.document.isConnected = true;
  s.context.isVisible = () => true;
  const deferred = []; s.context.window.setTimeout = fn => deferred.push(fn);
  s.context.chooseVoiceDestination();
  const event = (x, y) => ({ target: a, button: 0, clientX: x, clientY: y, preventDefault() {}, stopImmediatePropagation() {} });
  s.listeners.get('pointerdown')(event(0, 0));
  s.listeners.get('pointermove')(event(100, 50));
  s.listeners.get('pointerup')(event(100, 50));
  assert.deepEqual(Array.from(s.state.scopeElements), [a, b]);
  assert.equal(s.starts(), 1);
  let prevented = false;
  s.listeners.get('click')({ preventDefault() { prevented = true; }, stopImmediatePropagation() {} });
  assert.equal(prevented, true);
  deferred.forEach(fn => fn());
  assert.equal(s.listeners.size, 0);
});

test('el dictado conserva el texto fuera de la selección y usa el setter nativo', () => {
  const s = setup(), input = new s.Input('Hola mundo!');
  const target = s.context.captureDictationTarget(input);
  assert.equal(s.context.insertDictation(target, 'Juan').ok, true);
  assert.equal(input.value, 'Hola Juan!');
  assert.equal(input.selectionStart, 9);
  assert.equal(s.events(), 1);
});

test('si el destino cambió durante el dictado, no sobrescribe su texto', () => {
  const s = setup(), input = new s.Input('Hola mundo');
  const target = s.context.captureDictationTarget(input);
  input.value = 'Cambio externo';
  assert.equal(s.context.insertDictation(target, 'Juan').ok, false);
  assert.equal(input.value, 'Cambio externo');
  assert.equal(s.events(), 0);
});

test('agregar al final conserva el contenido y reemplazar todo elimina el texto anterior', () => {
  for (const [mode, expected] of [['append', 'Hola mundo!Nuevo'], ['replace', 'Nuevo']]) {
    const s = setup(), input = new s.Input('Hola mundo!');
    assert.equal(s.context.insertDictation(s.context.captureDictationTarget(input), 'Nuevo', mode).ok, true);
    assert.equal(input.value, expected);
    assert.equal(input.selectionStart, expected.length);
  }
});

test('reemplazar todo exige confirmación antes de escribir', async () => {
  const s = setup(), input = new s.Input('Original');
  s.state.voiceTarget = s.context.captureDictationTarget(input);
  Object.assign(s.state, { voicePreview: true, voiceActions: [{ include: true, value: 'Nuevo' }], dictationWriteMode: 'replace', dictationReplaceConfirmed: false });
  vm.runInContext(source.slice(source.indexOf('  async function applyVoiceActions('), source.indexOf('  function renderPanel(')), s.context);
  await s.context.applyVoiceActions();
  assert.equal(input.value, 'Original');
  assert.match(s.statuses.at(-1), /Confirmá el reemplazo/);
  s.state.dictationReplaceConfirmed = true;
  await s.context.applyVoiceActions();
  assert.equal(input.value, 'Nuevo');
});

test('dictar en un campo prepara una propuesta sin llamar a IA ni escribir todavía', async () => {
  const s = setup(), input = new s.Input('Hola mundo');
  s.state.voiceTarget = s.context.captureDictationTarget(input);
  s.state.voiceTranscript = 'Juan';
  await s.context.processVoice();
  assert.equal(s.state.voiceActions[0].value, 'Juan');
  assert.equal(input.value, 'Hola mundo');
  assert.equal(s.aiCalls(), 0);
});

function docsSetup() {
  const s = setup();
  Object.assign(s.context.location, { hostname: 'docs.google.com', pathname: '/document/d/test/edit', origin: 'https://docs.google.com', href: 'https://docs.google.com/document/d/test/edit?tab=t.0' });
  s.context.wait = async () => {};
  let pastes = 0;
  const editor = { isConnected: true, focus() {}, ownerDocument: { defaultView: {
    DataTransfer: class { setData(type, text) { this[type] = text; } },
    ClipboardEvent: class { constructor(type, data) { this.type = type; Object.assign(this, data); } },
    KeyboardEvent: class { constructor(type, data) { this.type = type; Object.assign(this, data); } }
  } }, dispatchEvent(event) { if (event.type !== 'paste') return; assert.equal(event.clipboardData['text/plain'], 'Nuevo texto'); pastes++; } };
  const target = { element: editor, googleDocs: true, url: s.context.location.href };
  return { ...s, editor, target, pastes: () => pastes };
}

test('la hoja de Google Docs se dirige al editor interno del iframe', () => {
  const s = docsSetup(), page = { style: {} }, element = new s.Input('');
  element.closest = selector => selector.startsWith('.kix-page') ? page : null;
  s.context.document.querySelector = () => ({ contentDocument: { querySelector: () => s.editor } });
  const destination = s.context.voiceDestinationFor(element);
  assert.equal(destination.googleDocs, true);
  assert.equal(destination.element, page);
  assert.equal(destination.editor, s.editor);
});

test('Google Docs solo confirma inserción si cambia el documento guardado', async () => {
  const s = docsSetup(); let reads = 0;
  s.context.readGoogleDocsText = async () => reads++ ? 'Anterior\nNuevo texto' : 'Anterior';
  assert.equal((await s.context.insertGoogleDocsDictation(s.target, 'Nuevo texto')).ok, true);
  assert.equal(s.pastes(), 1);
});

test('Google Docs no declara éxito ni duplica un dictado no comprobado', async () => {
  const s = docsSetup();
  s.context.readGoogleDocsText = async () => 'Anterior';
  assert.equal((await s.context.insertGoogleDocsDictation(s.target, 'Nuevo texto')).ok, false);
  assert.equal((await s.context.insertGoogleDocsDictation(s.target, 'Nuevo texto')).ok, false);
  assert.equal(s.pastes(), 1);
});

test('si no puede leer el documento, no envía el dictado', async () => {
  const s = docsSetup();
  s.context.readGoogleDocsText = async () => { throw new Error('Lectura no disponible'); };
  assert.equal((await s.context.insertGoogleDocsDictation(s.target, 'Nuevo texto')).ok, false);
  assert.equal(s.pastes(), 0);
});

test('Google Docs comprueba el resultado según agregar o reemplazar', async () => {
  for (const [mode, after] of [['append', 'AnteriorNuevo texto'], ['replace', 'Nuevo texto']]) {
    const s = docsSetup(); let reads = 0; const keys = [];
    const dispatch = s.editor.dispatchEvent;
    s.editor.dispatchEvent = event => { if (event.type === 'keydown') keys.push(event.key); dispatch(event); };
    s.context.readGoogleDocsText = async () => reads++ ? after : 'Anterior';
    assert.equal((await s.context.insertGoogleDocsDictation(s.target, 'Nuevo texto', mode)).ok, true);
    assert.deepEqual(keys, [mode === 'append' ? 'End' : 'a']);
    assert.equal(s.pastes(), 1);
  }
});
