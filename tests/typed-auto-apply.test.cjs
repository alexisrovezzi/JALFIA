const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, '../src/content.js'), 'utf8');
function setup({ review = false, actions, failure } = {}) {
  const fields = ['name', 'notes', 'ambiguous', 'invalid'].map(id => ({ id, label: id, kind: 'text', frameId: 1, options: [], rules: {} }));
  const proposed = actions || [{ field_id: 'name', value: 'Ana', needs_confirmation: false }, { field_id: 'notes', value: 'Proyecto de prueba', needs_confirmation: false }];
  const writes = [], requests = [], views = [], messages = [];
  const state = { textInputMode: true, typedDictation: 'Nombre Ana. Notas Proyecto de prueba.', voiceTranscript: '', voiceActions: [], fields,
    voiceTarget: { kind: 'form', element: { isConnected: true } }, reviewBeforeApply: review, dictationWriteMode: 'cursor',
    draftValues: new Map(), editedFieldIds: new Set(), formClearFieldIds: new Set() };
  const context = { state, renderPanel() {}, showStatus: value => messages.push(value), refreshFrames: async () => {}, scanFields() {}, visibleFields: () => fields,
    validateFieldValue: field => field.id === 'invalid' ? ['Formato inválido'] : [],
    setFieldValue: async (id, value) => { writes.push({ id, value }); return { ok: id !== failure, verified: id !== failure }; },
    document: { querySelector: () => null }, CSS: { escape: value => value }, normalizeComparable: value => value, escapeHtml: value => value,
    sendExtensionMessage: async message => { requests.push(message); return { ok: true, corrected_text: 'Texto corregido.', actions: proposed }; },
    insertDictation: (target, text) => { writes.push({ id: 'text', value: text }); return { ok: true }; } };
  vm.createContext(context);
  for (const [start, end] of [['  function interpretTypedDictation(', '  function insertDictation('], ['  function renderVoice(', '  async function improveDictationText('], ['  async function processVoice(', '  function renderPanel(']]) vm.runInContext(source.slice(source.indexOf(start), source.indexOf(end)), context);
  context.renderPanel = () => { if (state.voiceAutoProcessing) views.push(context.renderVoice()); };
  return { state, context, writes, requests, views, messages, response: { ok: true, corrected_text: 'Texto corregido.', actions: proposed } };
}
test('modo escritura con revisión desactivada interpreta y aplica el formulario sin vista previa', async () => {
  const s = setup(); await s.context.interpretTypedDictation();
  assert.deepEqual(s.writes.map(write => write.id), ['name', 'notes']); assert.equal(s.requests.length, 1);
  assert.equal(s.state.typedDictation, ''); assert.equal(s.state.voiceActions.length, 0); assert.equal(s.state.voicePreview, false); assert.equal(s.state.voiceAutoProcessing, false);
  for (const html of s.views) { assert.match(html, /dictation-loader/); assert.doesNotMatch(html, /Vista previa|textarea|Confirmar y aplicar/); }
  await s.context.interpretTypedDictation(); assert.equal(s.requests.length, 1); assert.equal(s.writes.length, 2);
});
test('la misma entrada escrita mantiene revisión si está activada', async () => {
  const s = setup({ review: true }); await s.context.interpretTypedDictation();
  assert.equal(s.writes.length, 0); assert.equal(s.state.voiceActions.length, 2); assert.equal(s.state.voicePreview, true); assert.equal(s.views.length, 0);
});
test('no aplica cambios ambiguos, inválidos ni fallidos y conserva los pendientes', async () => {
  const s = setup({ failure: 'notes', actions: [
    { field_id: 'name', value: 'Ana', needs_confirmation: false },
    { field_id: 'notes', value: 'Proyecto de prueba', needs_confirmation: false },
    { field_id: 'ambiguous', value: 'Duda', needs_confirmation: true },
    { field_id: 'invalid', value: 'Inválido', needs_confirmation: false }
  ] });
  await s.context.interpretTypedDictation();
  assert.deepEqual(s.writes.map(write => write.id), ['name', 'notes']);
  assert.deepEqual(Array.from(s.state.voiceActions, action => action.field_id), ['notes', 'ambiguous', 'invalid']);
  assert.equal(s.state.voiceActions.find(action => action.field_id === 'ambiguous').include, false);
  assert.ok(s.state.voiceTranscript); assert.ok(s.state.typedDictation); assert.equal(s.state.voiceAutoProcessing, false); assert.match(s.messages.at(-1), /3 cambios pendientes/);
});
test('respuesta demorada mantiene loader y bloquea interpretaciones duplicadas', async () => {
  const s = setup(); let resolveAI, entered;
  const started = new Promise(resolve => { entered = resolve; }); let calls = 0;
  s.context.sendExtensionMessage = () => { calls++; entered(); return new Promise(resolve => { resolveAI = resolve; }); };
  const pending = s.context.interpretTypedDictation(); await started;
  assert.equal(s.state.voiceAutoProcessing, true); await s.context.interpretTypedDictation(); assert.equal(calls, 1);
  assert.match(s.context.renderVoice(), /Interpretando texto/); resolveAI(s.response); await pending;
  assert.equal(s.writes.length, 2); assert.equal(s.state.voiceAutoProcessing, false);
});
test('si desaparece el formulario durante la interpretación, no escribe y conserva las propuestas', async () => {
  const s = setup(); s.context.sendExtensionMessage = async () => { s.state.voiceTarget.element.isConnected = false; return s.response; };
  await s.context.interpretTypedDictation(); assert.equal(s.writes.length, 0); assert.equal(s.state.voiceActions.length, 2); assert.ok(s.state.typedDictation);
});
test('texto escrito a un destino único también aplica directamente, salvo reemplazo completo', async () => {
  for (const mode of ['cursor', 'replace']) {
    const s = setup(); s.state.voiceTarget.kind = 'text'; s.state.dictationWriteMode = mode;
    await s.context.interpretTypedDictation();
    assert.equal(s.writes.length, mode === 'cursor' ? 1 : 0); assert.equal(s.requests.length, 0);
    if (mode === 'replace') { assert.equal(s.state.voicePreview, true); assert.equal(s.state.voiceAutoProcessing, false); }
  }
});
test('errores de IA liberan el loader y conservan lo escrito sin aplicar', async () => {
  const s = setup(); s.context.sendExtensionMessage = async () => ({ ok: false, error: 'Sin conexión' });
  await s.context.interpretTypedDictation(); assert.equal(s.writes.length, 0); assert.equal(s.state.voiceAutoProcessing, false); assert.ok(s.state.typedDictation); assert.match(s.messages.at(-1), /Sin conexión/);
});
