import { env } from 'cloudflare:workers';
import { httpServerHandler } from 'cloudflare:node';
import server from '../backend/server.js';
import database from '../backend/src/db/client.js';
import runtime from '../backend/src/services/llmRuntime.js';
import reactions from '../backend/src/services/reactionScheduler.js';
import celebrity from '../backend/src/services/celebrityMode.js';
import pipeline from '../backend/src/services/contentPipeline.js';
import engine from '../backend/src/services/autonomousEngine.js';
import activity from '../backend/src/services/generationActivity.js';

runtime.attachDatabase(database.db);
server.app.listen(3001);
const handler = httpServerHandler({ port: 3001 });

export default {
  async fetch(request, bindings, context) {
    if (!bindings.DB || !env.JWT_SECRET || env.JWT_SECRET.length < 32) return Response.json({ error: 'サーバーの設定が未完了です' }, { status: 503 });
    return database.withDatabase(bindings.DB, async () => {
      // Do not trust caller-supplied forwarding headers for login rate limits.
      const headers = new Headers(request.headers);
      headers.set('x-forwarded-for', request.headers.get('cf-connecting-ip') || 'unknown');
      const response = await handler.fetch(new Request(request, { headers }), bindings, context);
      const safe = new Response(response.body, response); safe.headers.set('Cache-Control','no-store');
      if (env.LOCAL_TESTING === 'true') safe.headers.set('X-SoloVerse-Queries',String(database.queryCount()));
      return safe;
    }, context);
  },
  async scheduled(controller, bindings, context) {
    await database.withDatabase(bindings.DB, async () => {
      // A D1 lease prevents overlapping Cron invocations across isolates.
      const owner = crypto.randomUUID();
      const lease = await bindings.DB.prepare(`INSERT INTO deployment_locks(name,owner,expires_at) VALUES('cron',?,?) ON CONFLICT(name) DO UPDATE SET owner=excluded.owner,expires_at=excluded.expires_at WHERE deployment_locks.expires_at<? RETURNING owner`).bind(owner, Date.now() + 14 * 60000, Date.now()).first();
      if (lease?.owner !== owner) return;
      try {
        // One bounded task per invocation stays within the Free plan's 50 D1 queries.
        const queued = await bindings.DB.prepare(`SELECT 1 FROM reaction_queue rq WHERE done=0 AND datetime(scheduled_at)<=datetime('now') AND ${activity.activeGenerationSQL('rq.user_id')} LIMIT 1`).first();
        if (queued) { await reactions.processReactionQueue(); return; }
        const minute = Math.floor(controller.scheduledTime / 60000);
        switch (minute % 4) {
          case 0: await celebrity.processPendingCelebrityScenes(1); break;
          case 1: await pipeline.publishAll(); break;
          case 2: await engine.runAllUsers('timeline'); break;
          case 3: await engine.runAllUsers(['trends','growth','absence'][Math.floor(minute/4)%3]); break;
        }
      } finally { await bindings.DB.prepare("DELETE FROM deployment_locks WHERE name='cron' AND owner=?").bind(owner).run(); }
    });
  },
};
