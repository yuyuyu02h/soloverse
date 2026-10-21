const { randomUUID } = require('node:crypto');
const { db } = require('../db/schema');
const { activeGenerationSQL } = require('./generationActivity');
const { currentVersion } = require('./worldTheme');
const reactions = require('./reactionScheduler');
const celebrity = require('./celebrityMode');
const pipeline = require('./contentPipeline');
const engine = require('./autonomousEngine');

// Run inside withDatabase so admission, work and cleanup share one query budget.
async function runScheduledJobs(scheduledTime) {
  const owner = randomUUID();
  const lease = (await db.execute({
    sql: `INSERT INTO deployment_locks(name,owner,expires_at) VALUES('cron',?,?)
      ON CONFLICT(name) DO UPDATE SET owner=excluded.owner,expires_at=excluded.expires_at
      WHERE deployment_locks.expires_at<? RETURNING owner`,
    args: [owner, Date.now() + 14 * 60000, Date.now()],
  })).rows[0];
  if (lease?.owner !== owner) return;
  try {
    const queued = (await db.execute(`SELECT 1 FROM reaction_queue rq WHERE done=0
      AND datetime(scheduled_at)<=datetime('now') AND ${activeGenerationSQL('rq.user_id')} LIMIT 1`)).rows.length;
    if (queued) { await reactions.processReactionQueue(); return; }
    // Continue prepared work on the next minute, rather than waiting another
    // four-minute rotation. A provider/budget defer still respects its retry time.
    const due = (await db.execute(`SELECT 1 FROM content_candidates c WHERE state='pending'
      AND ${currentVersion('c')} AND ${activeGenerationSQL('c.user_id')}
      AND scheduled_at<=strftime('%Y-%m-%dT%H:%M:%fZ','now')
      AND NOT EXISTS (SELECT 1 FROM content_pool_state s WHERE s.user_id=c.user_id
        AND s.defer_reason!='' AND s.next_fill_at>strftime('%Y-%m-%dT%H:%M:%fZ','now')) LIMIT 1`)).rows.length;
    if (due) { await pipeline.publishAll(); return; }
    const minute = Math.floor(scheduledTime / 60000);
    switch (minute % 4) {
      case 0: await celebrity.processPendingCelebrityScenes(1); break;
      case 1: await pipeline.publishAll(); break;
      case 2: await engine.runAllUsers('timeline'); break;
      case 3: await engine.runAllUsers(['trends', 'growth', 'absence'][Math.floor(minute / 4) % 3]); break;
    }
  } catch (error) {
    // Busy/deferred work is durable and resumes in another invocation.
    if (error.code !== 'LLM_DEFERRED' && error.code !== 'WORLD_BUSY') throw error;
  } finally {
    await db.executeCleanup({ sql: "DELETE FROM deployment_locks WHERE name='cron' AND owner=?", args: [owner] });
  }
}

module.exports = { runScheduledJobs };
