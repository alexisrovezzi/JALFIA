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
    state, FIELD_SELECTOR: 'input', Element: Input, HTMLInputElement: Input, HTMLTextAreaElement: Input,
    document: { body: {}, documentElement: {} }, window: {
      addEventListener: (name, handler) => listeners.set(name, handler),
      removeEventListener: name => listeners.delete(name)
    },
    inferLabel: () => 'Detalle', isInsidePanel: () => false, renderPanel() {},
    showStatus: message => statuses.push(message), startVoiceRecognition: () => { starts++; },
    dispatchInputEvents: () => { events++; },
    chrome: { runtime: { sendMessage: async () => { aiCalls++; } } }
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

test('dictar en un campo prepara una propuesta sin llamar a IA ni escribir todavía', async () => {
  const s = setup(), input = new s.Input('Hola mundo');
  s.state.voiceTarget = s.context.captureDictationTarget(input);
  s.state.voiceTranscript = 'Juan';
  await s.context.processVoice();
  assert.equal(s.state.voiceActions[0].value, 'Juan');
  assert.equal(input.value, 'Hola mundo');
  assert.equal(s.aiCalls(), 0);
});
