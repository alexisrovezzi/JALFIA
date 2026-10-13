const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, '../src/content.js'), 'utf8');
test('reconoce fechas de texto y compara ISO con día/mes/año', () => {
  const context = { inferLabel: () => 'Fecha', normalizeText: value => String(value || '').trim() };
  vm.createContext(context);
  vm.runInContext(source.slice(source.indexOf('  function fieldKind('), source.indexOf('  function selectableOptionNode(')), context);
  vm.runInContext(source.slice(source.indexOf('  function normalizeComparable('), source.indexOf('  function findVisibleOption(')), context);
  const element = { tagName: 'INPUT', value: '13/10/2026', getAttribute: name => ({ type: 'text', role: 'button', 'aria-haspopup': 'true' })[name] || null, closest: () => null };
  assert.equal(context.fieldKind(element), 'date');
  assert.equal(context.normalizeComparable('14/10/2026'), context.normalizeComparable('2026-10-14'));
  element.value = '';
  assert.equal(context.fieldKind(element), 'date');
});

test('al aplicar ISO escribe día/mes/año en el control de texto', async () => {
  let events = 0;
  const element = { tagName: 'INPUT', type: 'text', value: '13/10/2026', focus() {}, blur() {} };
  const context = { state: { fields: [] }, document: { querySelector: () => element }, CSS: { escape: value => value },
    fieldKind: () => 'date', normalizeText: value => String(value || '').trim(), dispatchInputEvents() { events++; }, rememberSuccess: async () => {} };
  vm.createContext(context);
  vm.runInContext(source.slice(source.indexOf('  function normalizeComparable('), source.indexOf('  function findVisibleOption(')), context);
  vm.runInContext(source.slice(source.indexOf('  async function setFieldValue('), source.indexOf('  function applySpeechToField(')), context);
  assert.equal((await context.setFieldValue('date', '2026-10-14')).ok, true);
  assert.equal(element.value, '14/10/2026');
  assert.equal((await context.setFieldValue('date', '15/10/2026')).ok, true);
  assert.equal(element.value, '15/10/2026');
  assert.equal(events, 2);
  assert.equal((await context.setFieldValue('date', '14 de octubre de 2026')).ok, false);
  assert.equal(element.value, '15/10/2026');
});

test('detecta Hora como tiempo y conserva el formato con o sin segundos', async () => {
  for (const [initial, expected] of [['14:31', '10:30'], ['14:31:22', '10:30:00']]) {
    const element = { tagName: 'INPUT', type: 'text', value: initial, getAttribute: name => name === 'type' ? 'text' : null, closest: () => null, focus() {}, blur() {} };
    const context = { state: { fields: [] }, inferLabel: () => 'Hora', normalizeText: value => String(value || '').trim(),
      document: { querySelector: () => element }, CSS: { escape: value => value }, dispatchInputEvents() {}, rememberSuccess: async () => {} };
    vm.createContext(context);
    vm.runInContext(source.slice(source.indexOf('  function fieldKind('), source.indexOf('  function selectableOptionNode(')), context);
    vm.runInContext(source.slice(source.indexOf('  function normalizeComparable('), source.indexOf('  function findVisibleOption(')), context);
    vm.runInContext(source.slice(source.indexOf('  async function setFieldValue('), source.indexOf('  function applySpeechToField(')), context);
    assert.equal(context.fieldKind(element), 'time');
    assert.equal((await context.setFieldValue('time', '10:30')).ok, true);
    assert.equal(element.value, expected);
    assert.equal(context.normalizeComparable(element.value), context.normalizeComparable('10:30'));
    assert.equal((await context.setFieldValue('time', 'a las diez y media')).ok, false);
  }
});
