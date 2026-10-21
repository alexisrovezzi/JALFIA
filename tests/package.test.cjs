const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { zip, crc32 } = require('../scripts/package.cjs');
test('ZIP contiene entradas legibles con CRC válido y directorio central', () => {
  const data = zip([['manifest.json', '{"version":"0.1.0"}'], ['src/test.js', 'test']]);
  assert.equal(data.readUInt32LE(0), 0x04034b50);
  const end = data.length - 22; assert.equal(data.readUInt32LE(end), 0x06054b50); assert.equal(data.readUInt16LE(end + 8), 2);
  const size = data.readUInt32LE(18), length = data.readUInt16LE(26);
  const body = data.subarray(30 + length, 30 + length + size);
  assert.equal(data.readUInt32LE(14), crc32(body)); assert.equal(JSON.parse(body).version, '0.1.0');
  assert.equal(data.readUInt32LE(data.readUInt32LE(end + 16)), 0x02014b50);
});
test('metadatos limpios/modificados/nuevos y paquete sin demos ni Git', () => {
  const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'jalfia-package-'));
  const run = (cmd, args) => execFileSync(cmd, args, { cwd: fixture, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  try {
    fs.mkdirSync(path.join(fixture, 'scripts')); fs.mkdirSync(path.join(fixture, 'src'));
    fs.copyFileSync(path.join(__dirname, '../scripts/package.cjs'), path.join(fixture, 'scripts/package.cjs'));
    fs.writeFileSync(path.join(fixture, '.gitignore'), '/dist/\n/src/build-info.json\n');
    fs.writeFileSync(path.join(fixture, 'manifest.json'), '{"version":"0.1.0"}');
    fs.writeFileSync(path.join(fixture, 'Readme.md'), 'instructions'); fs.writeFileSync(path.join(fixture, 'src/content.js'), 'original');
    run('git', ['init']); run('git', ['add', '.']); run('git', ['-c', 'user.name=Test', '-c', 'user.email=test@example.com', 'commit', '-m', 'fixture']);
    const info = () => JSON.parse(fs.readFileSync(path.join(fixture, 'src/build-info.json')));
    run(process.execPath, ['scripts/package.cjs', 'metadata']); assert.equal(info().dirty, false); assert.equal(info().commit, run('git', ['rev-parse', 'HEAD']));
    run(process.execPath, ['scripts/package.cjs', 'metadata']); assert.equal(info().dirty, false);
    fs.writeFileSync(path.join(fixture, 'src/new.js'), 'new'); run(process.execPath, ['scripts/package.cjs', 'metadata']); assert.equal(info().dirty, true);
    fs.unlinkSync(path.join(fixture, 'src/new.js')); fs.appendFileSync(path.join(fixture, 'src/content.js'), 'modified');
    const filename = run(process.execPath, ['scripts/package.cjs']); assert.equal(info().dirty, true);
    const archive = fs.readFileSync(path.join(fixture, 'dist', filename)); const names = []; let offset = 0;
    while (archive.readUInt32LE(offset) === 0x04034b50) {
      const length = archive.readUInt16LE(offset + 26), size = archive.readUInt32LE(offset + 18);
      names.push(archive.subarray(offset + 30, offset + 30 + length).toString()); offset += 30 + length + size;
    }
    assert.deepEqual(names.sort(), ['Readme.md', 'manifest.json', 'src/build-info.json', 'src/content.js'].sort());
  } finally { fs.rmSync(fixture, { recursive: true, force: true }); }
});
