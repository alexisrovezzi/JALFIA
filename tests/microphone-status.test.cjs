const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, '../src/content.js'), 'utf8');
function setup({ prefixed = false, unsupported = false, startThrows = false } = {}) {
  const timers = new Map(), listeners = new Set(), messages = [];
  let counter = 0, captures = 0, processed = 0;
  const statusElement = { textContent: '' }, errorElement = { textContent: '', hidden: true }, noticeElement = { textContent: '', hidden: true }, noticesElement = { hidden: true };
  const elements = { '[data-microphone-status]': statusElement, '[data-microphone-error]': errorElement, '[data-microphone-notice]': noticeElement, '[data-microphone-notices]': noticesElement };
  class Recognition { start() { if (startThrows) throw new Error('not allowed'); } stop() {} abort() {} }
  const devices = { addEventListener: (name, fn) => { assert.equal(name, 'devicechange'); listeners.add(fn); }, removeEventListener: (_, fn) => listeners.delete(fn),
    enumerateDevices() { captures++; throw new Error('No debe enumerar ni asumir el predeterminado'); }, getUserMedia() { captures++; throw new Error('No debe abrir audio'); } };
  const state = { shadow: { querySelector: selector => elements[selector] || null }, microphoneStatus: 'Dictado detenido', microphoneError: '', microphoneNotice: '', voiceSubmit: false };
  const window = { navigator: { mediaDevices: devices }, setTimeout: fn => { timers.set(++counter, fn); return counter; }, clearTimeout: id => timers.delete(id) };
  if (!unsupported) window[prefixed ? 'webkitSpeechRecognition' : 'SpeechRecognition'] = Recognition;
  const context = { state, window, updateVoiceButtons() {}, renderPanel() {}, showStatus: text => messages.push(text), processVoice: () => { processed++; }, normalizeText: text => text.trim(), focusPanelField() {}, escapeHtml: text => String(text || '').replaceAll('<', '&lt;') };
  vm.createContext(context); vm.runInContext(source.slice(source.indexOf('  function startVoiceRecognition('), source.indexOf('  function fieldTypeLabel(')), context);
  return { context, state, messages, timers, listeners, statusElement, errorElement, noticeElement, noticesElement, captures: () => captures, processed: () => processed };
}
for (const prefixed of [true, false]) test(`inicia sin afirmar escucha antes de onstart (${prefixed ? 'webkit' : 'estándar'})`, () => {
  const s = setup({ prefixed }); s.context.startVoiceRecognition();
  assert.equal(s.state.microphoneStatus, 'Iniciando micrófono'); assert.equal(s.statusElement.textContent, 'Iniciando micrófono');
  assert.doesNotMatch(s.messages.at(-1), /^Escuchando/);
  s.state.recognition.onstart(); assert.equal(s.state.microphoneStatus, 'Escuchando'); assert.equal(s.captures(), 0);
});
test('informa estado sin enumerar dispositivos ni pedir permisos adicionales', () => {
  const s = setup(); s.context.startVoiceRecognition(); s.state.recognition.onstart();
  assert.equal(s.state.microphoneStatus, 'Escuchando'); assert.equal(s.captures(), 0);
});
test('reconexión conserva el texto y solo vuelve a escuchar tras confirmación', () => {
  const s = setup(); s.context.startVoiceRecognition(); const recognition = s.state.recognition;
  recognition.onstart(); recognition.onresult({ results: [Object.assign([{ transcript: 'Texto conservado' }], { isFinal: true })] });
  recognition.onerror({ error: 'network' }); assert.equal(s.state.microphoneStatus, 'Reconectando'); recognition.onend();
  const [id, restart] = [...s.timers.entries()][0]; s.timers.delete(id); restart();
  assert.equal(s.state.microphoneStatus, 'Reconectando'); assert.equal(s.state.voiceTranscript, 'Texto conservado');
  recognition.onstart(); assert.equal(s.state.microphoneStatus, 'Escuchando');
});
test('fin de captura de audio deja de indicar escucha hasta la siguiente confirmación', () => {
  const s = setup(); s.context.startVoiceRecognition(); const recognition = s.state.recognition;
  recognition.onstart(); recognition.onaudioend(); assert.equal(s.state.microphoneStatus, 'Reconectando');
  recognition.onend(); const [id, restart] = [...s.timers.entries()][0]; s.timers.delete(id); restart();
  assert.equal(s.state.microphoneStatus, 'Reconectando'); recognition.onstart(); assert.equal(s.state.microphoneStatus, 'Escuchando');
});
for (const [error, expected] of [['not-allowed', /permiso|permisos/], ['service-not-allowed', /servicio/], ['audio-capture', /conectado/]]) test(`error ${error} guía al usuario sin indicar escucha`, () => {
  const s = setup(); s.context.startVoiceRecognition(); const recognition = s.state.recognition;
  recognition.onstart(); recognition.onerror({ error });
  assert.equal(s.state.microphoneStatus, 'Dictado detenido'); assert.match(s.state.microphoneError, expected); assert.equal(s.errorElement.hidden, false);
  recognition.onend(); assert.equal(s.state.microphoneStatus, 'Dictado detenido'); assert.equal(s.listeners.size, 0);
});
test('cancelar elimina listeners e ignora callbacks tardíos de la captura anterior', () => {
  const s = setup(); s.context.startVoiceRecognition(); const recognition = s.state.recognition;
  const lateStart = recognition.onstart, lateResult = recognition.onresult, lateEnd = recognition.onend;
  s.state.stopVoice(true); assert.equal(s.state.microphoneStatus, 'Dictado detenido'); assert.equal(s.listeners.size, 0); assert.equal(recognition.onstart, null);
  lateStart(); lateResult({ results: [] }); lateEnd(); assert.equal(s.state.microphoneStatus, 'Dictado detenido'); assert.equal(s.processed(), 0);
});
test('detener conserva los resultados finales pero no reactiva el indicador de escucha', () => {
  const s = setup(); s.context.startVoiceRecognition(); const recognition = s.state.recognition;
  recognition.onstart(); s.state.voiceSubmit = true; s.state.stopVoice();
  assert.equal(s.state.microphoneStatus, 'Deteniendo dictado'); recognition.onresult({ results: [Object.assign([{ transcript: 'Últimas palabras' }], { isFinal: true })] });
  assert.equal(s.state.microphoneStatus, 'Deteniendo dictado'); recognition.onend(); assert.equal(s.state.microphoneStatus, 'Dictado detenido'); assert.equal(s.state.voiceTranscript, 'Últimas palabras'); assert.equal(s.processed(), 1);
});
test('cambio de dispositivos avisa sin perder texto, confirmar nombres ni reiniciar solo', () => {
  const s = setup(); s.context.startVoiceRecognition(); s.state.voiceTranscript = 'Pendiente';
  assert.equal(s.listeners.size, 1); [...s.listeners][0](); assert.match(s.state.microphoneNotice, /Cambió la lista/); assert.equal(s.noticeElement.hidden, false); assert.equal(s.noticesElement.hidden, false);
  assert.equal(s.state.voiceTranscript, 'Pendiente'); assert.equal(s.processed(), 0); assert.equal(s.captures(), 0);
  s.state.stopVoice(true); assert.equal(s.listeners.size, 0);
  s.context.startVoiceRecognition(); assert.equal(s.listeners.size, 1); assert.equal(s.state.microphoneNotice, ''); assert.equal(s.noticesElement.hidden, true);
});
test('escucha normal no duplica el mensaje central y los errores siguen visibles', () => {
  const status = { hidden: false, querySelector: () => ({ textContent: '' }) };
  const state = { voiceMode: true, listening: true, shadow: { querySelector: () => status } };
  const context = { state, schedulePanelSize() {} };
  vm.createContext(context); vm.runInContext(source.slice(source.indexOf('  function showStatus('), source.indexOf('  function updateDraftValues(')), context);
  context.showStatus('Escuchando... Pulsa detener para terminar.'); assert.equal(status.hidden, true);
  context.showStatus('No pude capturar audio.'); assert.equal(status.hidden, false);
  state.listening = false; context.showStatus('Dictado insertado.'); assert.equal(status.hidden, false);
});
test('error al iniciar, API ausente y agotamiento de reintentos quedan detenidos', () => {
  for (const options of [{ unsupported: true }, { startThrows: true }]) {
    const s = setup(options); s.context.startVoiceRecognition(); assert.equal(s.state.microphoneStatus, 'Dictado detenido'); assert.ok(s.state.microphoneError); assert.equal(s.listeners.size, 0);
  }
  const s = setup(); s.context.startVoiceRecognition(); s.state.recognition.onstart();
  s.state.recognition.onerror({ error: 'network' });
  const timeout = [...s.timers.values()][0]; timeout();
  assert.equal(s.state.microphoneStatus, 'Dictado detenido'); assert.equal(s.state.listening, false); assert.equal(s.listeners.size, 0); assert.match(s.state.microphoneError, /conexión/);
});
test('la altura contempla información de audio solo cuando está visible', () => {
  const content = { style: {}, getBoundingClientRect: () => ({ height: 200 }) };
  const state = { fields: [], voiceMode: true, size: {}, panel: { style: {} }, shadow: { querySelector: selector => selector.includes('.carousel') ? content : { getBoundingClientRect: () => ({ height: selector === '.microphone-info' ? 80 : 60 }) } } };
  const context = { state, window: { innerHeight: 900 }, visibleFields: () => [], keepPanelInViewport() {} };
  vm.createContext(context); vm.runInContext(source.slice(source.indexOf('  function panelMinimumHeight('), source.indexOf('  function applyExpandedHostSize(')), context);
  context.recalculatePanelSize(); assert.equal(state.panel.style.height, '462px');
  state.textInputMode = true; context.recalculatePanelSize(); assert.equal(state.panel.style.height, '382px');
});
