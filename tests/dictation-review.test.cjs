const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, '../src/content.js'), 'utf8');
function setup() {
  let writes = 0, aiCalls = 0;
  const messages = [], timers = new Map(); let timerId = 0;
  class Input {
    constructor(value) { this._value = value; this.tagName = 'INPUT'; this.isConnected = true; }
    get value() { return this._value; }
    set value(value) { writes++; this._value = value; }
    closest() { return null; } focus() {} setSelectionRange() {}
  }
  class Recognition { start() {} stop() { this.onend(); } abort() {} }
  const input = new Input('Hola mundo');
  const state = { shadow: { querySelector: () => null }, reviewBeforeApply: true, voicePreview: false,
    voiceTranscript: 'Juan', voiceActions: [], voiceTarget: { kind: 'text', label: 'Nombre', element: input, original: input.value, start: 5, end: 10 },
    fields: [{ id: 'name', label: 'Nombre', kind: 'text', options: [], rules: {} }], dictationWriteMode: 'cursor',
    draftValues: new Map(), editedFieldIds: new Set(), formClearFieldIds: new Set() };
  const context = { state, HTMLInputElement: Input, HTMLTextAreaElement: Input, renderPanel() {},
    showStatus: message => messages.push(message), dispatchInputEvents() {},
    window: { SpeechRecognition: Recognition, setTimeout: fn => { timers.set(++timerId, fn); return timerId; }, clearTimeout: id => timers.delete(id) },
    updateVoiceButtons() {}, normalizeText: value => value.trim(), focusPanelField() {},
    refreshFrames: async () => {}, scanFields() {}, visibleFields: () => state.fields,
    validateFieldValue: () => [], sendExtensionMessage: async () => { aiCalls++; return { ok: true, corrected_text: 'Juan', actions: [{ field_id: 'name', value: 'Juan', include: true, errors: [], needs_confirmation: false }] }; },
    setFieldValue: async () => { writes++; return { ok: true, verified: true }; }, document: { querySelector: () => null },
    CSS: { escape: text => text }, normalizeComparable: value => value };
  vm.createContext(context);
  for (const [start, end] of [['  function startVoiceRecognition(', '  function fieldTypeLabel('], ['  function insertDictation(', '  async function readGoogleDocsText('], ['  async function processVoice(', '  function renderPanel(']]) vm.runInContext(source.slice(source.indexOf(start), source.indexOf(end)), context);
  return { context, state, input, messages, writes: () => writes, aiCalls: () => aiCalls, timers };
}
test('revisión abre directamente la propuesta editable y permite aplicar una edición', async () => {
  const s = setup(); await s.context.processVoice({ fromVoiceStop: true, reviewBeforeApply: true });
  assert.equal(s.state.voicePreview, true); assert.equal(s.input.value, 'Hola mundo'); assert.equal(s.writes(), 0);
  s.state.voiceActions[0].value = 'María'; await s.context.applyVoiceActions();
  assert.equal(s.input.value, 'Hola María'); assert.equal(s.state.voiceTranscript, ''); assert.equal(s.aiCalls(), 0);
});
test('modo directo inserta una vez conservando lo que queda fuera de la selección', async () => {
  const s = setup(); await s.context.processVoice({ fromVoiceStop: true, reviewBeforeApply: false });
  assert.equal(s.input.value, 'Hola Juan'); assert.equal(s.writes(), 1); assert.equal(s.state.voiceActions.length, 0);
  await s.context.processVoice({ fromVoiceStop: true, reviewBeforeApply: false }); assert.equal(s.writes(), 1);
});
test('la preferencia se fija al iniciar el dictado, incluso si cambia antes de detener', async () => {
  for (const review of [true, false]) {
    const s = setup(); s.state.reviewBeforeApply = review; s.context.startVoiceRecognition();
    s.state.reviewBeforeApply = !review;
    s.state.recognition.onresult({ results: [Object.assign([{ transcript: 'Juan' }], { isFinal: true })] });
    s.state.voiceSubmit = true; s.context.startVoiceRecognition(); await Promise.resolve();
    assert.equal(s.writes(), review ? 0 : 1); assert.equal(s.state.voicePreview, review);
  }
});
test('sin preferencia guardada se inserta al detener; una elección explícita de revisión se respeta', async () => {
  for (const preference of [undefined, null, false, true]) {
    const s = setup(); s.state.reviewBeforeApply = preference;
    s.context.startVoiceRecognition();
    s.state.recognition.onresult({ results: [Object.assign([{ transcript: 'Juan' }], { isFinal: true })] });
    s.state.voiceSubmit = true; s.context.startVoiceRecognition(); await Promise.resolve();
    assert.equal(s.writes(), preference === true ? 0 : 1);
  }
});
test('escritura y acciones manuales nunca heredan la aplicación directa', async () => {
  for (const textInputMode of [true, false]) {
    const s = setup(); s.state.textInputMode = textInputMode; s.state.reviewBeforeApply = false;
    await s.context.processVoice(); assert.equal(s.writes(), 0); assert.equal(s.state.voiceActions[0].value, 'Juan');
  }
});
test('reemplazar todo y formularios mantienen la confirmación aunque la preferencia sea directa', async () => {
  const s = setup(); s.state.dictationWriteMode = 'replace';
  await s.context.processVoice({ fromVoiceStop: true, reviewBeforeApply: false }); assert.equal(s.writes(), 0); assert.equal(s.state.voicePreview, true);
  await s.context.applyVoiceActions(); assert.equal(s.writes(), 0);
  s.state.dictationReplaceConfirmed = true; await s.context.applyVoiceActions(); assert.equal(s.input.value, 'Juan');
  const form = setup(); form.state.voiceTarget = { kind: 'form', element: { isConnected: true } };
  await form.context.processVoice({ fromVoiceStop: true, reviewBeforeApply: false });
  assert.equal(form.writes(), 0); assert.equal(form.aiCalls(), 1); assert.equal(form.state.voicePreview, true);
});
test('formulario ambiguo mantiene la selección explícita antes de confirmar', async () => {
  const s = setup(); s.state.voiceTarget = { kind: 'form', element: { isConnected: true } };
  s.context.sendExtensionMessage = async () => ({ ok: true, corrected_text: 'Juan', actions: [{ field_id: 'name', value: 'Juan', needs_confirmation: true }] });
  await s.context.processVoice({ fromVoiceStop: true, reviewBeforeApply: false });
  assert.equal(s.state.voicePreview, false); assert.equal(s.state.voiceActions[0].include, false); assert.equal(s.writes(), 0);
});
test('destino eliminado o cambiado conserva texto y propuestas sin repetir el envío', async () => {
  for (const removed of [true, false]) {
    const s = setup(); if (removed) s.input.isConnected = false; else s.input._value = 'Cambio externo';
    await s.context.processVoice({ fromVoiceStop: true, reviewBeforeApply: false });
    assert.equal(s.state.voiceTranscript, 'Juan'); assert.equal(s.state.voicePreview, true); assert.equal(s.state.voiceActions[0].value, 'Juan'); assert.equal(s.writes(), 0);
    await s.context.processVoice({ fromVoiceStop: true, reviewBeforeApply: false }); assert.equal(s.writes(), 0);
  }
});
test('inserción incierta conserva el texto y bloquea otro intento sobre el mismo destino', async () => {
  const s = setup(); s.context.dispatchInputEvents = () => { s.input._value += ' externo'; };
  await s.context.processVoice({ fromVoiceStop: true, reviewBeforeApply: false });
  assert.equal(s.state.voiceTarget.insertionUncertain, true); assert.equal(s.state.voiceTranscript, 'Juan'); assert.equal(s.writes(), 1);
  await s.context.applyVoiceActions(); assert.equal(s.writes(), 1);
});
test('Google Docs mantiene su comprobación y no vuelve a pegar un resultado incierto', async () => {
  const s = setup(); s.state.voiceTarget.googleDocs = true;
  let sends = 0; s.context.insertGoogleDocsDictation = async target => { if (!target.sent) { target.sent = true; sends++; } return { ok: false, reason: 'No pude comprobar la inserción.' }; };
  await s.context.processVoice({ fromVoiceStop: true, reviewBeforeApply: false });
  await s.context.processVoice({ fromVoiceStop: true, reviewBeforeApply: false });
  await s.context.applyVoiceActions(); assert.equal(sends, 1); assert.equal(s.state.voiceTranscript, 'Juan');
});
test('cancelar y un error de reconocimiento no disparan aplicación automática', async () => {
  for (const fail of [true, false]) {
    const s = setup(); s.state.reviewBeforeApply = false; s.context.startVoiceRecognition();
    s.state.recognition.onresult({ results: [Object.assign([{ transcript: 'Juan' }], { isFinal: true })] });
    if (fail) s.state.recognition.onerror({ error: 'not-allowed' }); else { s.state.voiceSubmit = false; s.state.stopVoice(true); }
    await Promise.resolve(); assert.equal(s.writes(), 0);
  }
});
test('preferencia se guarda normalizada y el valor por defecto es desactivado', async () => {
  let listener, saved;
  const context = { importScripts() {}, chrome: { runtime: { id: 'test', getURL: name => name, onMessage: { addListener: fn => { listener = fn; } } }, action: { onClicked: { addListener() {} } }, storage: { local: { setAccessLevel: async () => {}, set: async data => { saved = data; } } } } };
  vm.createContext(context); vm.runInContext(fs.readFileSync(path.join(__dirname, '../src/background.js'), 'utf8'), context);
  for (const preference of [undefined, true, false]) {
    await new Promise(resolve => listener({ type: 'JALFIA_SAVE_UI_SETTINGS', settings: { opacity: .8, darkMode: true, reviewBeforeApply: preference } }, { id: 'test' }, resolve));
    assert.equal(saved.jalfiaSettings.reviewBeforeApply, preference === true); assert.equal(saved.jalfiaSettings.darkMode, true); assert.equal(saved.jalfiaSettings.opacity, .8);
  }
});
