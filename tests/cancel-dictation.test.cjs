const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, '../src/content.js'), 'utf8');
for (const textInputMode of [true, false]) test(`cancelar en modo ${textInputMode ? 'escritura' : 'dictado'} descarta pendientes y muestra el mensaje correspondiente`, () => {
  let discard, status, rendered = false;
  const state = { textInputMode, voiceSubmit: true, voiceActions: [{}], voiceTranscript: 'Anterior', typedDictation: 'Anterior',
    voiceCorrectedText: 'Anterior.', voiceTarget: {}, dictationWriteMode: 'replace', dictationReplaceConfirmed: true,
    cancelScopeSelection() {}, stopVoice: value => { discard = value; } };
  const context = { state, showStatus(message) { status = message; }, renderPanel() { rendered = true; } };
  vm.createContext(context);
  vm.runInContext(source.slice(source.indexOf('  function cancelDictation('), source.indexOf('  function interpretTypedDictation(')), context);
  context.cancelDictation();
  assert.equal(discard, true);
  assert.equal(rendered, true);
  assert.equal(state.voiceActions.length, 0);
  assert.equal(state.typedDictation, '');
  assert.equal(state.voiceTranscript, '');
  assert.equal(state.voiceTarget, null);
  assert.equal(state.voiceSubmit, false);
  assert.equal(state.textInputMode, textInputMode);
  assert.equal(status, textInputMode ? 'Texto descartado. Podés escribir o pegar uno nuevo.' : 'Dictado cancelado. Podés empezar uno nuevo.');
});

for (const textInputMode of [true, false]) test(`procesamiento ocupado conserva pendientes en modo ${textInputMode ? 'escritura' : 'dictado'}`, () => {
  let status;
  const state = { textInputMode, voiceBusy: true, voiceSubmit: true, typedDictation: 'Información\npegada', voiceTranscript: 'Dictado', voiceActions: [{ value: 'Pendiente' }], voiceTarget: { kind: 'text' } };
  const before = structuredClone(state);
  const context = { state, showStatus(message) { status = message; },
    renderPanel() { assert.fail('No debe renderizar ni limpiar durante el procesamiento'); } };
  vm.createContext(context);
  vm.runInContext(source.slice(source.indexOf('  function cancelDictation('), source.indexOf('  function interpretTypedDictation(')), context);
  context.cancelDictation();
  assert.deepEqual(state, before);
  assert.equal(status, 'Esperá a que termine la operación antes de descartar lo pendiente.');
});
