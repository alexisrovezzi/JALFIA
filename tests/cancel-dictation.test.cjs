const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, '../src/content.js'), 'utf8');
test('cancelar descarta texto, destino y propuestas sin escribir al formulario', () => {
  let discard, rendered = false;
  const state = { textInputMode: true, voiceSubmit: true, voiceActions: [{}], voiceTranscript: 'Anterior', typedDictation: 'Anterior',
    voiceCorrectedText: 'Anterior.', voiceTarget: {}, dictationWriteMode: 'replace', dictationReplaceConfirmed: true,
    cancelScopeSelection() {}, stopVoice: value => { discard = value; } };
  const context = { state, showStatus() {}, renderPanel() { rendered = true; } };
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
  assert.equal(state.textInputMode, true);
});
