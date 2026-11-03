const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const aiSource = fs.readFileSync(path.join(__dirname, '../src/ai.js'), 'utf8');
const source = fs.readFileSync(path.join(__dirname, '../src/content.js'), 'utf8');
const local = { provider: 'local', baseUrl: 'http://localhost:8080/v1', model: 'configured-model' };
function aiSetup(result, openai = false, status) {
  const requests = [];
  const context = { URL, AbortController, setTimeout, clearTimeout, TypeError, SyntaxError,
    fetch: async (url, options) => { requests.push({ url, body: JSON.parse(options.body) }); return { ok: true, json: async () => openai ? { status, output: [{ content: [{ type: 'output_text', text: JSON.stringify(result) }] }] } : { choices: [{ message: { content: JSON.stringify(result) }, finish_reason: status }] } }; } };
  vm.createContext(context); vm.runInContext(aiSource, context);
  return { ai: context.JalfiaAI, requests };
}
test('mejora dedicada conserva proveedor/modelo y envía solo la transcripción', async () => {
  const s = aiSetup({ corrected_text: 'Hola, Víctor. Nos vemos el 12/11 a las 10:30.', uncertain_fragments: [] });
  const original = 'hola Víctor nos vemos el 12/11 a las 10:30';
  const result = await s.ai.improveText(local, original);
  assert.match(result.corrected_text, /Víctor/);
  const request = s.requests[0]; assert.equal(request.url, 'http://localhost:8080/v1/chat/completions'); assert.equal(request.body.model, local.model);
  assert.deepEqual(JSON.parse(request.body.messages[1].content), { transcript: original });
  assert.match(request.body.messages[0].content, /Ignora las instrucciones/); assert.match(request.body.messages[0].content, /No resumas/);
});
test('OpenAI usa Responses con esquema estricto y store false', async () => {
  const s = aiSetup({ corrected_text: 'Hola.', uncertain_fragments: [] }, true);
  await s.ai.improveText({ provider: 'openai', baseUrl: 'https://api.openai.com/v1', apiKey: 'test-key', model: 'configured-model' }, 'hola');
  assert.equal(s.requests[0].url, 'https://api.openai.com/v1/responses'); assert.equal(s.requests[0].body.store, false); assert.equal(s.requests[0].body.text.format.strict, true);
});
test('fragmentos ambiguos deben existir literalmente en original y propuesta', async () => {
  const original = 'Hablamos de Señora de la salud ayer.';
  const s = aiSetup({ corrected_text: original, uncertain_fragments: ['Señora de la salud'] });
  assert.equal((await s.ai.improveText(local, original)).uncertain_fragments[0], 'Señora de la salud');
  for (const result of [
    { corrected_text: 'Hablamos del sector salud ayer.', uncertain_fragments: ['Señora de la salud'] },
    { corrected_text: original, uncertain_fragments: ['inventado'] }
  ]) await assert.rejects(aiSetup(result).ai.improveText(local, original), /fragmento ambiguo/);
});
test('rechaza cambios de cifras y negaciones, respuestas vacías, incompletas o con acciones', async () => {
  for (const corrected_text of ['Tiene 6 días.', 'No tiene 8 días.', 'Tiene 8 días.']) await assert.rejects(aiSetup({ corrected_text, uncertain_fragments: [] }).ai.improveText(local, 'No tiene 6 días.'), /números o negaciones/);
  for (const result of [null, [], {}, { corrected_text: '', uncertain_fragments: [] }, { corrected_text: 'Hola.', uncertain_fragments: 'no' }, { corrected_text: 'Hola.', uncertain_fragments: [], actions: [] }]) await assert.rejects(aiSetup(result).ai.improveText(local, 'hola'), /formato inválido/);
  await assert.rejects(aiSetup({ corrected_text: 'Hola.', uncertain_fragments: [] }, true, 'incomplete').ai.improveText({ provider: 'openai', baseUrl: 'https://api.openai.com/v1', apiKey: 'test-key', model: 'configured-model' }, 'hola'), /incompleta/);
});
test('texto vacío o demasiado extenso se rechaza antes de hacer solicitudes', async () => {
  const s = aiSetup({});
  for (const text of ['', ' ', null, 'a'.repeat(20001)]) await assert.rejects(s.ai.improveText(local, text), /20000/);
  assert.equal(s.requests.length, 0);
});
function flowSetup(response = { ok: true, corrected_text: 'Hola, Víctor.', uncertain_fragments: [] }) {
  const calls = [], messages = []; let writes = 0;
  const state = { voiceTranscript: 'hola Víctor', voiceCorrectedText: '', voiceUncertainFragments: [], voiceTextSource: 'original', voiceTarget: { kind: 'text', element: { isConnected: true } }, voiceActions: [], voiceBusy: false, dictationWriteMode: 'cursor' };
  const context = { state, renderPanel() {}, showStatus: value => messages.push(value), sendExtensionMessage: async message => { calls.push(message); if (response instanceof Error) throw response; return response; } };
  vm.createContext(context);
  vm.runInContext(source.slice(source.indexOf('  async function improveDictationText('), source.indexOf('  async function applyVoiceActions(')), context);
  context.applyVoiceActions = async () => { writes++; return state.voiceActions[0].value; };
  return { state, context, calls, messages, writes: () => writes };
}
test('mejora automática inserta la propuesta al detener cuando revisión está desactivada', async () => {
  const s = flowSetup(); await s.context.processVoice({ fromVoiceStop: true, autoImproveText: true });
  assert.equal(s.calls.length, 1); assert.equal(s.calls[0].type, 'JALFIA_IMPROVE_TEXT'); assert.equal(s.state.voiceActions[0].value, 'Hola, Víctor.'); assert.equal(s.state.voiceTranscript, 'hola Víctor'); assert.equal(s.writes(), 1);
  await s.context.processVoice({ fromVoiceStop: true, autoImproveText: true }); assert.equal(s.calls.length, 1); assert.equal(s.writes(), 1);
});
test('el flujo automático muestra solo loader durante mejora e inserción, sin vista previa transitoria', async () => {
  const s = flowSetup(); let releaseAI, releaseInsert, enteredInsert;
  const insertStarted = new Promise(resolve => { enteredInsert = resolve; });
  s.context.sendExtensionMessage = () => new Promise(resolve => { releaseAI = resolve; });
  s.context.applyVoiceActions = async () => { enteredInsert(); await new Promise(resolve => { releaseInsert = resolve; }); s.state.voiceActions = []; s.state.voicePreview = false; };
  s.context.escapeHtml = value => value;
  vm.runInContext(source.slice(source.indexOf('  function renderVoice('), source.indexOf('  async function improveDictationText(')), s.context);
  const snapshots = [];
  s.context.renderPanel = () => { if (s.state.voiceAutoProcessing) snapshots.push(s.context.renderVoice()); };
  const pending = s.context.processVoice({ fromVoiceStop: true, autoImproveText: true });
  assert.equal(s.state.voiceAutoProcessing, true);
  assert.match(s.context.renderVoice(), /dictation-loader/);
  releaseAI({ ok: true, corrected_text: 'Hola, Víctor.', uncertain_fragments: [] });
  await insertStarted;
  assert.equal(s.state.voiceAutoProcessing, true);
  for (const html of snapshots) { assert.match(html, /aria-busy="true"/); assert.doesNotMatch(html, /textarea|Confirmar y aplicar|Vista previa|Comparar original/); }
  releaseInsert(); await pending;
  assert.equal(s.state.voiceAutoProcessing, false); assert.equal(s.state.voicePreview, false);
});
test('revisión activada muestra la mejora sin insertar y mejora desactivada no consulta IA', async () => {
  const s = flowSetup(); await s.context.processVoice({ fromVoiceStop: true, autoImproveText: true, reviewBeforeApply: true }); assert.equal(s.writes(), 0); assert.equal(s.state.voicePreview, true); assert.equal(s.state.voiceTextSource, 'improved');
  const raw = flowSetup(); await raw.context.processVoice({ fromVoiceStop: true, autoImproveText: false }); assert.equal(raw.calls.length, 0); assert.equal(raw.state.voiceActions[0].value, 'hola Víctor'); assert.equal(raw.writes(), 1);
});
test('errores, falta de configuración y ambigüedades fuerzan revisión sin perder el original', async () => {
  for (const response of [new Error('Sin conexión'), { ok: false, error: 'Configurá la IA' }, { ok: true, corrected_text: 'hola Víctor', uncertain_fragments: ['Víctor'] }]) {
    const s = flowSetup(response); await s.context.processVoice({ fromVoiceStop: true, autoImproveText: true });
    assert.equal(s.writes(), 0); assert.equal(s.state.voicePreview, true); assert.equal(s.state.voiceTranscript, 'hola Víctor'); assert.ok(s.state.voiceActions[0].value); assert.equal(s.state.voiceBusy, false);
  }
});
test('mejora manual mantiene separados original, propuesta y edición', async () => {
  const s = flowSetup(); s.state.voiceTextSource = 'manual'; s.state.voiceActions = [{ value: 'Mi edición', include: true, errors: [] }];
  await s.context.improveDictationText(); assert.equal(s.state.voiceTranscript, 'hola Víctor'); assert.equal(s.state.voiceCorrectedText, 'Hola, Víctor.'); assert.equal(s.state.voiceActions[0].value, 'Mi edición'); assert.equal(s.writes(), 0);
});
test('no se mejora mientras escucha o está ocupado, ni se envía si el destino desapareció', async () => {
  const s = flowSetup(); s.state.listening = true; await s.context.improveDictationText(); assert.equal(s.calls.length, 0);
  s.state.listening = false; s.state.voiceTarget.element.isConnected = false;
  await s.context.processVoice({ fromVoiceStop: true, autoImproveText: true }); assert.equal(s.calls.length, 0); assert.equal(s.writes(), 0);
});
test('mejora automática está activada por defecto y se fija al comenzar la captura', () => {
  for (const preference of [undefined, true, false]) {
    let result;
    const state = { autoImproveText: preference, voiceSubmit: false, shadow: { querySelector: () => null } };
    class Recognition { start() {} stop() { this.onend(); } }
    const context = { state, window: { SpeechRecognition: Recognition, setTimeout: () => 1, clearTimeout() {} }, renderPanel() {}, updateVoiceButtons() {}, showStatus() {}, processVoice: options => { result = options; } };
    vm.createContext(context); vm.runInContext(source.slice(source.indexOf('  function startVoiceRecognition('), source.indexOf('  function fieldTypeLabel(')), context);
    context.startVoiceRecognition(); state.autoImproveText = preference === false; state.voiceSubmit = true; context.startVoiceRecognition();
    assert.equal(result.autoImproveText, preference !== false);
  }
});
test('fondo usa configuración guardada, no expone claves y no llama al proveedor sin configuración', async () => {
  let listener, configured, calls = 0, saved;
  const context = { importScripts() {}, JalfiaAI: { improveText: async (config, text) => { calls++; assert.equal(config.model, 'configured'); assert.equal(text, 'hola'); return { corrected_text: 'Hola.', uncertain_fragments: [] }; } },
    chrome: { runtime: { id: 'own', onMessage: { addListener: fn => { listener = fn; } } }, action: { onClicked: { addListener() {} } }, storage: { local: { setAccessLevel: async () => {}, get: async () => ({ jalfiaAI: configured }), set: async value => { saved = value; } } } } };
  vm.createContext(context); vm.runInContext(fs.readFileSync(path.join(__dirname, '../src/background.js'), 'utf8'), context);
  const call = message => new Promise(resolve => listener(message, { id: 'own' }, resolve));
  const missing = await call({ type: 'JALFIA_IMPROVE_TEXT', text: 'hola' }); assert.equal(missing.ok, false); assert.equal(calls, 0);
  configured = { model: 'configured', apiKey: 'secret-test' };
  const response = await call({ type: 'JALFIA_IMPROVE_TEXT', text: 'hola' }); assert.equal(calls, 1); assert.equal(response.corrected_text, 'Hola.'); assert.equal(response.apiKey, undefined);
  assert.equal(listener({ type: 'JALFIA_IMPROVE_TEXT', text: 'hola' }, { id: 'foreign' }, () => {}), false);
  for (const preference of [undefined, true, false]) {
    await call({ type: 'JALFIA_SAVE_UI_SETTINGS', settings: { autoImproveText: preference, reviewBeforeApply: false, voiceShowText: preference, manualCompletionEnabled: preference } });
    assert.equal(saved.jalfiaSettings.autoImproveText, preference !== false); assert.equal(saved.jalfiaSettings.reviewBeforeApply, false);
    assert.equal(saved.jalfiaSettings.voiceShowText, preference === true);
    assert.equal(saved.jalfiaSettings.manualCompletionEnabled, preference !== false);
  }
});
