const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { db } = require('../db/schema');
const { authMiddleware: authenticate } = require('../middleware/auth');
const { scheduleReactions, scheduleReplyReactions, generateAITimelinePosts } = require('../services/reactionScheduler');
const { themeState, currentVersion } = require('../services/worldTheme');
const { serializeWorldTask } = require('../services/worldTasks');
const {
  experienceMode,
  createCelebrityScene,
  decorateTimelinePosts,
  celebrityComments,
  celebrityNotificationState,
  setCelebrityNotificationsEnabled,
  markCelebrityNotificationsRead,
} = require('../services/celebrityMode');

const router = express.Router();

// Only the authenticated user's content metrics; no provider-wide account statistics.
router.get('/diagnostics', authenticate, async (req, res) => {
  try { res.json(await require('../services/llmRuntime').diagnostics(req.userId)); }
  catch (_) { res.status(500).json({ error: '診断情報を取得できませんでした' }); }
});

// ─── タイムライン取得（差分取得対応・リプライツリー付き）────
router.get('/', authenticate, async (req, res) => {
  const userId = req.userId;
  const parsedPage = Number.parseInt(String(req.query.page ?? '0'), 10);
  const page = Number.isFinite(parsedPage) && parsedPage >= 0 ? parsedPage : 0;
  const since = req.query.since; // 差分ポーリング用: ISO文字列
  const limit = 30;
  const offset = page * limit;

  try {
    const settings = await themeState(userId);
    let sql, args;

    if (since) {
      // 差分取得: since より新しい投稿のみ
      sql = `SELECT p.*,
              CASE WHEN p.author_type = 'ai' THEN ac.name    ELSE u.username END as author_name,
              CASE WHEN p.author_type = 'ai' THEN ac.username ELSE u.username END as author_handle,
              CASE WHEN p.author_type = 'ai' THEN ac.avatar_seed ELSE NULL END as avatar_seed,
              CASE WHEN p.author_type = 'ai' THEN ac.personality ELSE NULL END as personality,
              (SELECT COUNT(*) FROM likes WHERE post_id = p.id) as like_count,
              (SELECT COUNT(*) FROM posts r WHERE r.reply_to=p.id AND (r.deleted_at IS NULL OR EXISTS (SELECT 1 FROM posts child WHERE child.reply_to=r.id AND child.user_id=r.user_id))) as reply_count,
              (SELECT COUNT(*) FROM likes WHERE post_id = p.id AND liker_id = ?) as user_liked
            FROM posts p
            LEFT JOIN ai_characters ac ON p.author_type = 'ai'  AND p.author_id = ac.id
            LEFT JOIN users u          ON p.author_type = 'user' AND p.author_id = u.id
            WHERE p.user_id = ? AND p.reply_to IS NULL AND datetime(p.created_at) >= datetime(?)
            ORDER BY datetime(p.created_at) DESC, p.id DESC`;
      args = [userId, userId, since];
    } else {
      // 通常取得（ページネーション）
      sql = `SELECT p.*,
              CASE WHEN p.author_type = 'ai' THEN ac.name    ELSE u.username END as author_name,
              CASE WHEN p.author_type = 'ai' THEN ac.username ELSE u.username END as author_handle,
              CASE WHEN p.author_type = 'ai' THEN ac.avatar_seed ELSE NULL END as avatar_seed,
              CASE WHEN p.author_type = 'ai' THEN ac.personality ELSE NULL END as personality,
              (SELECT COUNT(*) FROM likes WHERE post_id = p.id) as like_count,
              (SELECT COUNT(*) FROM posts r WHERE r.reply_to=p.id AND (r.deleted_at IS NULL OR EXISTS (SELECT 1 FROM posts child WHERE child.reply_to=r.id AND child.user_id=r.user_id))) as reply_count,
              (SELECT COUNT(*) FROM likes WHERE post_id = p.id AND liker_id = ?) as user_liked
            FROM posts p
            LEFT JOIN ai_characters ac ON p.author_type = 'ai'  AND p.author_id = ac.id
            LEFT JOIN users u          ON p.author_type = 'user' AND p.author_id = u.id
            WHERE p.user_id = ? AND p.reply_to IS NULL
            ORDER BY datetime(p.created_at) DESC, p.id DESC
            LIMIT ? OFFSET ?`;
      args = [userId, userId, limit, offset];
    }

    // 同じ取得形式で、画面にある既存投稿のリアクションも再取得できる。
    if (typeof req.query.ids === 'string') {
      const ids = [...new Set(req.query.ids.split(',').filter(Boolean))];
      if (!ids.length || ids.length > 100) return res.status(400).json({ error: '投稿IDは1〜100件で指定してください' });
      sql = sql.slice(0, sql.indexOf('WHERE p.user_id = ?')) +
        `WHERE p.user_id = ? AND p.reply_to IS NULL AND p.id IN (SELECT value FROM json_each(?)) ORDER BY datetime(p.created_at) DESC, p.id DESC`;
      args = [userId, userId, JSON.stringify(ids)];
    } else if (req.query.before && req.query.beforeId) {
      sql = sql.slice(0, sql.indexOf('WHERE p.user_id = ?')) +
        `WHERE p.user_id = ? AND p.reply_to IS NULL
          AND (datetime(p.created_at) < datetime(?) OR (datetime(p.created_at) = datetime(?) AND p.id < ?))
         ORDER BY datetime(p.created_at) DESC, p.id DESC LIMIT ?`;
      args = [userId, userId, String(req.query.before), String(req.query.before), String(req.query.beforeId), limit];
    }
    sql = sql.replace('WHERE p.user_id = ?', `WHERE p.user_id = ? AND (p.deleted_at IS NULL OR EXISTS (SELECT 1 FROM posts child WHERE child.user_id=p.user_id AND child.reply_to=p.id) OR EXISTS (SELECT 1 FROM celebrity_comments c WHERE c.scene_post_id=p.id AND c.user_id=p.user_id))`);
    if (req.query.history !== 'true') sql = sql.replace('WHERE p.user_id = ?', `WHERE p.user_id = ? AND ${currentVersion('p')}`);
    const posts = await db.execute({ sql, args });
    const decoratedPosts = await decorateTimelinePosts(userId, posts.rows);

    // 各投稿の直近リプライを最大2件取得（プレビュー用）
    const postIds = decoratedPosts.map(p => p.id);
    let repliesMap = {};
    const audienceMap = await celebrityComments(userId, postIds, 2);

    const replyRows = postIds.length ? (await db.execute({
      sql: `SELECT * FROM (SELECT p.*,
        CASE WHEN p.author_type='ai' THEN ac.name ELSE u.username END AS author_name,
        CASE WHEN p.author_type='ai' THEN ac.username ELSE u.username END AS author_handle,
        CASE WHEN p.author_type='ai' THEN ac.avatar_seed ELSE NULL END AS avatar_seed,
        (SELECT COUNT(*) FROM likes WHERE post_id=p.id) AS like_count,
        (SELECT COUNT(*) FROM likes WHERE post_id=p.id AND liker_id=?) AS user_liked,
        ROW_NUMBER() OVER(PARTITION BY p.reply_to ORDER BY datetime(p.created_at) DESC,p.id DESC) AS preview_rank
        FROM posts p LEFT JOIN ai_characters ac ON p.author_type='ai' AND p.author_id=ac.id
        LEFT JOIN users u ON p.author_type='user' AND p.author_id=u.id
        WHERE p.user_id=? AND (p.deleted_at IS NULL OR EXISTS (SELECT 1 FROM posts child WHERE child.reply_to=p.id AND child.user_id=p.user_id)) AND p.reply_to IN (SELECT value FROM json_each(?))) WHERE preview_rank<=2`,
      args:[userId,userId,JSON.stringify(postIds)],
    })).rows : [];
    for (const pid of postIds) {
      const combined=[...replyRows.filter(p=>p.reply_to===pid),...(audienceMap.get(pid)||[])]
        .sort((a,b)=>new Date(a.created_at).getTime()-new Date(b.created_at).getTime()).slice(-2);
      if (combined.length) repliesMap[pid]=combined;
    }

    const enriched = decoratedPosts.map(p => ({
      ...p,
      archived: p.theme_version !== (settings?.theme_version || 1),
      reply_preview: repliesMap[p.id] || [],
    }));

    res.json({ posts: enriched, theme: settings?.interests || '', mode: settings?.mode || 'hobby', modeLabel: settings?.mode_label || '趣味共感モード', themeVersion: settings?.theme_version || 1 });
  } catch (e) {
    console.error('Timeline error:', e);
    res.status(500).json({ error: 'タイムライン取得に失敗しました' });
  }
});

// ─── 投稿作成 ──────────────────────────────────────────
router.post('/post', authenticate, async (req, res) => {
  const userId = req.userId;
  const { content, replyTo } = req.body;

  if (typeof content !== 'string' || content.trim().length === 0) return res.status(400).json({ error: '投稿内容が空です' });
  if (content.length > 140) return res.status(400).json({ error: '140字以内で入力してください' });
  if (replyTo != null && typeof replyTo !== 'string') return res.status(400).json({ error: '返信先が不正です' });

  try {
    return await serializeWorldTask(userId, async () => {
      const settings = await themeState(userId);
      const version = settings?.theme_version || 1;
      if (replyTo) {
        const target = await db.execute({
          sql: 'SELECT id,theme_version FROM posts WHERE id = ? AND user_id = ? AND deleted_at IS NULL',
          args: [replyTo, userId],
        });
        if (!target.rows.length) return res.status(404).json({ error: '返信先の投稿が見つかりません' });
        if (target.rows[0].theme_version !== version) return res.status(409).json({ error: '以前のテーマの投稿は閲覧専用です。現在のテーマで新しく投稿してください' });
      }

      if (!settings) return res.status(409).json({ error: '世界設定がありません。ログインし直して最初から始めてください' });
      const postId = uuidv4();
      const createdAt = new Date().toISOString();
      const user = await db.execute({ sql: 'SELECT username FROM users WHERE id = ?', args: [userId] });

      await db.execute({
        sql: `INSERT INTO posts (id, user_id, author_id, author_type, content, reply_to, created_at, ai,theme_version) VALUES (?, ?, ?, 'user', ?, ?, ?, 0,?)`,
        args: [postId, userId, userId, content.trim(), replyTo || null, createdAt,version],
      });

      let scheduled = null;
      let initialLikeCount = 0;
      let initialReplyCount = 0;
      const mode = await experienceMode(userId);
      if (!replyTo) {
        // admired は個別住人を大量に作らず、観客全体の演出を別経路で準備する。
        try {
          if (mode === 'celebrity') {
            scheduled = await createCelebrityScene(userId, postId, content.trim(), createdAt);
            await scheduleReactions(userId, postId, content.trim());
            initialLikeCount = scheduled.likeCount;
            initialReplyCount = scheduled.commentCount;
          } else {
            scheduled = await scheduleReactions(userId, postId, content.trim());
          }
        } catch (e) {
          // 投稿自体は保存済みなので、リアクション予約だけの失敗で投稿を500にしない。
          console.error('Schedule error:', e);
        }
      } else {
        scheduled = await scheduleReplyReactions(userId, postId, content.trim(), replyTo);
      }

      res.json({
        success: true,
        scheduled,
        post: {
          id: postId, user_id: userId, author_id: userId, author_type: 'user',
          content: content.trim(), reply_to: replyTo || null,
          author_name: user.rows[0]?.username || 'あなた',
          author_handle: user.rows[0]?.username || 'you',
          experience_mode: mode,
          like_count: initialLikeCount, reply_count: initialReplyCount, user_liked: 0,
          reply_preview: [],
          created_at: createdAt, theme_version: version,
        },
      });
    });
  } catch (e) {
    if (e.code === 'WORLD_BUSY') return res.status(409).json({ error: e.message, code: e.code, retryAt: e.retryAt });
    console.error('Post error:', e);
    res.status(500).json({ error: '投稿に失敗しました' });
  }
});

// Erase only the owner's text. Keep a tombstone so existing replies stay connected.
router.delete('/post/:postId', authenticate, async (req, res) => {
  try {
    return await serializeWorldTask(req.userId, async () => {
      const post = (await db.execute({ sql: 'SELECT author_id,author_type,deleted_at FROM posts WHERE id=? AND user_id=?', args: [req.params.postId,req.userId] })).rows[0];
      if (!post) return res.status(404).json({ error: '投稿が見つかりません' });
      if (post.author_type !== 'user' || post.author_id !== req.userId) return res.status(403).json({ error: '自分の投稿のみ削除できます' });
      if (!post.deleted_at) await db.batch([
        { sql: 'UPDATE posts SET content=\'\',deleted_at=? WHERE id=? AND user_id=? AND author_id=? AND author_type=\'user\'', args: [new Date().toISOString(),req.params.postId,req.userId,req.userId] },
        { sql: 'UPDATE reaction_queue SET done=1 WHERE post_id=? AND user_id=?', args: [req.params.postId,req.userId] },
        { sql: "UPDATE content_candidates SET state='discarded' WHERE parent_id=? AND user_id=? AND state='pending'", args: [req.params.postId,req.userId] },
        { sql: 'DELETE FROM likes WHERE post_id=? AND user_id=?', args: [req.params.postId,req.userId] },
        { sql: 'DELETE FROM notifications WHERE post_id=? AND user_id=?', args: [req.params.postId,req.userId] },
        { sql: 'DELETE FROM resident_memory WHERE post_id=? AND user_id=?', args: [req.params.postId,req.userId] },
        { sql: "UPDATE celebrity_scenes SET status='ready' WHERE post_id=? AND user_id=?", args: [req.params.postId,req.userId] },
        { sql: "DELETE FROM celebrity_comments WHERE scene_post_id=? AND user_id=? AND datetime(created_at)>datetime('now')", args: [req.params.postId,req.userId] },
      ], 'write');
      res.json({ success: true, postId: req.params.postId });
    });
  } catch (error) {
    if (error.code === 'WORLD_BUSY') return res.status(409).json({ error: error.message, code: error.code });
    console.error('Delete post error:', error.message);
    res.status(500).json({ error: '投稿を削除できませんでした' });
  }
});

// ─── いいね ────────────────────────────────────────────
router.post('/like/:postId', authenticate, async (req, res) => {
  const userId = req.userId;
  const { postId } = req.params;
  try {
    const target = await db.execute({
      sql: 'SELECT id FROM posts WHERE id = ? AND user_id = ? AND deleted_at IS NULL', args: [postId, userId],
    });
    if (!target.rows.length) return res.status(404).json({ error: '投稿が見つかりません' });

    const existing = await db.execute({
      sql: 'SELECT id FROM likes WHERE post_id = ? AND liker_id = ?', args: [postId, userId],
    });
    if (existing.rows.length > 0) {
      await db.execute({ sql: 'DELETE FROM likes WHERE post_id = ? AND liker_id = ?', args: [postId, userId] });
      res.json({ liked: false });
    } else {
      await db.execute({
        sql: `INSERT INTO likes (id, user_id, post_id, liker_id, liker_type, ai) VALUES (?, ?, ?, ?, 'user', 0)`,
        args: [uuidv4(), userId, postId, userId],
      });
      res.json({ liked: true });
    }
  } catch (e) { res.status(500).json({ error: 'いいねに失敗しました' }); }
});

// ─── リプライ一覧取得 ──────────────────────────────────
router.get('/replies/:postId', authenticate, async (req, res) => {
  const userId = req.userId;
  const { postId } = req.params;
  try {
    const root = await db.execute({
      sql: 'SELECT id FROM posts WHERE id = ? AND user_id = ?', args: [postId, userId],
    });
    if (!root.rows.length) return res.status(404).json({ error: '投稿が見つかりません' });

    const replies = await db.execute({
      sql: `WITH RECURSIVE thread(id, depth) AS (
              SELECT id, 0 FROM posts WHERE reply_to = ? AND user_id = ?
              UNION ALL
              SELECT child.id, thread.depth + 1
              FROM posts child JOIN thread ON child.reply_to = thread.id
            WHERE child.user_id = ? AND thread.depth < 20
            )
            SELECT p.*,
              thread.depth,
              CASE WHEN p.author_type = 'ai' THEN ac.name    ELSE u.username END as author_name,
              CASE WHEN p.author_type = 'ai' THEN ac.username ELSE u.username END as author_handle,
              CASE WHEN p.author_type = 'ai' THEN ac.avatar_seed ELSE NULL END as avatar_seed,
              (SELECT COUNT(*) FROM likes WHERE post_id = p.id) as like_count,
              (SELECT COUNT(*) FROM likes WHERE post_id = p.id AND liker_id = ?) as user_liked
            FROM thread JOIN posts p ON p.id = thread.id
            LEFT JOIN ai_characters ac ON p.author_type = 'ai'  AND p.author_id = ac.id
            LEFT JOIN users u          ON p.author_type = 'user' AND p.author_id = u.id
            WHERE p.deleted_at IS NULL OR EXISTS (SELECT 1 FROM posts child WHERE child.reply_to=p.id AND child.user_id=p.user_id)
            ORDER BY datetime(p.created_at) ASC, thread.depth ASC, p.id ASC`,
      args: [postId, userId, userId, userId],
    });
    const audience = await celebrityComments(userId, [postId], 150);
    const combined = [...replies.rows, ...(audience.get(postId) || [])]
      .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
    res.json({ replies: combined });
  } catch (e) { res.status(500).json({ error: 'リプライ取得に失敗しました' }); }
});

// ─── 通知 ──────────────────────────────────────────────
router.get('/notifications', authenticate, async (req, res) => {
  const userId = req.userId;
  try {
    const notifs = await db.execute({
      sql: `SELECT n.*, ac.name as character_name, ac.username as character_handle, ac.avatar_seed,
              p.content as post_content
            FROM notifications n
            LEFT JOIN ai_characters ac ON n.character_id = ac.id
            LEFT JOIN posts p ON n.post_id = p.id
            WHERE n.user_id = ?
            ORDER BY datetime(n.created_at) DESC, n.id DESC LIMIT 50`,
      args: [userId],
    });
    const celebrity = await celebrityNotificationState(userId);
    const all = [...notifs.rows, ...celebrity.notifications]
      .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime() || b.id.localeCompare(a.id))
      .slice(0, 50);
    const normalUnread = await db.execute({ sql: 'SELECT COUNT(*) AS count FROM notifications WHERE user_id=? AND read=0', args: [userId] });
    const unreadCount = Number(normalUnread.rows[0]?.count || 0) + celebrity.unreadCount;
    await db.execute({ sql: 'UPDATE notifications SET read = 1 WHERE user_id = ? AND read = 0', args: [userId] });
    await markCelebrityNotificationsRead(userId);
    res.json({ notifications: all, unreadCount, celebrityNotificationsEnabled: celebrity.enabled, celebrityMode: (await experienceMode(userId)) === 'celebrity' });
  } catch (e) { res.status(500).json({ error: '通知取得に失敗しました' }); }
});

router.get('/notifications/unread-count', authenticate, async (req, res) => {
  const userId = req.userId;
  try {
    const result = await db.execute({
      sql: 'SELECT COUNT(*) as count FROM notifications WHERE user_id = ? AND read = 0', args: [userId],
    });
    const celebrity = await celebrityNotificationState(userId);
    res.json({ count: Number(result.rows[0]?.count || 0) + celebrity.unreadCount, celebrityNotificationsEnabled: celebrity.enabled });
  } catch (_) { res.json({ count: 0 }); }
});

router.post('/notifications/celebrity-settings', authenticate, async (req, res) => {
  if (typeof req.body?.enabled !== 'boolean') return res.status(400).json({ error: '通知設定が不正です' });
  try {
    await setCelebrityNotificationsEnabled(req.userId, req.body.enabled);
    res.json({ enabled: req.body.enabled });
  } catch (e) { res.status(500).json({ error: '通知設定の保存に失敗しました' }); }
});

// ─── トレンド ──────────────────────────────────────────
router.get('/trends', authenticate, async (req, res) => {
  try {
    const trends = await db.execute({
      sql: `SELECT * FROM trends t WHERE user_id = ? AND ${currentVersion('t')} ORDER BY post_count DESC`, args: [req.userId],
    });
    res.json({ trends: trends.rows });
  } catch (e) { res.status(500).json({ error: 'トレンド取得に失敗しました' }); }
});

// ─── フォロワー一覧 ────────────────────────────────────
router.get('/characters', authenticate, async (req, res) => {
  try {
    const chars = await db.execute({
      sql: `SELECT c.*,
              (SELECT COUNT(*) FROM likes WHERE liker_id = c.id AND user_id = ?) as total_likes_given,
              (SELECT COUNT(*) FROM posts WHERE author_id = c.id AND user_id = ?)  as total_posts
            FROM ai_characters c WHERE c.user_id = ? AND ${currentVersion('c')} ORDER BY datetime(c.created_at) ASC, c.id ASC`,
      args: [req.userId, req.userId, req.userId],
    });
    res.json({ characters: chars.rows });
  } catch (e) { res.status(500).json({ error: 'キャラクター取得に失敗しました' }); }
});

// ─── seed ──────────────────────────────────────────────
router.post('/seed', authenticate, async (req, res) => {
  const userId = req.userId;
  try {
    await themeState(userId);
    const existing = await db.execute({
      sql: `SELECT COUNT(*) as count FROM posts p WHERE user_id = ? AND ${currentVersion('p')} AND author_type = 'ai'`, args: [userId],
    });
    if (existing.rows[0]?.count > 0) return res.json({ message: '既に投稿があります' });
    await generateAITimelinePosts(userId);
    res.json({ success: true });
  } catch (e) {
    if (e.code === 'LLM_DEFERRED' || e.code === 'WORLD_BUSY') {
      const messages = {
        initial_posts_review: '初期投稿の内容を確認しています。まもなく表示します。',
        initial_posts_publish: '初期投稿の確認が終わりました。まもなく表示します。',
        worker_budget: '準備の続きを進めています。まもなく再開します。',
        world_busy: '世界を更新中です。少し待って再試行してください。',
        provider_quota: 'AI提供元の利用枠が回復するのを待っています。選んだモードと設定は保存されています。',
        provider_cooldown: 'AI提供元が一時休止中です。少し待って再試行してください。',
        daily_budget: '本日のAI生成上限に達しました。日本時間9時の枠更新をお待ちください。',
        quality_review_wait: '初期投稿の内容を確認中です。少し待って再試行してください。',
        user_inactive: '画面を開いた状態で再試行してください。',
        provider_unavailable: 'AI提供元に接続できませんでした。少し待って再試行してください。',
      };
      const reason = e.code === 'WORLD_BUSY' ? 'world_busy' : e.message;
      return res.status(202).json({ status: 'waiting', reason, message: messages[reason] || '初期投稿を準備中です。時間をおいて再試行してください。', retryAt: e.retryAt });
    }
    console.error('Seed error:', e);
    res.status(500).json({
      error: 'シード生成に失敗しました',
      ...(process.env.NODE_ENV === 'development' ? { detail: e.message } : {}),
    });
  }
});

module.exports = router;
