const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, '../src/content.js'), 'utf8');
test('lee la etiqueta de un editor en un contenedor con un solo control', () => {
  const context = { FIELD_SELECTOR: 'controls', normalizeText: value => String(value || '').trim() };
  vm.createContext(context);
  vm.runInContext(source.slice(source.indexOf('  function labelFromWrapper('), source.indexOf('  function labelFromAria(')), context);
  const container = { querySelectorAll: selector => selector === 'controls' ? [{}] : [{ textContent: ' Evolución ' }] };
  const element = { closest: () => null, parentElement: container };
  assert.equal(context.labelFromWrapper(element), 'Evolución');
  container.querySelectorAll = selector => selector === 'controls' ? [{}, {}] : [{ textContent: 'Evolución' }];
  assert.equal(context.labelFromWrapper(element), '');
});
