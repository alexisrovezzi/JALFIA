const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, '../src/content.js'), 'utf8');
function setup(stopThrows = false) {
  const timers = new Map(); let sequence = 0, processed = 0, aborts = 0;
  class Recognition {
    start() {} stop() { if (stopThrows) throw new Error('Already stopped'); }
    abort() { aborts++; }
  }
  const state = { shadow: { querySelector: () => null }, voiceSubmit: false, voiceCompletedFieldIds: new Set() };
  const context = { state, window: { SpeechRecognition: Recognition,
    setTimeout: fn => { const id = ++sequence; timers.set(id, fn); return id; }, clearTimeout: id => timers.delete(id) },
    updateVoiceButtons() {}, renderPanel() {}, showStatus() {}, processVoice: () => { processed++; },
    normalizeText: text => text.trim(), focusPanelField() {}
  };
  vm.createContext(context);
  vm.runInContext(source.slice(source.indexOf('  function startVoiceRecognition('), source.indexOf('  function fieldTypeLabel(')), context);
  return { state, context, timers, processed: () => processed, aborts: () => aborts };
}

test('detener finaliza aunque el navegador nunca emita onend y procesa una sola vez', () => {
  const s = setup(); s.context.startVoiceRecognition();
  const recognition = s.state.recognition, lateEnd = recognition.onend;
  recognition.onresult({ results: [Object.assign([{ transcript: 'texto dictado' }], { isFinal: true })] });
  s.state.voiceSubmit = true;
  s.context.startVoiceRecognition();
  assert.equal(s.state.listening, true);
  [...s.timers.values()][0]();
  assert.equal(s.state.listening, false);
  assert.equal(s.state.voiceTranscript, 'texto dictado');
  assert.equal(s.state.stopVoice, null);
  assert.equal(s.processed(), 1);
  lateEnd();
  assert.equal(s.processed(), 1);
});

test('onend normal cancela el cierre de respaldo y un stop que falla libera la escucha', () => {
  for (const throws of [false, true]) {
    const s = setup(throws); s.context.startVoiceRecognition();
    const recognition = s.state.recognition;
    s.state.voiceSubmit = true;
    s.context.startVoiceRecognition();
    if (!throws) recognition.onend();
    assert.equal(s.state.listening, false);
    assert.equal(s.timers.size, 0);
    assert.equal(s.processed(), 1);
  }
});

test('detener tiene prioridad sobre el bloqueo de análisis', () => {
  const s = setup(); s.context.startVoiceRecognition();
  s.state.analyzingOptions = true;
  s.context.startVoiceRecognition();
  assert.equal(s.timers.size, 1);
});

test('network reintenta tres veces sin borrar lo transcrito y después libera la escucha', () => {
  const s = setup(); s.context.startVoiceRecognition();
  const recognition = s.state.recognition;
  recognition.onresult({ results: [Object.assign([{ transcript: 'primera parte' }], { isFinal: true })] });
  for (let attempt = 0; attempt < 3; attempt++) {
    recognition.onerror({ error: 'network' });
    recognition.onend();
    const [id, retry] = [...s.timers.entries()][0]; s.timers.delete(id); retry();
    assert.equal(s.state.listening, true);
    assert.equal(s.state.voiceTranscript, 'primera parte');
  }
  recognition.onerror({ error: 'network' }); recognition.onend();
  assert.equal(s.state.listening, false);
  assert.equal(s.state.voiceTranscript, 'primera parte');
  assert.equal(s.timers.size, 0);
});

test('detener durante un reintento cancela la recuperación y permite procesar el texto', () => {
  const s = setup(); s.context.startVoiceRecognition();
  s.state.recognition.onerror({ error: 'network' }); s.state.recognition.onend();
  s.state.voiceSubmit = true; s.state.stopVoice();
  assert.equal(s.state.listening, false);
  assert.equal(s.timers.size, 0);
  assert.equal(s.processed(), 1);
});
