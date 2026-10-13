const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
function setup(fetch) {
  const context = { URL, AbortController, setTimeout, clearTimeout, fetch, TypeError, SyntaxError };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../src/ai.js'), 'utf8'), context);
  return context.JalfiaAI;
}
const local = { provider: 'local', baseUrl: 'http://localhost:8080/v1/', apiKey: '', model: 'local-model' };
test('valida URLs, modelo y autenticacion antes de solicitar', () => {
  const ai = setup();
  assert.equal(ai.normalizeConfig(local).baseUrl, 'http://localhost:8080/v1');
  assert.throws(() => ai.normalizeConfig({ ...local, baseUrl: 'file:///secreto' }));
  assert.throws(() => ai.normalizeConfig({ ...local, model: '' }));
  assert.throws(() => ai.normalizeConfig({ ...local, provider: 'openai', baseUrl: 'https://otro.test/v1', apiKey: 'test-key' }));
  assert.throws(() => ai.normalizeConfig({ ...local, provider: 'openai', baseUrl: 'https://api.openai.com/v1' }));
});
test('prueba compatible envia mensaje sintetico y comprueba JSON', async () => {
  let sent;
  const ai = setup(async (url, options) => { sent = { url, options }; return { ok: true, json: async () => ({ choices: [{ message: { content: '{"ok":true}' } }] }) }; });
  assert.equal((await ai.testConnection(local)).ok, true);
  assert.equal(sent.url, 'http://localhost:8080/v1/chat/completions');
  assert.equal(sent.options.redirect, 'error'); assert.equal(sent.options.credentials, 'omit');
  assert.equal(JSON.parse(sent.options.body).response_format.type, 'json_object');
});
test('OpenAI usa Responses y esquema estricto sin almacenar la prueba', async () => {
  let sent;
  const ai = setup(async (url, options) => { sent = { url, options }; return { ok: true, json: async () => ({ output: [{ content: [{ type: 'output_text', text: '{"ok":true}' }] }] }) }; });
  await ai.testConnection({ provider: 'openai', baseUrl: 'https://api.openai.com/v1', apiKey: 'test-key', model: 'test-model' });
  assert.equal(sent.url, 'https://api.openai.com/v1/responses');
  assert.equal(sent.options.headers.Authorization, 'Bearer test-key');
  const body = JSON.parse(sent.options.body); assert.equal(body.store, false); assert.equal(body.text.format.strict, true);
});
test('rechaza texto libre y no expone el cuerpo de errores del proveedor', async () => {
  const ai = setup(async () => ({ ok: true, json: async () => ({ choices: [{ message: { content: 'hola' } }] }) }));
  await assert.rejects(ai.testConnection(local), /JSON requerido/);
  const denied = setup(async () => ({ ok: false, status: 401 }));
  await assert.rejects(denied.testConnection(local), /Clave inválida/);
});
test('carga y deduplica modelos del servidor', async () => {
  const ai = setup(async () => ({ ok: true, json: async () => ({ data: [{ id: 'b' }, { id: 'a' }, { id: 'a' }] }) }));
  assert.deepEqual(Array.from(await ai.listModels({ ...local, model: '' })), ['a', 'b']);
});

test('distingue cuota agotada y limite temporal sin mostrar mensajes crudos', async () => {
  for (const [code, expected] of [['insufficient_quota', /No hay cuota/], ['rate_limit_exceeded', /Espera un momento/], ['project_spend_limit_exceeded', /gasto del proyecto/]]) {
    const ai = setup(async () => ({ ok: false, status: 429, json: async () => ({ error: { code, message: 'test-key' } }) }));
    await assert.rejects(ai.testConnection(local), expected);
  }
});

test('las credenciales solo pueden consultarse desde la pagina interna de ajustes', async () => {
  let listener, accessLevel;
  const context = {
    importScripts() {},
    chrome: {
      storage: { local: {
        setAccessLevel: async config => { accessLevel = config.accessLevel; },
        get: async () => ({ jalfiaAI: { apiKey: 'test-key' } })
      } },
      runtime: { id: 'extension-id', getURL: path => `chrome-extension://extension-id/${path}`, onMessage: { addListener: fn => { listener = fn; } } },
      action: { onClicked: { addListener() {} } }
    }
  };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../src/background.js'), 'utf8'), context);
  const call = sender => new Promise(resolve => listener({ type: 'JALFIA_AI_GET' }, sender, resolve));
  const blocked = await call({ id: 'extension-id', url: 'https://formulario.test' });
  assert.equal(blocked.ok, false); assert.equal(blocked.config, undefined);
  const allowed = await call({ id: 'extension-id', url: 'chrome-extension://extension-id/src/options.html' });
  assert.equal(allowed.config.apiKey, 'test-key'); assert.equal(accessLevel, 'TRUSTED_CONTEXTS');
});

test('la interpretacion valida evidencia, IDs, opciones y booleanos', async () => {
  const fields = [{ id: 'estado', kind: 'select', options: [{ text: 'Activo', value: 'a' }] }, { id: 'incluir', kind: 'switch', options: [] }];
  const action = { field_id: 'estado', value: 'Activo', evidence: 'activos', needs_confirmation: false };
  function aiFor(actions) { return setup(async () => ({ ok: true, json: async () => ({ choices: [{ message: { content: JSON.stringify({ actions, corrected_text: 'Quiero los activos.' }) } }] }) })); }
  const result = await aiFor([action]).interpret(local, 'Quiero los activos', fields);
  assert.equal(result.actions.length, 1);
  assert.equal(result.actions[0].field_id, 'estado');
  assert.equal(result.corrected_text, 'Quiero los activos.');
  for (const invalid of [{ ...action, field_id: 'inventado' }, { ...action, evidence: 'no mencionado' }, { ...action, value: 'Inventado' }, { ...action, field_id: 'incluir', value: 'Sí' }]) {
    await assert.rejects(aiFor([invalid]).interpret(local, 'Quiero los activos', fields));
  }
  assert.equal((await aiFor([]).interpret(local, 'Quiero los activos', fields)).actions.length, 0);
});

test('no acepta una respuesta que omite la correccion del texto', async () => {
  const ai = setup(async () => ({ ok: true, json: async () => ({ choices: [{ message: { content: '{"actions":[]}' } }] }) }));
  await assert.rejects(ai.interpret(local, 'texto reconocido', []), /texto corregido requerido \(corrected_text\)/);
});

test('el prompt compatible exige texto corregido incluso cuando no hay cambios', async () => {
  let body;
  const ai = setup(async (url, options) => {
    body = JSON.parse(options.body);
    return { ok: true, json: async () => ({ choices: [{ message: { content: '{"actions":[],"corrected_text":"Texto reconocido."}' } }] }) };
  });
  await ai.interpret(local, 'texto reconocido', []);
  assert.ok(body.messages[0].content.includes('{"actions":[],"corrected_text":"Transcripción completa corregida."}'));
  assert.ok(body.messages[0].content.includes('dos propiedades obligatorias'));
});

test('distingue respuestas mal formadas sin exponer el texto del proveedor', async () => {
  const cases = [
    [null, /debe ser un objeto/],
    [{ corrected_text: 'Texto.' }, /lista de cambios requerida/],
    [{ actions: [{}], corrected_text: 'Texto.' }, /más cambios/],
    [{ actions: [], corrected_text: '' }, /vacío o demasiado largo/],
    [{ actions: [null], corrected_text: 'Texto.' }, /cambio con formato inválido/]
  ];
  for (const [result, expected] of cases) {
    const ai = setup(async () => ({ ok: true, json: async () => ({ choices: [{ message: { content: JSON.stringify(result) } }] }) }));
    await assert.rejects(ai.interpret(local, 'texto', result?.actions?.[0] === null ? [{ id: 'a' }] : []), expected);
  }
});
