// Local operator view; safe metadata only. No provider calls and no schema mutation.
process.chdir(require('node:path').join(__dirname, '..'));
require('dotenv').config({ path: require('node:path').join(__dirname, '../.env') });
const { db } = require('../src/db/schema');
(async () => {
  const limits = await db.execute('SELECT * FROM llm_provider_limits ORDER BY provider,model');
  const usage = await db.execute("SELECT provider,model,outcome,COUNT(*) AS attempts,SUM(tokens) AS tokens,SUM(estimated) AS estimated_count FROM llm_attempts WHERE created_at>=strftime('%Y-%m-%dT00:00:00.000Z','now') GROUP BY provider,model,outcome");
  const config = require('../src/services/contentConfig').config();
  const requests = usage.rows.reduce((n, r) => n + Number(r.attempts), 0);
  const tokens = usage.rows.reduce((n, r) => n + Number(r.tokens), 0);
  const reset = new Date(); reset.setUTCHours(24, 0, 0, 0);
  const models = await db.execute("SELECT provider,model,COUNT(*) AS attempts,SUM(CASE WHEN outcome='success' THEN 1 ELSE 0 END)*1.0/COUNT(*) AS success_rate FROM llm_attempts WHERE created_at>=strftime('%Y-%m-%dT%H:%M:%fZ','now','-1 hour') AND outcome!='running' GROUP BY provider,model");
  console.log(JSON.stringify({
    providerHeaders: limits.rows, todayUTC: usage.rows,
    localBudget: { remainingRequests: Math.max(0, config.dailyRequests - requests), remainingTokens: Math.max(0, config.dailyTokens - tokens), resetAt: reset.toISOString(), tokenValuesMayBeEstimated: true },
    recentModels: models.rows.map(r => ({ ...r, demoted: r.attempts >= 3 && r.success_rate < 0.5 })),
  }, null, 2));
})().catch(() => { console.error('Diagnostics unavailable. Start the updated backend once to initialize tables.'); process.exitCode = 1; }).finally(() => db.close());
