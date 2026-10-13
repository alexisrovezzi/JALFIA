const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, '../src/content.js'), 'utf8');
function setup() {
  const state = { fields: [], draftValues: new Map(), editedFieldIds: new Set(), formClearFieldIds: new Set() };
  let inputs = [];
  const writes = [];
  const context = {
    state, visibleFields: () => state.fields, validateFieldValue: () => [],
    renderPanel() { context.updateDraftValues(); }, showStatus() {},
    setFieldValue: async (id, value) => { writes.push({ id, value }); return { ok: id !== 'failed' }; }
  };
  state.shadow = { querySelectorAll: () => inputs };
  vm.createContext(context);
  vm.runInContext(source.slice(source.indexOf('  function updateDraftValues('), source.indexOf('  function fieldSignature(')), context);
  vm.runInContext(source.slice(source.indexOf('  async function fillForm('), source.indexOf('  async function confirmPreviewFill(')), context);
  const field = (id, currentValue, kind = 'text', options = []) => ({ id, label: id, currentValue, kind, options });
  const edit = (id, value) => { state.editedFieldIds.add(id); state.draftValues.set(id, value); };
  return { context, state, field, edit, writes, setInputs: value => { inputs = value; } };
}

test('visitar campos con valores existentes no crea cambios ni escrituras', async () => {
  const s = setup();
  s.state.fields = [s.field('text', 'Original'), s.field('check', false, 'checkbox'), s.field('frame-1', 'Existente')];
  s.setInputs([{ dataset: { jalfiaValue: 'text' }, value: 'Original' }]);
  s.context.updateDraftValues();
  assert.equal(s.state.draftValues.size, 0);
  assert.equal(s.context.collectPreviewValues().length, 0);
  await s.context.fillForm();
  assert.equal(s.writes.length, 0);
});

test('solo aplica campos editados y no vuelve a aplicarlos al confirmar otra vez', async () => {
  const s = setup();
  s.state.fields = [s.field('untouched', 'Original'), s.field('edited', 'Anterior'), s.field('frame-1', 'Viejo')];
  s.edit('edited', 'Nuevo'); s.edit('frame-1', 'Cambio en iframe');
  s.setInputs([{ dataset: { jalfiaValue: 'untouched' }, value: 'Original' }]);
  await s.context.fillForm();
  assert.deepEqual(s.writes, [{ id: 'edited', value: 'Nuevo' }, { id: 'frame-1', value: 'Cambio en iframe' }]);
  await s.context.fillForm();
  assert.equal(s.writes.length, 2);
  assert.equal(s.state.draftValues.size, 0);
});

test('volver al valor original, incluido un combo o booleano, no genera cambios', () => {
  const s = setup();
  s.state.fields = [s.field('text', 'Original'), s.field('check', false, 'checkbox'),
    s.field('select', 'id-1', 'select', [{ value: 'id-1', text: 'Hospital', selected: true }])];
  s.edit('text', 'Original'); s.edit('check', 'false'); s.edit('select', 'Hospital');
  assert.equal(s.context.collectPreviewValues().length, 0);
});

test('vaciar exige una marca explícita y un fallo conserva el cambio pendiente', async () => {
  const s = setup();
  s.state.fields = [s.field('draft-only', 'Original'), s.field('clear', 'Borrar'), s.field('failed', 'Anterior')];
  s.edit('draft-only', '');
  s.state.formClearFieldIds.add('clear'); s.state.draftValues.set('clear', '');
  s.edit('failed', 'Nuevo');
  await s.context.fillForm();
  assert.deepEqual(s.writes, [{ id: 'clear', value: '' }, { id: 'failed', value: 'Nuevo' }]);
  assert.equal(s.state.formClearFieldIds.has('clear'), false);
  assert.equal(s.state.editedFieldIds.has('failed'), true);
  assert.deepEqual(Array.from(s.context.collectPreviewValues(), item => item.id), ['failed']);
});

test('un cambio externo en un campo no editado no se sobrescribe con el valor anterior', async () => {
  const s = setup();
  s.state.fields = [s.field('external', 'Cambio externo'), s.field('edited', 'Anterior')];
  s.setInputs([{ dataset: { jalfiaValue: 'external' }, value: 'Valor antiguo del panel' }]);
  s.edit('edited', 'Nuevo');
  await s.context.fillForm();
  assert.deepEqual(s.writes, [{ id: 'edited', value: 'Nuevo' }]);
});
