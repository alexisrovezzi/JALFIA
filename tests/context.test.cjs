const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, '../src/content.js'), 'utf8');

test('captura errores sincrónicos y asincrónicos al recargar la extensión', async () => {
  for (const runtime of [
    { id: undefined, sendMessage() { throw new Error('No debe llamarse'); } },
    { id: 'test', sendMessage() { throw new Error('Extension context invalidated.'); } },
    { id: 'test', sendMessage: async () => { throw new Error('Extension context invalidated.'); } }
  ]) {
    let stopped = false, cancelled = false, message;
    const button = { dataset: { action: 'apply-voice' } }, close = { dataset: { action: 'close' } };
    const state = { voiceSubmit: true, shadow: { querySelectorAll: () => [button, close] }, cancelScopeSelection: () => { cancelled = true; }, stopVoice: () => { stopped = true; } };
    const context = { state, chrome: { runtime }, stopAutoRescan() {}, showStatus: text => { message = text; } };
    vm.createContext(context);
    vm.runInContext(source.slice(source.indexOf('  async function sendExtensionMessage('), source.indexOf("  sendExtensionMessage({ type: 'JALFIA_GET_UI_SETTINGS'")), context);
    const result = await context.sendExtensionMessage({ type: 'test' });
    assert.equal(result.ok, false);
    assert.equal(state.contextInvalidated, true);
    assert.equal(state.voiceSubmit, false);
    assert.equal(stopped && cancelled, true);
    assert.equal(button.disabled, true);
    assert.equal(close.disabled, undefined);
    assert.match(message, /Recargá esta página/);
  }
});

test('no oculta errores ajenos a la recarga ni altera mensajes válidos', async () => {
  const context = { state: {}, chrome: { runtime: { id: 'test', sendMessage: async () => ({ ok: true }) } } };
  vm.createContext(context);
  vm.runInContext(source.slice(source.indexOf('  async function sendExtensionMessage('), source.indexOf("  sendExtensionMessage({ type: 'JALFIA_GET_UI_SETTINGS'")), context);
  assert.equal((await context.sendExtensionMessage({})).ok, true);
  context.chrome.runtime.sendMessage = async () => { throw new Error('Otro error'); };
  await assert.rejects(context.sendExtensionMessage({}), /Otro error/);
});
