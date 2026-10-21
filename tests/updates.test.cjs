const test = require('node:test');
const assert = require('node:assert/strict');
const { create, REPO } = require('../src/updates.js');
const OLD = 'a'.repeat(40), NEW = 'b'.repeat(40);
function release(commit = NEW) {
  const name = `JALFIA-0.1.0-${commit.slice(0, 7)}.zip`;
  return { prerelease: true, tag_name: `dev-${commit}`, assets: [{ name, state: 'uploaded', browser_download_url: `${REPO}/releases/download/dev-${commit}/${name}` }] };
}
function setup({ commit = OLD, status = 'ahead', releases = [release()], commits, failure, initial = {} } = {}) {
  let clock = 100000000, calls = [];
  const data = { ...initial };
  const storage = { get: async key => ({ [key]: data[key] }), set: async value => Object.assign(data, value) };
  const fetcher = async (url, options) => {
    calls.push(url); assert.equal(options.credentials, 'omit');
    if (failure?.()) return { ok: false, status: 403 };
    let result;
    if (url.includes('/releases?')) result = typeof releases === 'function' ? releases(url) : releases;
    else if (url.includes('/commits?')) result = commits ? commits(url) : [NEW, OLD].map(sha => ({ sha, commit: { committer: { date: sha === NEW ? '2026-10-20T12:00:00Z' : '2026-10-19T12:00:00Z' } } }));
    else result = { status };
    return { ok: true, json: async () => result };
  };
  return { client: create({ storage, fetcher, installed: { commit }, now: () => clock }), calls, data, advance: ms => { clock += ms; }, storage, fetcher };
}
for (const [comparison, expected] of [['ahead', 'available'], ['behind', 'ahead'], ['diverged', 'diverged']]) {
  test(`relación ${comparison}: ${expected}`, async () => {
    const s = setup({ status: comparison }); const result = await s.client.check();
    assert.equal(result.status, expected); assert.equal(result.publication.version, '0.1.0');
    assert.match(result.publication.download, /bbbbbbb.zip$/);
  });
}
test('commit idéntico no muestra aviso y no necesita comparación instalada', async () => {
  const s = setup({ commit: NEW }); assert.equal((await s.client.check()).status, 'identical');
  assert.equal(s.calls.filter(url => url.includes('...') && !url.endsWith('...main')).length, 0);
});
test('sin metadatos no afirma que está actualizada; sin paquetes no ofrece descarga', async () => {
  assert.equal((await setup({ commit: null }).client.check()).status, 'unknown');
  const result = await setup({ releases: [] }).client.check();
  assert.equal(result.status, 'unavailable'); assert.equal(result.publication, null);
});
test('ignora borradores, paquetes incompletos y descargas de otro origen', async () => {
  const draft = { ...release(), draft: true }, incomplete = { ...release(), assets: [] };
  const unsafe = release(); unsafe.assets[0].browser_download_url = 'https://example.com/file.zip';
  const s = setup({ releases: [draft, incomplete, unsafe] });
  assert.equal((await s.client.check()).publication, null);
});
test('paginación y selección por fecha del commit, no por orden de publicación', async () => {
  const s = setup({ releases: url => url.endsWith('page=1') ? Array.from({ length: 100 }, () => ({ draft: true })) : [release(OLD), release(NEW)] });
  assert.equal((await s.client.check()).publication.commit, NEW);
  assert.ok(s.calls.some(url => url.endsWith('page=2')));
});
test('pagina el historial de main e ignora publicaciones de otras ramas', async () => {
  const s = setup({ commits: url => url.endsWith('page=1') ? Array.from({ length: 100 }, () => ({ sha: 'c'.repeat(40) })) : [{ sha: NEW, commit: { committer: { date: '2026-10-20T12:00:00Z' } } }] });
  assert.equal((await s.client.check()).publication.commit, NEW);
  assert.ok(s.calls.some(url => url.includes('/commits?') && url.endsWith('page=2')));
  const unrelated = setup({ commits: () => [] });
  assert.equal((await unrelated.client.check()).status, 'unavailable');
});
test('caché horaria, comprobación manual y consultas concurrentes compartidas', async () => {
  const s = setup();
  const results = await Promise.all([s.client.check(), s.client.check()]);
  assert.equal(results[0], results[1]); const count = s.calls.length;
  await s.client.cached(); await s.client.check(); assert.equal(s.calls.length, count);
  await s.client.check(true); assert.equal(s.calls.length, count * 2);
  s.advance(3600000); await s.client.check(); assert.equal(s.calls.length, count * 3);
});
test('error conserva aviso y fecha exitosa; no repite automáticamente dentro de la hora', async () => {
  let fail = false; const s = setup({ failure: () => fail });
  const success = await s.client.check(); fail = true; s.advance(3600000);
  const result = await s.client.check();
  assert.equal(result.status, 'available'); assert.equal(result.checkedAt, success.checkedAt); assert.match(result.error, /limitó/);
  const count = s.calls.length; await s.client.check(); assert.equal(s.calls.length, count);
});
test('cambio de instalación invalida la caché persistida', async () => {
  const s = setup(); await s.client.check();
  const next = create({ storage: s.storage, fetcher: s.fetcher, installed: { commit: NEW } });
  assert.deepEqual(await next.cached(), {}); assert.equal((await next.check()).status, 'identical');
});
test('commit no accesible conserva resultado; timeout aborta la petición', async () => {
  const s = setup(); await s.client.check();
  const inaccessible = create({ storage: s.storage, installed: { commit: OLD }, fetcher: async () => ({ ok: false, status: 404 }) });
  assert.equal((await inaccessible.check(true)).status, 'available');
  const timers = require('node:timers');
  const real = global.setTimeout;
  global.setTimeout = fn => timers.setTimeout(fn, 1);
  try {
    const timeout = create({ storage: { get: async () => ({}), set: async () => {} }, installed: { commit: OLD }, fetcher: async (_, { signal }) => new Promise((resolve, reject) => signal.addEventListener('abort', () => reject(Object.assign(new Error(), { name: 'AbortError' })))) });
    assert.match((await timeout.check()).error, /diez segundos/);
  } finally { global.setTimeout = real; }
});
