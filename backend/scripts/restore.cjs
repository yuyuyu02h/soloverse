// Restore only into a NEW directory. Never overwrite a working project or live database.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const [snapshotArg, destinationArg] = process.argv.slice(2);
if (!snapshotArg || !destinationArg) throw new Error('Usage: node backend/scripts/restore.cjs SNAPSHOT NEW_DIRECTORY');
const snapshot = path.resolve(snapshotArg), destination = path.resolve(destinationArg);
if (fs.existsSync(destination)) throw new Error('Destination must not exist');
const manifest = JSON.parse(fs.readFileSync(path.join(snapshot, 'manifest.json'), 'utf8'));
for (const [name, hash] of Object.entries(manifest.hashes)) {
  if (path.basename(name) !== name) throw new Error('Invalid manifest path');
  if (crypto.createHash('sha256').update(fs.readFileSync(path.join(snapshot, name))).digest('hex') !== hash) throw new Error('Snapshot checksum mismatch');
}
for (const archive of ['source.tar', 'untracked.tar']) {
  if (!fs.existsSync(path.join(snapshot, archive))) continue;
  const files = execFileSync('tar', ['-tf', path.join(snapshot, archive)], { encoding: 'utf8' }).trim().split('\n');
  if (files.some(p => path.isAbsolute(p) || p.split('/').includes('..'))) throw new Error('Unsafe archive path');
}
fs.mkdirSync(destination, { mode: 0o700 });
execFileSync('tar', ['-xf', path.join(snapshot, 'source.tar'), '-C', destination]);
// A destination inside another checkout must not inherit that outer repository.
if (fs.statSync(path.join(snapshot, 'working.patch')).size) execFileSync('git', ['apply', path.join(snapshot, 'working.patch')], { cwd: destination, env: { ...process.env, GIT_CEILING_DIRECTORIES: path.dirname(destination) } });
if (fs.existsSync(path.join(snapshot, 'untracked.tar'))) execFileSync('tar', ['-xf', path.join(snapshot, 'untracked.tar'), '-C', destination]);
for (const [name, relative] of [['backend.env', 'backend/.env'], ['frontend.env', 'frontend/.env.local'], ['soloverse.db', 'backend/soloverse.db']]) {
  if (fs.existsSync(path.join(snapshot, name))) {
    fs.copyFileSync(path.join(snapshot, name), path.join(destination, relative));
    fs.chmodSync(path.join(destination, relative), 0o600);
  }
}
console.log(`Restored to ${destination}. No dependencies installed or server started. Start with DB_PATH pointing to this restored backend/soloverse.db.`);
