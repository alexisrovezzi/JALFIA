const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, '../src/content.js'), 'utf8');

function setup(failingFrame) {
  const memory = () => ({ fields: [{ label: 'Nombre' }] });
  const state = { memory: memory(), memorySignature: 'previous', frames: [1, 2].map(frameId => ({ frameId, memory: memory() })) };
  const requests = [], messages = [];
  const snapshot = { origin: 'https://example.com', path: '/form', fields: [] };
  const context = {
    state, memorySnapshot: () => snapshot, renderPanel() {}, showStatus: message => messages.push(message),
    chrome: { runtime: { sendMessage: async message => { requests.push(message); return { ok: true }; } } },
    frameRequest: async (frame, operation) => { requests.push({ frameId: frame.frameId, operation }); return { ok: frame.frameId !== failingFrame }; }
  };
  vm.createContext(context);
  vm.runInContext(source.slice(source.indexOf('  async function forgetPageMemory('), source.indexOf('  function wirePanelEvents(')), context);
  return { context, state, requests, messages, snapshot };
}

test('borrar memoria de página olvida el documento principal y todos los iframes disponibles', async () => {
  const s = setup();
  await s.context.forgetPageMemory();
  assert.equal(s.requests[0].type, 'JALFIA_MEMORY_FORGET');
  assert.equal(s.requests[0].snapshot, s.snapshot);
  assert.deepEqual(s.requests.slice(1), [{ frameId: 1, operation: 'forget-memory' }, { frameId: 2, operation: 'forget-memory' }]);
  assert.equal(s.state.memory, null);
  assert.equal(s.state.memoryForgotten, JSON.stringify(s.snapshot));
  assert.ok(s.state.frames.every(frame => frame.memory === null));
  assert.match(s.messages[0], /eliminada/);
});

test('un iframe que falla conserva su memoria y el borrado parcial informa el fallo', async () => {
  const s = setup(2);
  await s.context.forgetPageMemory();
  assert.equal(s.state.memory, null);
  assert.equal(s.state.frames[0].memory, null);
  assert.notEqual(s.state.frames[1].memory, null);
  assert.match(s.messages[0], /No se pudo borrar la memoria de 1 documentos/);
});
