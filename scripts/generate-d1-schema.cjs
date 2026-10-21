// Rebuild only an empty temporary database; never inspect/export local user data.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'soloverse-schema-'));
process.env.DB_PATH = path.join(dir, 'empty.db');
const { db, initDB } = require('../backend/src/db/schema');
(async () => {
  await initDB();
  const rows = (await db.execute("SELECT type,name,sql FROM sqlite_master WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' ORDER BY CASE type WHEN 'table' THEN 0 ELSE 1 END,name")).rows;
  const sql = rows.map(r => r.sql + ';').join('\n\n') + `\n\nCREATE TABLE deployment_locks(name TEXT PRIMARY KEY,owner TEXT NOT NULL,expires_at INTEGER NOT NULL);\nCREATE TABLE login_rate_limits(key TEXT PRIMARY KEY,count INTEGER NOT NULL,reset_at INTEGER NOT NULL);\n`;
  fs.writeFileSync(path.resolve(__dirname, '../cloudflare/migrations/0001_initial.sql'), '-- Empty schema only: contains no accounts, posts, credentials, or API keys.\n' + sql);
  db.close();
})().catch(error => { console.error(error.message); db.close(); process.exitCode=1; });
