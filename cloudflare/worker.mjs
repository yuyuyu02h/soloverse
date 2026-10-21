import { env } from 'cloudflare:workers';
import { httpServerHandler } from 'cloudflare:node';
import server from '../backend/server.js';
import database from '../backend/src/db/client.js';
import runtime from '../backend/src/services/llmRuntime.js';
import jobs from '../backend/src/services/cloudflareJobs.js';

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
    await database.withDatabase(bindings.DB, () => jobs.runScheduledJobs(controller.scheduledTime), context);
  },
};
