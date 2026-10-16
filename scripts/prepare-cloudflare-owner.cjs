// Prepare only the explicitly selected admin account; never export its world.
const fs = require('node:fs');
const path = require('node:path');
const { randomBytes } = require('node:crypto');
process.env.SOLOVERSE_RUNTIME = 'cloudflare';
const { hashPassword } = require('../backend/src/services/passwords');
const root = path.resolve(__dirname,'..');
const dir = path.join(root,'.private');
const md = fs.readFileSync(path.join(dir,'ADMIN_CREDENTIALS.md'),'utf8');
function value(label) { const match=md.match(new RegExp(`^- ${label}: \x60([^\x60]+)\x60`,'m')); if(!match)throw Error('管理者情報が見つかりません'); return match[1]; }
const quote = value => "'"+String(value).replaceAll("'","''")+"'";
(async()=>{
  const email=value('メールアドレス'),password=value('パスワード'),id=value('ユーザーID');
  const hash=await hashPassword(password,email);
  fs.writeFileSync(path.join(dir,'cloudflare-owner.sql'),`INSERT OR IGNORE INTO users(id,email,password_hash,username,onboarding_done) VALUES(${[id,email,hash,'SoloVerse管理者'].map(quote).join(',')},0) ON CONFLICT(id) DO UPDATE SET password_hash=excluded.password_hash WHERE users.password_hash LIKE 'pbkdf2-sha256$600000$%';\n`,{mode:0o600});
  const secretsPath=path.join(dir,'cloudflare-server-secrets.json');
  const previous=fs.existsSync(secretsPath)?JSON.parse(fs.readFileSync(secretsPath,'utf8')):{};
  fs.writeFileSync(secretsPath,JSON.stringify({JWT_SECRET:previous.JWT_SECRET||randomBytes(48).toString('base64url'),ADMIN_USER_IDS:id}),{mode:0o600});
  fs.chmodSync(path.join(dir,'cloudflare-owner.sql'),0o600);fs.chmodSync(secretsPath,0o600);
  console.log('管理者1件だけのSQLとサーバー用秘密設定を.privateへ準備しました。AIキー・既存の世界データは含みません。');
})().catch(error=>{console.error(error.message);process.exitCode=1;});
