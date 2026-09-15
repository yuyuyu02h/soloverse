// Local private snapshot. Never prints configuration values or database content.
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const crypto = require('node:crypto');
const root = path.resolve(__dirname, '../..');
const out = path.join(root, '.recovery', process.argv[2] || new Date().toISOString().replace(/[:.]/g, '-'));
if (path.dirname(out) !== path.join(root, '.recovery')) throw new Error('Invalid snapshot name');
fs.mkdirSync(path.join(root, '.recovery'), { recursive: true, mode: 0o700 });
fs.mkdirSync(out, { recursive: false, mode: 0o700 });
try {
  const ref = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
  execFileSync('git', ['archive', '--format=tar', `--output=${path.join(out, 'source.tar')}`, ref], { cwd: root });
  execFileSync('git', ['bundle', 'create', path.join(out, 'history.bundle'), '--all'], { cwd: root });
  fs.writeFileSync(path.join(out, 'working.patch'), execFileSync('git', ['diff', '--binary', 'HEAD'], { cwd: root }), { mode: 0o600 });
  const untracked = execFileSync('git', ['ls-files', '--others', '--exclude-standard', '-z'], { cwd: root }).toString().split('\0').filter(Boolean);
  if (untracked.length) execFileSync('tar', ['-cf', path.join(out, 'untracked.tar'), '--', ...untracked], { cwd: root });
  for (const [src, name] of [['backend/.env', 'backend.env'], ['frontend/.env.local', 'frontend.env']]) {
    if (fs.existsSync(path.join(root, src))) fs.copyFileSync(path.join(root, src), path.join(out, name));
  }
  const config = fs.existsSync(path.join(out, 'backend.env')) ? require('dotenv').parse(fs.readFileSync(path.join(out, 'backend.env'))) : {};
  const dbPath = process.env.DB_PATH ? path.resolve(process.env.DB_PATH) : path.resolve(root, 'backend', config.DB_PATH || 'soloverse.db');
  if (fs.existsSync(dbPath)) {
    execFileSync('sqlite3', [dbPath, `.backup '${path.join(out, 'soloverse.db').replace(/'/g, "''")}'`], { stdio: 'pipe' });
    const integrity = execFileSync('sqlite3', [path.join(out, 'soloverse.db'), 'PRAGMA integrity_check'], { encoding: 'utf8' }).trim();
    if (integrity !== 'ok') throw new Error('Snapshot integrity check failed');
  }
  const hashes = {};
  for (const name of fs.readdirSync(out)) {
    fs.chmodSync(path.join(out, name), 0o600);
    hashes[name] = crypto.createHash('sha256').update(fs.readFileSync(path.join(out, name))).digest('hex');
  }
  fs.writeFileSync(path.join(out, 'manifest.json'), JSON.stringify({ ref, createdAt: new Date().toISOString(), node: process.version, dbCaptured: fs.existsSync(path.join(out, 'soloverse.db')), hashes }, null, 2), { mode: 0o600 });
  console.log(`Snapshot verified: ${path.relative(root, out)}; commit ${ref}`);
} catch (_) {
  console.error('Snapshot failed. Partial directory retained; do not use it without a valid manifest.');
  process.exitCode = 1;
}
