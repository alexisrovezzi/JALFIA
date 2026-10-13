const test = require('node:test'), assert = require('node:assert/strict'), vm = require('node:vm'), fs = require('node:fs'), path = require('node:path');
function setup() {
  let listener, stored = {};
  const chrome = { runtime: { id: 'extension', onMessage: { addListener: fn => { listener = fn; } } }, storage: { local: { get: async () => structuredClone(stored), set: async data => { stored = structuredClone(data); } } } };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../src/memory.js'), 'utf8'), { chrome, URL, Date });
  const snapshot = { origin: 'https://app.test', path: '/form/12345', context: 'document', fields: [{ key: 'documento', label: 'Documento', kind: 'text', name: 'doc', currentValue: 'VALOR_PRIVADO', options: ['OPCION_PRIVADA'], rules: { maxlength: '8', messages: ['MENSAJE_PRIVADO'], hint: 'VALOR_PRIVADO' } }] };
  return { snapshot, call: (type, extra = {}) => new Promise(resolve => listener({ type, snapshot, ...extra }, { id: 'extension', url: 'https://app.test/form/12345' }, resolve)), stored: () => stored };
}
test('persiste solo estructura y reglas declaradas, nunca valores ni opciones', async () => {
  const s = setup(); await s.call('JALFIA_MEMORY_SYNC');
  const saved = JSON.stringify(s.stored()); assert.doesNotMatch(saved, /VALOR_PRIVADO|OPCION_PRIVADA|MENSAJE_PRIVADO|12345/); assert.match(saved, /maxlength/);
});
test('conserva estrategias verificadas y actualiza campos sin duplicar pantallas', async () => {
  const s = setup(); await s.call('JALFIA_MEMORY_SYNC');
  await s.call('JALFIA_MEMORY_SUCCESS', { fieldKey: 'documento', strategy: 'input-events' });
  const response = await s.call('JALFIA_MEMORY_SYNC'); assert.equal(response.known, true); assert.equal(response.fields[0].successes, 1);
  s.snapshot.fields.push({ key: 'estado', label: 'Estado', kind: 'select' });
  const updated = await s.call('JALFIA_MEMORY_SYNC'); assert.equal(updated.fields.length, 2); assert.equal(Object.keys(s.stored().jalfiaMemory).length, 1);
});
test('olvidar elimina la pantalla y no hereda estrategias en campos ambiguos', async () => {
  const s = setup(); await s.call('JALFIA_MEMORY_SUCCESS', { fieldKey: 'documento', strategy: 'input-events' });
  s.snapshot.fields.push({ ...s.snapshot.fields[0] });
  const response = await s.call('JALFIA_MEMORY_SYNC'); assert.ok(response.fields.every(field => !field.strategy));
  await s.call('JALFIA_MEMORY_FORGET'); assert.equal(Object.keys(s.stored().jalfiaMemory).length, 0);
});
