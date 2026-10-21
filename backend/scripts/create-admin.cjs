// Creates the explicitly requested local admin and keeps its credentials outside Git.
const fs = require('node:fs');
const path = require('node:path');
const { randomBytes, randomUUID } = require('node:crypto');
const bcrypt = require('bcryptjs');
const root = path.resolve(__dirname, '../..');
const envPath = path.join(root, 'backend/.env');
require('dotenv').config({ path: envPath, quiet: true });
const privateDir = path.join(root, '.private');
const credentialsPath = path.join(privateDir, 'ADMIN_CREDENTIALS.md');
const { db, initDB } = require('../src/db/schema');

async function main() {
  fs.mkdirSync(privateDir, { recursive: true, mode: 0o700 });
  fs.chmodSync(privateDir, 0o700);
  const previous = fs.existsSync(credentialsPath) ? fs.readFileSync(credentialsPath, 'utf8') : '';
  const email = previous.match(/^- メールアドレス: `([^`]+)`/m)?.[1] || 'admin@soloverse.test';
  const password = previous.match(/^- パスワード: `([^`]+)`/m)?.[1] || `Sv!${randomBytes(18).toString('base64url')}`;
  await initDB();
  const existing = (await db.execute({ sql: 'SELECT id,password_hash FROM users WHERE email=?', args: [email] })).rows[0];
  if (existing && (!previous || !await bcrypt.compare(password, existing.password_hash))) throw new Error('既存アカウントと保存済み認証情報が一致しません。上書きせず停止します。');
  const id = existing?.id || randomUUID();
  if (!existing) await db.execute({ sql: 'INSERT INTO users(id,email,password_hash,username) VALUES(?,?,?,?)', args: [id,email,await bcrypt.hash(password,12),'SoloVerse管理者'] });
  let envText = fs.readFileSync(envPath, 'utf8');
  const parsed = require('dotenv').parse(envText);
  const ids = [...new Set([...String(parsed.ADMIN_USER_IDS || '').split(',').map(s=>s.trim()).filter(Boolean),id])];
  const line = `ADMIN_USER_IDS=${ids.join(',')}`;
  envText = /^ADMIN_USER_IDS=.*$/m.test(envText) ? envText.replace(/^ADMIN_USER_IDS=.*$/m,line) : `${envText.trimEnd()}\n${line}\n`;
  fs.writeFileSync(envPath,envText,{ mode:0o600 });
  fs.chmodSync(envPath,0o600);
  fs.writeFileSync(credentialsPath, `# SoloVerse 管理者ログイン情報（ローカル専用）\n\n- メールアドレス: \`${email}\`\n- パスワード: \`${password}\`\n- ユーザーID: \`${id}\`\n- 表示名: SoloVerse管理者\n- ローカル管理画面: http://localhost:3000/admin\n\nこのアカウントを今後の管理者ログインに使います。メールアドレスは仮の識別子で、受信できるメールボックスではありません。\n\nbackend/.env の ADMIN_USER_IDS に設定済みです。バックエンドを再起動して反映します。公開先にAPIとDBを用意する際は、この管理者だけを安全に登録して同じ情報を使用します。画面だけを公開するCloudflare版では、まだログインできません。\n\nこのファイルと .env はGit管理対象外です。公開サイト・GitHub・ビルド成果物に含めません。\n`, { mode:0o600 });
  fs.chmodSync(credentialsPath,0o600);
  console.log(JSON.stringify({ created:!existing,adminUserId:id,email,credentialsFile:credentialsPath,passwordPrinted:false }));
}
main().catch(error=>{ console.error(error.message);process.exitCode=1; }).finally(()=>db.close());
