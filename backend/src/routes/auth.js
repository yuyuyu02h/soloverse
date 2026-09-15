const express = require('express');
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');
const { db } = require('../db/schema');
const { authMiddleware, generateToken } = require('../middleware/auth');

const router = express.Router();

// シンプルなインメモリレートリミッター（express-rate-limitなしで実装）
const loginAttempts = new Map(); // key: IP, value: { count, resetAt }
const RATE_LIMIT_WINDOW = 15 * 60 * 1000; // 15分
const RATE_LIMIT_MAX = 10; // 15分に10回まで

function checkRateLimit(ip) {
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
  const ip = req.ip || req.connection.remoteAddress;
  if (!checkRateLimit(ip)) {
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
    const hash = await bcrypt.hash(password, 10);
    const id = uuidv4();
    await db.execute({
      sql: 'INSERT INTO users (id, email, password_hash, username) VALUES (?, ?, ?, ?)',
      args: [id, email, hash, username]
    });
    const token = generateToken(id);
    res.json({ token, userId: id, username, onboardingDone: false });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'サーバーエラー' });
  }
});

// ログイン
router.post('/login', async (req, res) => {
  const ip = req.ip || req.connection.remoteAddress;
  if (!checkRateLimit(ip)) {
    return res.status(429).json({ error: 'リクエストが多すぎます。15分後に再試行してください。' });
  }

  const email = typeof req.body.email === 'string' ? req.body.email.trim().toLowerCase() : '';
  const password = typeof req.body.password === 'string' ? req.body.password : '';
  if (!email || !password) {
    return res.status(400).json({ error: 'メールとパスワードを入力してください' });
  }
  try {
    const result = await db.execute({
      sql: 'SELECT * FROM users WHERE email = ?',
      args: [email]
    });
    const user = result.rows[0];
    if (!user) return res.status(401).json({ error: 'メールアドレスまたはパスワードが違います' });

    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) return res.status(401).json({ error: 'メールアドレスまたはパスワードが違います' });

    const token = generateToken(user.id);
    res.json({
      token,
      userId: user.id,
      username: user.username,
      onboardingDone: !!user.onboarding_done
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'サーバーエラー' });
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
    });
  } catch (e) {
    console.error('Session error:', e);
    res.status(500).json({ error: 'セッション確認に失敗しました' });
  }
});

module.exports = router;
