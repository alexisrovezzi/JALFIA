const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
function git(...args) { return execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim(); }
function metadata() {
  const commit = git('rev-parse', 'HEAD');
  const dirty = Boolean(git('status', '--porcelain', '--untracked-files=all', '--', 'manifest.json', 'src', 'Readme.md', ':!src/build-info.json'));
  return { commit, shortCommit: commit.slice(0, 7), generatedAt: new Date().toISOString(), dirty };
}
// ZIP store entries: no external archiver or runtime dependency required.
function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function zip(entries) {
  const local = [], central = []; let offset = 0;
  for (const [name, data] of entries) {
    const filename = Buffer.from(name), body = Buffer.from(data), crc = crc32(body);
    const header = Buffer.alloc(30); header.writeUInt32LE(0x04034b50); header.writeUInt16LE(20, 4); header.writeUInt16LE(0x800, 6); header.writeUInt16LE(33, 12);
    header.writeUInt32LE(crc, 14); header.writeUInt32LE(body.length, 18); header.writeUInt32LE(body.length, 22); header.writeUInt16LE(filename.length, 26);
    const directory = Buffer.alloc(46); directory.writeUInt32LE(0x02014b50); directory.writeUInt16LE(20, 4); directory.writeUInt16LE(20, 6); directory.writeUInt16LE(0x800, 8); directory.writeUInt16LE(33, 14);
    directory.writeUInt32LE(crc, 16); directory.writeUInt32LE(body.length, 20); directory.writeUInt32LE(body.length, 24); directory.writeUInt16LE(filename.length, 28); directory.writeUInt32LE(offset, 42);
    local.push(header, filename, body); central.push(directory, filename); offset += header.length + filename.length + body.length;
  }
  const directory = Buffer.concat(central), end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10); end.writeUInt32LE(directory.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...local, directory, end]);
}
function main() {
  const info = metadata();
  fs.writeFileSync(path.join(root, 'src/build-info.json'), JSON.stringify(info, null, 2) + '\n');
  if (process.argv[2] === 'metadata') return;
  const entries = [];
  function add(relative) {
    const absolute = path.join(root, relative);
    if (fs.statSync(absolute).isDirectory()) for (const child of fs.readdirSync(absolute).sort()) add(`${relative}/${child}`);
    else entries.push([relative, fs.readFileSync(absolute)]);
  }
  ['manifest.json', 'src', 'Readme.md'].forEach(add);
  const version = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'))).version;
  fs.mkdirSync(path.join(root, 'dist'), { recursive: true });
  const filename = `JALFIA-${version}-${info.shortCommit}.zip`;
  fs.writeFileSync(path.join(root, 'dist', filename), zip(entries));
  console.log(filename);
}
if (require.main === module) main();
module.exports = { metadata, zip, crc32 };
