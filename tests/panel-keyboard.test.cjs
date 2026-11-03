const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const source = fs.readFileSync(require('node:path').join(__dirname, '../src/content.js'), 'utf8');

function setup() {
  const handlers = {}, bubbles = {}, inputs = [];
  const field = { tagName: 'TEXTAREA', value: 'hola mundo', selectionStart: 4, selectionEnd: 5,
    isConnected: true, disabled: false, readOnly: false,
    setRangeText(text, start, end) { this.value = this.value.slice(0, start) + text + this.value.slice(end); this.selectionStart = this.selectionEnd = start + text.length; },
    dispatchEvent(event) { inputs.push(event); } };
  const shadow = { contains: target => target === field, activeElement: field,
    addEventListener: (type, fn) => bubbles[type] = fn };
  const context = { window: { addEventListener: (type, fn) => handlers[type] = fn },
    document: { execCommand: () => false }, InputEvent: class { constructor(type, options) { Object.assign(this, { type }, options); } } };
  vm.createContext(context);
  vm.runInContext(source.slice(source.indexOf('  function protectPanelKeyboard('), source.indexOf('  function createPanel(')), context);
  context.protectPanelKeyboard(shadow);
  function event(overrides = {}) { return { key: ' ', isTrusted: true, defaultPrevented: true,
    composedPath: () => [field], stopImmediatePropagation() { this.stopped = true; }, ...overrides }; }
  return { handlers, bubbles, field, shadow, context, inputs, event };
}

test('permite el espacio nativo y bloquea el atajo de la página', () => {
  const s = setup(), e = s.event({ defaultPrevented: false });
  s.handlers.keydown(e);
  assert.equal(e.stopped, true);
  assert.equal(s.field.value, 'hola mundo');
  assert.equal(s.inputs.length, 0);
});

test('recupera el espacio cancelado reemplazando la selección y notificando la edición', () => {
  const s = setup(); s.field.selectionEnd = 10;
  s.handlers.keydown(s.event());
  assert.equal(s.field.value, 'hola ');
  assert.equal(s.field.selectionStart, 5);
  assert.equal(s.inputs.length, 1);
  assert.equal(s.inputs[0].inputType, 'insertText');
  s.handlers.keyup(s.event());
  assert.equal(s.inputs.length, 1);
});

test('prioriza la edición nativa sin duplicar el espacio', () => {
  const s = setup();
  s.context.document.execCommand = () => { s.field.setRangeText(' ', 4, 5); return true; };
  s.handlers.keydown(s.event());
  assert.equal(s.field.value, 'hola mundo');
  assert.equal(s.inputs.length, 0);
});

test('no modifica teclas de composición, atajos ni eventos sintéticos', () => {
  for (const overrides of [{ isComposing: true }, { keyCode: 229 }, { ctrlKey: true }, { metaKey: true }, { altKey: true }, { key: 'Enter' }, { isTrusted: false }]) {
    const s = setup(); s.handlers.keydown(s.event(overrides));
    assert.equal(s.inputs.length, 0);
  }
});

test('no escribe en controles ajenos, bloqueados, desconectados o sin foco', () => {
  for (const change of [s => s.shadow.contains = () => false, s => s.field.disabled = true,
    s => s.field.readOnly = true, s => s.field.isConnected = false, s => s.shadow.activeElement = null]) {
    const s = setup(); change(s); s.handlers.keydown(s.event());
    assert.equal(s.inputs.length, 0);
  }
});

test('aísla las otras teclas sin cancelar su comportamiento nativo', () => {
  const s = setup();
  for (const type of ['keydown', 'keypress', 'keyup']) {
    let stopped = false;
    s.bubbles[type]({ stopPropagation() { stopped = true; }, preventDefault() { assert.fail('no debe cancelar la edición'); } });
    assert.equal(stopped, true);
  }
});
