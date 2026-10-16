const express = require('express');
const { hashPassword, verifyPassword } = require('../services/passwords');
const { v4: uuidv4 } = require('uuid');
const { db } = require('../db/schema');
const { authMiddleware, generateToken } = require('../middleware/auth');
const { isAdminUser } = require('../middleware/admin');
const { sessionId, touchSession, revokeSession } = require('../services/generationActivity');

const { resetsOnLogout, resetDemoWorld } = require('../services/demoReset');

const router = express.Router();

// シンプルなインメモリレートリミッター（express-rate-limitなしで実装）
const loginAttempts = new Map(); // key: IP, value: { count, resetAt }
const RATE_LIMIT_WINDOW = 15 * 60 * 1000; // 15分
const RATE_LIMIT_MAX = 10; // 15分に10回まで

async function checkRateLimit(ip) {
  if (process.env.SOLOVERSE_RUNTIME === 'cloudflare') {
    const { createHash } = require('node:crypto');
    const key = createHash('sha256').update(String(ip)).digest('hex');
    const now = Date.now();
    const result = await db.execute({ sql: `INSERT INTO login_rate_limits(key,count,reset_at) VALUES(?,1,?) ON CONFLICT(key) DO UPDATE SET count=CASE WHEN reset_at<=? THEN 1 ELSE count+1 END,reset_at=CASE WHEN reset_at<=? THEN excluded.reset_at ELSE reset_at END RETURNING count`, args: [key, now+RATE_LIMIT_WINDOW,now,now] });
    return result.rows[0].count <= RATE_LIMIT_MAX;
  }
  const now = Date.now();
  const record = loginAttempts.get(ip);
  if (!record || now > record.resetAt) {
    loginAttempts.set(ip, { count: 1, resetAt: now + RATE_LIMIT_WINDOW });
    return true;
  }
  if (record.count >= RATE_LIMIT_MAX) return false;
  record.count++;
  return true;
}

// 新規登録
router.post('/register', async (req, res) => {
  if (process.env.REGISTRATION_CLOSED === 'true') return res.status(403).json({ error: 'このサイトは個人利用専用です。新規登録は受け付けていません。' });
  const ip = req.ip || req.connection.remoteAddress;
  if (!await checkRateLimit(ip)) {
    return res.status(429).json({ error: 'リクエストが多すぎます。15分後に再試行してください。' });
  }

  const email = typeof req.body.email === 'string' ? req.body.email.trim().toLowerCase() : '';
  const password = typeof req.body.password === 'string' ? req.body.password : '';
  const username = typeof req.body.username === 'string' ? req.body.username.trim() : '';
  if (!email || !password || !username) {
    return res.status(400).json({ error: '全項目を入力してください' });
  }
  if (!/^\S+@\S+\.\S+$/.test(email) || email.length > 254) {
    return res.status(400).json({ error: '有効なメールアドレスを入力してください' });
  }
  if (password.length < 8) {
    return res.status(400).json({ error: 'パスワードは8文字以上にしてください' });
  }
  if (password.length > 128) return res.status(400).json({ error: 'パスワードは128文字以内にしてください' });
  if (username.length > 30) return res.status(400).json({ error: 'ユーザー名は30文字以内にしてください' });
  try {
    const existing = await db.execute({
      sql: 'SELECT id FROM users WHERE email = ?',
      args: [email]
    });
    if (existing.rows.length > 0) {
      return res.status(409).json({ error: 'このメールアドレスは既に使用されています' });
    }
    const hash = await hashPassword(password);
    const id = uuidv4();
    await db.execute({
      sql: 'INSERT INTO users (id, email, password_hash, username) VALUES (?, ?, ?, ?)',
      args: [id, email, hash, username]
    });
    const token = generateToken(id);
    await touchSession(id, sessionId(token));
    res.json({ token, userId: id, username, onboardingDone: false });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'サーバーエラー' });
  }
});

// ログイン
async function login(req, res, adminLogin = false) {
  const ip = req.ip || req.connection.remoteAddress;
  if (!await checkRateLimit(ip)) {
    return res.status(429).json({ error: 'リクエストが多すぎます。15分後に再試行してください。' });
  }

  const email = typeof req.body.email === 'string' ? req.body.email.trim().toLowerCase() : '';
  const password = typeof req.body.password === 'string' ? req.body.password : '';
  if (!email || !password) {
    return res.status(400).json({ error: 'メールとパスワードを入力してください' });
  }
  if (email.length > 254 || password.length > 128) return res.status(400).json({ error: '入力が長すぎます' });
  try {
    const result = await db.execute({
      sql: 'SELECT * FROM users WHERE email = ?',
      args: [email]
    });
    const user = result.rows[0];
    if (!user) return res.status(401).json({ error: 'メールアドレスまたはパスワードが違います' });

    const valid = await verifyPassword(password, user.password_hash, req.body.passwordFormat);
    if (!valid) return res.status(401).json({ error: 'メールアドレスまたはパスワードが違います' });

    if (process.env.SOLOVERSE_RUNTIME === 'cloudflare' && !isAdminUser(user.id)) return res.status(403).json({ error: 'このサイトは個人利用専用です' });
    if (adminLogin && !isAdminUser(user.id)) return res.status(403).json({ error: '管理者として許可されたアカウントを使用してください' });
    const token = generateToken(user.id, adminLogin ? 'admin' : 'user');
    if (!adminLogin) await touchSession(user.id, sessionId(token));
    res.json({
      token,
      userId: user.id,
      username: user.username,
      onboardingDone: !!user.onboarding_done,
      resetOnLogout: resetsOnLogout(user.id, adminLogin ? 'admin' : 'user'),
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'サーバーエラー' });
  }
}
router.post('/login', (req, res) => login(req, res));
router.post('/admin/login', (req, res) => login(req, res, true));

// Visibility is reported by the client; this route never generates content.
router.post('/activity', authMiddleware, (_, res) => res.json({ success: true }));
router.post('/logout', authMiddleware, async (req, res) => {
  try {
    const reset = resetsOnLogout(req.userId, req.tokenScope);
    if (reset && req.body?.confirmDemoReset !== true) {
      return res.status(409).json({ error: 'ログアウトすると今回の体験が削除されます。確認してから再実行してください', code: 'DEMO_RESET_CONFIRMATION_REQUIRED' });
    }
    if (reset) await resetDemoWorld(req.userId, req.sessionId);
    else await revokeSession(req.userId, req.sessionId);
    res.json({ success: true, worldReset: reset });
  } catch (error) {
    if (error.code === 'WORLD_BUSY') return res.status(409).json({ error: error.message, code: error.code });
    console.error('Logout error:', error.message);
    res.status(500).json({ error: 'ログアウト処理に失敗しました' });
  }
});

// localStorageの表示情報を信頼せず、現在のセッション状態をDBから再取得する。
router.get('/me', authMiddleware, async (req, res) => {
  try {
    const result = await db.execute({
      sql: 'SELECT id, username, onboarding_done FROM users WHERE id = ?',
      args: [req.userId],
    });
    const user = result.rows[0];
    res.json({
      userId: user.id,
      username: user.username,
      onboardingDone: Boolean(user.onboarding_done),
      resetOnLogout: resetsOnLogout(user.id, req.tokenScope),
    });
  } catch (e) {
    console.error('Session error:', e);
    res.status(500).json({ error: 'セッション確認に失敗しました' });
  }
});

module.exports = router;
