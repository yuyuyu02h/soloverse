const express = require('express');
const { db } = require('../db/schema');
const { authMiddleware: authenticate } = require('../middleware/auth');
const { generateAICharacters, resolveFollowerScale } = require('../services/worldGenerator');
const { isLLMConfigured } = require('../services/llm');
const { generateAITimelinePosts } = require('../services/reactionScheduler');
const { serializeWorldTask } = require('../services/worldTasks');
const { themeState, currentVersion } = require('../services/worldTheme');

const { readSetup } = require('../services/worldModes');

const router = express.Router();

router.post('/submit', authenticate, async (req, res) => {
  const { atmosphere, exclusions } = req.body;
  let setup;
  try { setup = readSetup(req.body); }
  catch (error) { return res.status(400).json({ error: error.message }); }
  const { position, interests: interestsStr } = setup;
  const userId = req.userId;

  const validAtmospheres = new Set(['calm', 'active', 'village', 'vent']);
  const validExclusions = new Set(['no_criticism', 'no_politics', 'no_comparison']);
  const exclusionsArr = Array.isArray(exclusions)
    ? [...new Set(exclusions.filter(value => validExclusions.has(value)))]
    : [];

  if (!validAtmospheres.has(atmosphere)) {
    return res.status(400).json({ error: '必須項目が不足しています' });
  }
  if (interestsStr.length > 300) return res.status(400).json({ error: '興味・関心は300字以内にしてください' });
  if (!isLLMConfigured()) return res.status(503).json({ error: 'LLM APIが未設定です。管理者に連絡してください' });

  try {
    await serializeWorldTask(userId, async () => {
      if (await require('../services/generationActivity').isSessionRevoked(req.sessionId)) {
        return res.status(401).json({ error: 'ログアウト済みです。再度ログインしてください', code: 'SESSION_REVOKED' });
      }
      await themeState(req.userId);
      // ユーザーが実際に存在するか確認（外部キー制約エラーを防ぐ）
      const userResult = await db.execute({
        sql: 'SELECT id, onboarding_done FROM users WHERE id = ?',
        args: [userId],
      });

      if (userResult.rows.length === 0) {
        return res.status(401).json({ error: 'ユーザーが見つかりません。再ログインしてください。' });
      }

      if (userResult.rows[0].onboarding_done) {
        return res.status(409).json({ error: '既にオンボーディングが完了しています' });
      }

      const exclusionsStr = exclusionsArr.join(',');
      const followerScale = resolveFollowerScale(position);

      // 外部APIが失敗したとき中途半端な世界設定を残さないよう、先に生成する。
      const characters = await generateAICharacters({
        position,
        interests: interestsStr,
        atmosphere,
        exclusions: exclusionsArr,
        userId,
      });

      const statements = [{
        sql: `INSERT OR REPLACE INTO world_settings
              (user_id, position, interests, atmosphere, exclusions, follower_scale)
              VALUES (?, ?, ?, ?, ?, ?)`,
        args: [userId, position, interestsStr, atmosphere, exclusionsStr, followerScale],
      }];
      for (const c of characters) {
        statements.push({
          sql: `INSERT INTO ai_characters
                (id, user_id, name, username, avatar_seed, bio, personality, interests, reply_style, reaction_frequency, delay_profile, participation_role)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          args: [
            c.id, c.user_id, c.name, c.username, c.avatar_seed,
            c.bio || '', c.personality, c.interests,
            c.reply_style, c.reaction_frequency, c.delay_profile, c.participation_role
          ],
        });
      }
      statements.push({
        sql: 'UPDATE users SET onboarding_done = 1 WHERE id = ?',
        args: [userId],
      });
      statements.push({
        sql: `INSERT INTO autonomous_log (user_id, last_autonomous_at, last_trend_at, last_growth_at)
              VALUES (?, datetime('now'), datetime('now'), datetime('now'))
              ON CONFLICT(user_id) DO NOTHING`, args: [userId],
      });
      await db.batch(statements, 'write');

      res.json({ success: true, characterCount: characters.length, mode: setup.mode });
    });
  } catch (e) {
    console.error('Onboarding error:', e);
    res.status(500).json({
      error: '世界の生成に失敗しました',
      ...(process.env.NODE_ENV === 'development' ? { detail: e.message } : {}),
    });
  }
});

// 世界設定確認
router.get('/world', authenticate, async (req, res) => {
  try {
    const settings = await themeState(req.userId);
    const characters = await db.execute({
      sql: `SELECT * FROM ai_characters c WHERE user_id = ? AND ${currentVersion('c')}`,
      args: [req.userId],
    });
    const themes = (await db.execute({ sql: 'SELECT theme_version,COUNT(*) AS post_count FROM posts WHERE user_id=? GROUP BY theme_version ORDER BY theme_version DESC', args: [req.userId] })).rows;
    res.json({ settings, characters: characters.rows, themes });
  } catch (e) {
    res.status(500).json({ error: 'サーバーエラー' });
  }
});

// A theme change archives the previous world; it never deletes posts or characters.
router.post('/theme', authenticate, async (req, res) => {
  try {
    const result = await serializeWorldTask(req.userId, async () => {
      const settings = await themeState(req.userId);
      if (!settings) return { status: 409, error: '世界設定がまだ作成されていません' };
      let setup;
      try { setup = readSetup(req.body, settings); }
      catch (error) { return { status: 400, error: error.message }; }
      const { interests, position } = setup;
      if (interests === settings.interests && position === settings.position) {
        const count = (await db.execute({ sql: `SELECT COUNT(*) n FROM ai_characters c WHERE user_id=? AND ${currentVersion('c')}`, args: [req.userId] })).rows[0].n;
        if (count >= 3) return { success: true, unchanged: true, theme: interests, mode: setup.mode };
      }
      if (!isLLMConfigured()) return { status: 503, error: 'LLM APIが未設定です' };
      const characters = await generateAICharacters({ ...settings, position, interests, exclusions: String(settings.exclusions || '').split(',').filter(Boolean), userId: req.userId });
      const version = settings.theme_version + 1;
      const now = new Date().toISOString();
      await db.batch([
        { sql: 'UPDATE world_settings SET interests=?,position=?,follower_scale=? WHERE user_id=?', args: [interests, position, resolveFollowerScale(position), req.userId] },
        { sql: 'UPDATE world_theme_state SET theme=?,version=?,changed_at=?,position=? WHERE user_id=?', args: [interests, version, now, position, req.userId] },
        { sql: "UPDATE content_candidates SET state='discarded' WHERE user_id=? AND state='pending'", args: [req.userId] },
        { sql: 'UPDATE reaction_queue SET done=1 WHERE user_id=? AND done=0', args: [req.userId] },
        { sql: 'INSERT INTO content_pool_state(user_id,next_fill_at,theme_version) VALUES(?,?,?) ON CONFLICT(user_id) DO UPDATE SET next_fill_at=excluded.next_fill_at,theme_version=excluded.theme_version', args: [req.userId, now, version] },
        ...characters.map(c => ({ sql: 'INSERT INTO ai_characters(id,user_id,name,username,avatar_seed,bio,personality,interests,reply_style,reaction_frequency,delay_profile,theme_version,participation_role) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)', args: [c.id, req.userId, c.name, c.username, c.avatar_seed, c.bio, c.personality, c.interests, c.reply_style, c.reaction_frequency, c.delay_profile, version, c.participation_role] })),
        { sql: `INSERT INTO autonomous_log(user_id,last_autonomous_at,last_trend_at,last_growth_at) VALUES(?,?,?,?) ON CONFLICT(user_id) DO UPDATE SET last_autonomous_at=excluded.last_autonomous_at,last_trend_at=excluded.last_trend_at,last_growth_at=excluded.last_growth_at`, args: [req.userId, now, now, now] },
      ], 'write');
      return { success: true, theme: interests, themeVersion: version, characterCount: characters.length, mode: setup.mode };
    });
    if (result.status) return res.status(result.status).json({ error: result.error });
    res.json(result);
  } catch (error) {
    console.error('Theme change error:', error.message);
    res.status(503).json({ error: '新しいテーマの準備に失敗しました。現在のテーマと投稿は保持されています' });
  }
});

// アカウントとユーザー投稿を残し、AI住人とAI生成データだけを作り直す。
router.post('/regenerate', authenticate, async (req, res) => {
  const userId = req.userId;
  if (!isLLMConfigured()) return res.status(503).json({ error: 'LLM APIが未設定です。管理者に連絡してください' });

  try {
    const settings = await themeState(userId);
    if (!settings) return res.status(409).json({ error: '世界設定がまだ作成されていません' });

    // 新しい住人を先に生成し、API失敗時に現在の世界を失わないようにする。
    const characters = await generateAICharacters({
      position: settings.position,
      interests: settings.interests,
      atmosphere: settings.atmosphere,
      exclusions: String(settings.exclusions || '').split(',').filter(Boolean),
      userId,
    });

    await serializeWorldTask(userId, async () => {
      if ((await themeState(userId)).theme_version !== settings.theme_version) throw new Error('テーマが変更されました。再度お試しください');
      const statements = [
        { sql: `DELETE FROM celebrity_scenes WHERE user_id = ? AND post_id IN (SELECT id FROM posts p WHERE ${currentVersion('p')})`, args: [userId] },
        { sql: 'DELETE FROM content_candidates WHERE user_id = ? AND theme_version=?', args: [userId,settings.theme_version] },
        { sql: 'DELETE FROM content_pool_state WHERE user_id = ?', args: [userId] },
        { sql: 'DELETE FROM reaction_queue WHERE user_id = ? AND theme_version=?', args: [userId,settings.theme_version] },
        { sql: 'DELETE FROM notifications WHERE user_id = ?', args: [userId] },
        { sql: "DELETE FROM likes WHERE user_id = ? AND liker_type = 'ai'", args: [userId] },
        {
          sql: `WITH RECURSIVE removed(id) AS (
                  SELECT id FROM posts WHERE user_id = ? AND theme_version=? AND author_type = 'ai'
                  UNION
                  SELECT child.id FROM posts child JOIN removed parent ON child.reply_to = parent.id
                  WHERE child.user_id = ?
                )
                DELETE FROM posts WHERE id IN (SELECT id FROM removed)`,
          args: [userId,settings.theme_version, userId],
        },
        { sql: 'DELETE FROM trends WHERE user_id = ?', args: [userId] },
        { sql: 'DELETE FROM character_growth_log WHERE user_id = ?', args: [userId] },
        { sql: 'DELETE FROM ai_characters WHERE user_id = ? AND theme_version=?', args: [userId,settings.theme_version] },
      ];
      for (const c of characters) {
        statements.push({
          sql: `INSERT INTO ai_characters
                (id, user_id, name, username, avatar_seed, bio, personality, interests, reply_style, reaction_frequency, delay_profile,theme_version,participation_role)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,?,?)`,
          args: [
            c.id, c.user_id, c.name, c.username, c.avatar_seed,
            c.bio || '', c.personality, c.interests, c.reply_style,
            c.reaction_frequency, c.delay_profile, settings.theme_version, c.participation_role,
          ],
        });
      }
      statements.push({
        sql: `INSERT INTO autonomous_log (user_id, last_autonomous_at, last_trend_at, last_growth_at)
              VALUES (?, datetime('now'), datetime('now'), datetime('now'))
              ON CONFLICT(user_id) DO UPDATE SET
                last_autonomous_at = datetime('now'),
                last_trend_at = datetime('now'),
                last_growth_at = datetime('now')`,
        args: [userId],
      });
      await db.batch(statements, 'write');
    });

    // The client already starts /timeline/seed after rebuilding. Keep the
    // resident replacement and post generation in separate Worker requests.
    if (process.env.SOLOVERSE_RUNTIME === 'cloudflare') {
      return res.json({ success: true, characterCount: characters.length, seedCount: 0, seedPending: true, warning: null });
    }

    let seedCount = 0;
    let warning = null;
    try {
      seedCount = await generateAITimelinePosts(userId) || 0;
    } catch (e) {
      warning = '住人は更新しましたが、初期投稿の生成に失敗しました。タイムラインを再読み込みすると再試行できます';
      console.warn(`[Regenerate] Seed failed for ${userId}:`, e.message);
    }
    res.json({ success: true, characterCount: characters.length, seedCount, warning });
  } catch (e) {
    console.error('Regenerate error:', e);
    res.status(500).json({
      error: 'AI住人の作り直しに失敗しました。現在の世界は変更されていません',
      ...(process.env.NODE_ENV === 'development' ? { detail: e.message } : {}),
    });
  }
});

module.exports = router;
