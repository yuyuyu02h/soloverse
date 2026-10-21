const express = require('express');
const { db } = require('../db/schema');
const { adminMiddleware } = require('../middleware/admin');
const { resolveMode, LABELS } = require('../services/worldModes');
const { isLLMConfigured, callLLM } = require('../services/llm');

const router = express.Router();
router.use(adminMiddleware);
router.get('/overview', async (req, res) => {
  try {
    const results = await Promise.all([
      db.execute('SELECT COUNT(*) AS total,SUM(onboarding_done) AS configured FROM users'),
      db.execute('SELECT position,COUNT(*) AS total FROM world_settings GROUP BY position'),
      db.execute('SELECT COUNT(*) AS total FROM posts'),
      db.execute("SELECT COUNT(*) AS total FROM content_candidates c WHERE state='pending' AND c.theme_version=COALESCE((SELECT version FROM world_theme_state WHERE user_id=c.user_id),1)"),
      db.execute("SELECT outcome,COUNT(*) AS total FROM content_events WHERE created_at>=strftime('%Y-%m-%dT00:00:00.000Z','now') GROUP BY outcome"),
      db.execute({ sql: 'SELECT username FROM users WHERE id=?', args: [req.userId] }),
    ]);
    const modes = { hobby: 0, celebrity: 0, community: 0 };
    for (const row of results[1].rows) modes[resolveMode(row)] += Number(row.total);
    res.set('Cache-Control', 'no-store');
    res.json({ username: results[5].rows[0]?.username, users: Number(results[0].rows[0].total),
      configuredUsers: Number(results[0].rows[0].configured || 0), posts: Number(results[2].rows[0].total),
      pending: Number(results[3].rows[0].total), modes: Object.entries(modes).map(([mode,count])=>({ mode,label:LABELS[mode],count })),
      today: results[4].rows, llmConfigured: isLLMConfigured(), checkedAt: new Date().toISOString() });
  } catch (error) {
    console.error('Admin overview error:', error.message);
    res.status(500).json({ error: '管理情報を取得できませんでした' });
  }
});
// Fixed fictional prompt: test a newly registered key without creating a world
// or sending the owner's profile/posts to an AI provider.
router.post('/ai-check', async (req, res) => {
  const provider = req.body?.provider;
  if (provider !== undefined && !['groq','gemini','openrouter'].includes(provider)) return res.status(400).json({ error: '接続先が不正です' });
  if (!isLLMConfigured()) return res.status(503).json({ error: 'AI APIキーが未設定です' });
  try {
    let metadata;
    const text = await callLLM('これは架空データによる接続確認です。', '接続確認OK、とだけ返してください。', 64,
      { provider,job:'admin_connection_check',priority:'interactive',expectJSON:false,onResult:value=>{metadata=value;} });
    if (!text.trim()) throw new Error('empty');
    res.json({ success:true,provider:metadata?.provider,model:metadata?.model });
  } catch (_) { res.status(503).json({ error: 'AIに接続できませんでした。無料枠・キーの設定を確認し、時間をおいて再試行してください。' }); }
});
module.exports = router;
