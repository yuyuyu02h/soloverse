const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { db } = require('../db/schema');
const { authMiddleware: authenticate } = require('../middleware/auth');
const { scheduleReactions, scheduleReplyReactions, generateAITimelinePosts } = require('../services/reactionScheduler');
const {
  experienceMode,
  createCelebrityScene,
  decorateTimelinePosts,
  celebrityComments,
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
    let sql, args;

    if (since) {
      // 差分取得: since より新しい投稿のみ
      sql = `SELECT p.*,
              CASE WHEN p.author_type = 'ai' THEN ac.name    ELSE u.username END as author_name,
              CASE WHEN p.author_type = 'ai' THEN ac.username ELSE u.username END as author_handle,
              CASE WHEN p.author_type = 'ai' THEN ac.avatar_seed ELSE NULL END as avatar_seed,
              CASE WHEN p.author_type = 'ai' THEN ac.personality ELSE NULL END as personality,
              (SELECT COUNT(*) FROM likes WHERE post_id = p.id) as like_count,
              (SELECT COUNT(*) FROM posts WHERE reply_to = p.id) as reply_count,
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
              (SELECT COUNT(*) FROM posts WHERE reply_to = p.id) as reply_count,
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
        `WHERE p.user_id = ? AND p.reply_to IS NULL AND p.id IN (${ids.map(() => '?').join(',')}) ORDER BY datetime(p.created_at) DESC, p.id DESC`;
      args = [userId, userId, ...ids];
    } else if (req.query.before && req.query.beforeId) {
      sql = sql.slice(0, sql.indexOf('WHERE p.user_id = ?')) +
        `WHERE p.user_id = ? AND p.reply_to IS NULL
          AND (datetime(p.created_at) < datetime(?) OR (datetime(p.created_at) = datetime(?) AND p.id < ?))
         ORDER BY datetime(p.created_at) DESC, p.id DESC LIMIT ?`;
      args = [userId, userId, String(req.query.before), String(req.query.before), String(req.query.beforeId), limit];
    }
    const posts = await db.execute({ sql, args });
    const decoratedPosts = await decorateTimelinePosts(userId, posts.rows);

    // 各投稿の直近リプライを最大2件取得（プレビュー用）
    const postIds = decoratedPosts.map(p => p.id);
    let repliesMap = {};
    const audienceMap = await celebrityComments(userId, postIds, 2);

    for (const pid of postIds) {
      const replies = await db.execute({
        sql: `SELECT p.*,
                CASE WHEN p.author_type = 'ai' THEN ac.name    ELSE u.username END as author_name,
                CASE WHEN p.author_type = 'ai' THEN ac.username ELSE u.username END as author_handle,
                CASE WHEN p.author_type = 'ai' THEN ac.avatar_seed ELSE NULL END as avatar_seed,
                (SELECT COUNT(*) FROM likes WHERE post_id = p.id) as like_count,
                (SELECT COUNT(*) FROM likes WHERE post_id = p.id AND liker_id = ?) as user_liked
              FROM posts p
              LEFT JOIN ai_characters ac ON p.author_type = 'ai'  AND p.author_id = ac.id
              LEFT JOIN users u          ON p.author_type = 'user' AND p.author_id = u.id
              WHERE p.reply_to = ? AND p.user_id = ?
              ORDER BY datetime(p.created_at) DESC, p.id DESC
              LIMIT 2`,
        args: [userId, pid, userId],
      });
      const combined = [...replies.rows, ...(audienceMap.get(pid) || [])]
        .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime())
        .slice(-2);
      if (combined.length > 0) repliesMap[pid] = combined;
    }

    const enriched = decoratedPosts.map(p => ({
      ...p,
      reply_preview: repliesMap[p.id] || [],
    }));

    res.json({ posts: enriched });
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
    if (replyTo) {
      const target = await db.execute({
        sql: 'SELECT id FROM posts WHERE id = ? AND user_id = ?',
        args: [replyTo, userId],
      });
      if (!target.rows.length) return res.status(404).json({ error: '返信先の投稿が見つかりません' });
    }

    const postId = uuidv4();
    const createdAt = new Date().toISOString();
    const user = await db.execute({ sql: 'SELECT username FROM users WHERE id = ?', args: [userId] });

    await db.execute({
      sql: `INSERT INTO posts (id, user_id, author_id, author_type, content, reply_to, created_at, ai) VALUES (?, ?, ?, 'user', ?, ?, ?, 0)`,
      args: [postId, userId, userId, content.trim(), replyTo || null, createdAt],
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
          initialLikeCount = scheduled.likeCount;
          initialReplyCount = scheduled.commentCount;
        } else {
          scheduled = await scheduleReactions(userId, postId, content.trim());
        }
      } catch (e) {
        // 投稿自体は保存済みなので、リアクション予約だけの失敗で投稿を500にしない。
        console.error('Schedule error:', e);
      }
    } else if (mode !== 'celebrity') {
      // リプライ投稿: リプライへのAI反応もスケジュール（確率低め）
      scheduleReplyReactions(userId, postId, content.trim(), replyTo).catch(e => console.error('Reply schedule error:', e));
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
        created_at: createdAt,
      },
    });
  } catch (e) {
    console.error('Post error:', e);
    res.status(500).json({ error: '投稿に失敗しました' });
  }
});

// ─── いいね ────────────────────────────────────────────
router.post('/like/:postId', authenticate, async (req, res) => {
  const userId = req.userId;
  const { postId } = req.params;
  try {
    const target = await db.execute({
      sql: 'SELECT id FROM posts WHERE id = ? AND user_id = ?', args: [postId, userId],
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
            ORDER BY datetime(p.created_at) ASC, thread.depth ASC, p.id ASC`,
      args: [postId, userId, userId, userId],
    });
    const audience = await celebrityComments(userId, [postId], 8);
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
    const unreadCount = notifs.rows.filter(n => !n.read).length;
    await db.execute({ sql: 'UPDATE notifications SET read = 1 WHERE user_id = ? AND read = 0', args: [userId] });
    res.json({ notifications: notifs.rows, unreadCount });
  } catch (e) { res.status(500).json({ error: '通知取得に失敗しました' }); }
});

router.get('/notifications/unread-count', authenticate, async (req, res) => {
  const userId = req.userId;
  try {
    const result = await db.execute({
      sql: 'SELECT COUNT(*) as count FROM notifications WHERE user_id = ? AND read = 0', args: [userId],
    });
    res.json({ count: result.rows[0]?.count || 0 });
  } catch (_) { res.json({ count: 0 }); }
});

// ─── トレンド ──────────────────────────────────────────
router.get('/trends', authenticate, async (req, res) => {
  try {
    const trends = await db.execute({
      sql: `SELECT * FROM trends WHERE user_id = ? ORDER BY post_count DESC`, args: [req.userId],
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
            FROM ai_characters c WHERE c.user_id = ? ORDER BY datetime(c.created_at) ASC, c.id ASC`,
      args: [req.userId, req.userId, req.userId],
    });
    res.json({ characters: chars.rows });
  } catch (e) { res.status(500).json({ error: 'キャラクター取得に失敗しました' }); }
});

// ─── seed ──────────────────────────────────────────────
router.post('/seed', authenticate, async (req, res) => {
  const userId = req.userId;
  try {
    const existing = await db.execute({
      sql: `SELECT COUNT(*) as count FROM posts WHERE user_id = ? AND author_type = 'ai'`, args: [userId],
    });
    if (existing.rows[0]?.count > 0) return res.json({ message: '既に投稿があります' });
    await generateAITimelinePosts(userId);
    res.json({ success: true });
  } catch (e) {
    console.error('Seed error:', e);
    res.status(500).json({
      error: 'シード生成に失敗しました',
      ...(process.env.NODE_ENV === 'development' ? { detail: e.message } : {}),
    });
  }
});

module.exports = router;
