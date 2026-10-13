const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
function setup() {
  let listener; const calls = [];
  const frames = [{ frameId: 0, documentId: 'top' }, { frameId: 1, documentId: 'doc-a' }, { frameId: 2, documentId: 'doc-b' }];
  const chrome = {
    runtime: { id: 'extension', onMessage: { addListener: fn => { listener = fn; } } },
    webNavigation: { getAllFrames: async () => frames, getFrame: async ({ frameId }) => frames.find(frame => frame.frameId === frameId) },
    tabs: { sendMessage: async (tabId, message, target) => { calls.push({ tabId, message, target }); if (target.frameId === 2) throw new Error('no permission'); return { ok: true, title: 'Formulario', fields: [{ id: 'same-id', label: 'Detalle' }] }; } }
  };
  const context = vm.createContext({ chrome });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../src/frames.js'), 'utf8'), context);
  return { calls, frames, call: (message, sender = { id: 'extension', tab: { id: 7 }, frameId: 0 }) => new Promise(resolve => listener(message, sender, resolve)) };
}
test('reune frames accesibles sin consultar el principal y reporta inaccesibles', async () => {
  const s = setup(), result = await s.call({ type: 'JALFIA_COLLECT_FRAMES' });
  assert.equal(result.frames.length, 1); assert.equal(result.unavailable, 1); assert.equal(result.frames[0].documentId, 'doc-a');
  assert.ok(s.calls.every(call => call.target.frameId > 0));
});
test('dirige operaciones al documento correcto y rechaza navegaciones obsoletas', async () => {
  const s = setup(), request = { type: 'JALFIA_FRAME_REQUEST', frameId: 1, documentId: 'doc-a', fieldId: 'same-id', operation: 'fill', value: 'texto' };
  assert.equal((await s.call(request)).ok, true); assert.equal(s.calls[0].target.documentId, 'doc-a');
  s.frames[1].documentId = 'new-doc'; assert.equal((await s.call(request)).ok, false); assert.equal(s.calls.length, 1);
});
test('un subframe no puede coordinar otros documentos', async () => {
  const s = setup();
  assert.equal((await s.call({ type: 'JALFIA_COLLECT_FRAMES' }, { id: 'extension', tab: { id: 7 }, frameId: 1 })).ok, false);
  assert.equal(s.calls.length, 0);
});
