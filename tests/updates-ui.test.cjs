const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, '../src/content.js'), 'utf8');
function notice(updateInfo, busy = false) {
  const context = { state: { updateInfo, updatesBusy: busy }, escapeHtml: value => String(value).replaceAll('<', '&lt;').replaceAll('"', '&quot;') };
  vm.createContext(context);
  vm.runInContext(source.slice(source.indexOf('  function renderUpdateNotice('), source.indexOf('  function openAbout(')), context);
  return context.renderUpdateNotice();
}
test('campanita ofrece descarga solo si hay una actualización publicada', () => {
  const publication = { download: 'https://github.com/alexisrovezzi/JALFIA/releases/download/dev-test/JALFIA.zip' };
  assert.match(notice({ status: 'available', publication }), /Descargar actualización/);
  for (const status of ['identical', 'unknown', 'ahead', 'diverged', 'unavailable']) assert.doesNotMatch(notice({ status, publication }), /href=/);
  assert.match(notice({ status: 'identical' }), /Estás al día/);
  assert.match(notice({}, true), /Buscando novedades/);
});
test('el aviso conserva novedades y advierte cuando falló la comprobación', () => {
  const html = notice({ status: 'available', publication: { download: 'https://github.com/file.zip' }, error: '<error>' });
  assert.match(html, /Descargar actualización/); assert.match(html, /desactualizado/); assert.match(html, /&lt;error>/);
});
