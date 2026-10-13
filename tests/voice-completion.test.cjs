const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, '../src/content.js'), 'utf8');
function setup() {
  const action = id => ({ field_id: id, value: 'Nuevo', include: true, errors: [] });
  const state = { voicePreview: true, voiceActionIndex: 1, voiceTranscript: 'dictado', voiceCorrectedText: 'Dictado.',
    voiceActions: [action('ok'), action('failed')], voiceCompletedFieldIds: new Set(),
    fields: ['ok', 'failed'].map(id => ({ id, label: id, kind: 'text', frameId: 1, options: [], rules: {} })),
    draftValues: new Map(), editedFieldIds: new Set(), formClearFieldIds: new Set() };
  const writes = [];
  const context = { state, scanFields() {}, refreshFrames: async () => {}, visibleFields: () => state.fields,
    renderPanel() {}, showStatus() {}, document: { querySelector: () => null }, CSS: { escape: value => value },
    validateFieldValue: () => [], normalizeComparable: value => value,
    setFieldValue: async id => { writes.push(id); return { ok: id === 'ok', verified: id === 'ok' }; },
    sendExtensionMessage: async () => ({ ok: true, corrected_text: 'Dictado.', actions: [action('ok'), action('failed')] }) };
  vm.createContext(context);
  vm.runInContext(source.slice(source.indexOf('  async function processVoice('), source.indexOf('  function renderPanel(')), context);
  return { state, context, writes };
}
test('retira cambios comprobados y permite volver a ofrecerlos en otra interpretación', async () => {
  const s = setup();
  await s.context.applyVoiceActions();
  assert.deepEqual(Array.from(s.state.voiceActions, action => action.field_id), ['failed']);
  s.state.voicePreview = true;
  await s.context.applyVoiceActions();
  assert.deepEqual(s.writes, ['ok', 'failed', 'failed']);
  await s.context.processVoice();
  assert.deepEqual(Array.from(s.state.voiceActions, action => action.field_id), ['ok', 'failed']);
});
test('cuando termina todos los cambios limpia el dictado para que no pueda reutilizarse', async () => {
  const s = setup(); s.state.voiceActions = s.state.voiceActions.slice(0, 1);
  await s.context.applyVoiceActions();
  assert.equal(s.state.voiceActions.length, 0);
  assert.equal(s.state.voiceTranscript, '');
  assert.equal(s.state.voiceCorrectedText, '');
  s.state.voicePreview = true;
  await s.context.applyVoiceActions();
  assert.deepEqual(s.writes, ['ok']);
});

test('un error de interpretación conserva el dictado editable y permite reintentar', async () => {
  const s = setup(); const statuses = [];
  s.context.showStatus = message => statuses.push(message);
  s.context.sendExtensionMessage = async () => ({ ok: false, error: 'Cita inválida para Neurológico.' });
  await s.context.processVoice();
  assert.equal(s.state.voiceTranscript, 'dictado');
  assert.equal(s.state.typedDictation, 'dictado');
  assert.equal(s.state.textInputMode, true);
  assert.equal(s.state.voiceActions.length, 0);
  assert.equal(s.state.voiceBusy, false);
  assert.match(statuses[0], /Interpretando/);
  assert.match(statuses.at(-1), /texto se conserva/);
  s.context.sendExtensionMessage = async () => ({ ok: true, corrected_text: 'Dictado.', actions: [{ field_id: 'ok', value: 'Nuevo', evidence: 'dictado', needs_confirmation: false }] });
  await s.context.processVoice();
  assert.equal(s.state.voiceActions.length, 1);
  assert.equal(s.state.voiceActions[0].field_id, 'ok');
});
