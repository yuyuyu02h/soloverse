const jwt = require('jsonwebtoken');
const { db } = require('../db/schema');

const JWT_SECRET = process.env.JWT_SECRET;
const KNOWN_WEAK_SECRETS = new Set(['change-me', 'soloverse-change-this-in-production']);
if (!JWT_SECRET || KNOWN_WEAK_SECRETS.has(JWT_SECRET)) {
  console.error('[FATAL] JWT_SECRET is not set. Set it in your .env file.');
  process.exit(1);
}
if (process.env.NODE_ENV === 'production' && JWT_SECRET.length < 32) {
  console.error('[FATAL] JWT_SECRET must be at least 32 characters in production.');
  process.exit(1);
}

// 簡易キャッシュ: 同じuserIdの存在チェックを毎リクエストDBに投げないようにする
// （開発中のDBリセット直後だけ無効化されればよいので、TTLは短めでOK）
const existsCache = new Map(); // userId -> { ok: boolean, expiresAt: number }
const CACHE_TTL = 30 * 1000;

async function userExists(userId) {
  const cached = existsCache.get(userId);
  if (cached && cached.expiresAt > Date.now()) return cached.ok;

  const result = await db.execute({ sql: 'SELECT 1 FROM users WHERE id = ?', args: [userId] });
  const ok = result.rows.length > 0;
  existsCache.set(userId, { ok, expiresAt: Date.now() + CACHE_TTL });
  return ok;
}

async function authMiddleware(req, res, next) {
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith('Bearer ')) {
    return res.status(401).json({ error: '認証が必要です', code: 'NO_TOKEN' });
  }
  try {
    const token = auth.split(' ')[1];
    const decoded = jwt.verify(token, JWT_SECRET);

    // JWTの署名・有効期限は正しくても、参照先のユーザーがDBに存在しない場合がある
    // （例: 開発中にDBだけリセットして古いトークンがブラウザに残っているケース）
    // この場合は通常の401と区別して案内し、フロント側で自動的にログアウト処理させる
    const ok = await userExists(decoded.userId);
    if (!ok) {
      return res.status(401).json({ error: 'セッションが無効です。再度ログインしてください', code: 'USER_NOT_FOUND' });
    }

    req.userId = decoded.userId;
    next();
  } catch {
    return res.status(401).json({ error: 'トークンが無効です', code: 'INVALID_TOKEN' });
  }
}

function generateToken(userId) {
  return jwt.sign({ userId }, JWT_SECRET, { expiresIn: '30d' });
}

module.exports = { authMiddleware, generateToken };
