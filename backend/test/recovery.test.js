const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { execFileSync, spawnSync } = require('node:child_process');
const restore = path.resolve(__dirname, '../scripts/restore.cjs');

test('recovery validates hashes, applies patch inside another checkout, and refuses overwrite', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sv-restore-'));
  try {
    execFileSync('git', ['init', '-q', root]);
    const snapshot = path.join(root, 'snapshot'), source = path.join(root, 'source');
    fs.mkdirSync(snapshot); fs.mkdirSync(source);
    fs.mkdirSync(path.join(source, 'backend')); fs.mkdirSync(path.join(source, 'frontend'));
    fs.writeFileSync(path.join(root, 'README.md'), 'outer untouched\n');
    fs.writeFileSync(path.join(source, 'README.md'), 'before\n');
    execFileSync('tar', ['-cf', path.join(snapshot, 'source.tar'), '-C', source, 'README.md', 'backend', 'frontend']);
    fs.writeFileSync(path.join(snapshot, 'working.patch'), 'diff --git a/README.md b/README.md\n--- a/README.md\n+++ b/README.md\n@@ -1 +1 @@\n-before\n+saved change\n');
    fs.writeFileSync(path.join(snapshot, 'backend.env'), 'MOCK_KEY=not-a-real-secret\n');
    const hashes = Object.fromEntries(fs.readdirSync(snapshot).map(name => [name, createHash('sha256').update(fs.readFileSync(path.join(snapshot, name))).digest('hex')]));
    fs.writeFileSync(path.join(snapshot, 'manifest.json'), JSON.stringify({ hashes }));
    const dest = path.join(root, 'restored');
    const run = () => spawnSync(process.execPath, [restore, snapshot, dest], { encoding: 'utf8' });
    assert.equal(run().status, 0);
    assert.equal(fs.readFileSync(path.join(dest, 'README.md'), 'utf8'), 'saved change\n');
    assert.equal(fs.readFileSync(path.join(root, 'README.md'), 'utf8'), 'outer untouched\n');
    assert.equal(fs.statSync(path.join(dest, 'backend/.env')).mode & 0o777, 0o600);
    assert.notEqual(run().status, 0);
    fs.appendFileSync(path.join(snapshot, 'working.patch'), 'tampered');
    const refused = path.join(root, 'must-not-exist');
    assert.notEqual(spawnSync(process.execPath, [restore, snapshot, refused]).status, 0);
    assert.equal(fs.existsSync(refused), false);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
