require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { db, initDB } = require('./src/db/schema');
const { processReactionQueue } = require('./src/services/reactionScheduler');
const { runAllUsers } = require('./src/services/autonomousEngine');
const { getModels, isLLMConfigured } = require('./src/services/llm');

const authRoutes = require('./src/routes/auth');
const onboardingRoutes = require('./src/routes/onboarding');
const timelineRoutes = require('./src/routes/timeline');

const app = express();
const timers = [];
const allowedOrigins = (process.env.CORS_ORIGIN || 'http://localhost:3000')
  .split(',')
  .map(origin => origin.trim())
  .filter(Boolean);

app.disable('x-powered-by');
if (process.env.TRUST_PROXY === 'true') app.set('trust proxy', 1);
app.use((_, res, next) => {
  res.set({
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'no-referrer',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
  });
  next();
});
app.use(cors({
  origin(origin, callback) {
    if (!origin || allowedOrigins.includes(origin)) return callback(null, true);
    return callback(new Error('CORS origin is not allowed'));
  },
}));
app.use(express.json({ limit: '32kb' }));

app.use(async (_, __, next) => {
  try { await db.execute('PRAGMA foreign_keys = ON'); } catch (_) {}
  next();
});

app.use('/api/auth', authRoutes);
app.use('/api/onboarding', onboardingRoutes);
app.use('/api/timeline', timelineRoutes);
app.get('/api/health', (_, res) => res.json({
  status: 'ok',
  llm: { configured: isLLMConfigured(), models: getModels() },
}));

app.use((_, res) => res.status(404).json({ error: 'APIが見つかりません' }));
app.use((error, _, res, __) => {
  if (error?.type === 'entity.too.large') return res.status(413).json({ error: 'リクエストが大きすぎます' });
  if (error instanceof SyntaxError) return res.status(400).json({ error: 'JSON形式が不正です' });
  if (error?.message === 'CORS origin is not allowed') return res.status(403).json({ error: '許可されていない接続元です' });
  console.error('[HTTP] Unhandled error:', error);
  return res.status(500).json({ error: 'サーバーエラー' });
});

function startBackgroundJobs() {
  let queueRunning = false;
  let engineRunning = false;

  const runQueue = async () => {
    if (queueRunning) return;
    queueRunning = true;
    try {
      await processReactionQueue();
      await require('./src/services/contentPipeline').publishAll();
    }
    catch (e) { console.error('[Queue] Error:', e.message); }
    finally { queueRunning = false; }
  };
  const runEngine = async () => {
    if (engineRunning) return;
    engineRunning = true;
    try { await runAllUsers(); }
    catch (e) { console.error('[Engine] Error:', e.message); }
    finally { engineRunning = false; }
  };

  timers.push(setInterval(runQueue, 30 * 1000));
  timers.push(setTimeout(runEngine, 10 * 1000));
  timers.push(setInterval(runEngine, 5 * 60 * 1000));
}

async function startServer(port = Number(process.env.PORT) || 3001) {
  await initDB();
  if (process.env.BACKGROUND_JOBS !== 'false') startBackgroundJobs();

  return new Promise((resolve, reject) => {
    const server = app.listen(port, () => {
      const address = server.address();
      const actualPort = typeof address === 'object' && address ? address.port : port;
      console.log(`Backend running on http://localhost:${actualPort}`);
      console.log(`CORS allowed origins: ${allowedOrigins.join(', ')}`);
      console.log(`LLM: ${isLLMConfigured() ? getModels().join(', ') : 'not configured'}`);
      resolve(server);
    });
    server.once('error', reject);
  });
}

async function shutdown(server) {
  for (const timer of timers.splice(0)) clearTimeout(timer);
  if (server?.listening) await new Promise(resolve => server.close(resolve));
  db.close();
}

if (require.main === module) {
  let server;
  startServer().then(started => {
    server = started;
  }).catch(e => {
    console.error('Backend startup failed:', e);
    process.exitCode = 1;
  });

  for (const signal of ['SIGINT', 'SIGTERM']) {
    process.on(signal, () => shutdown(server).finally(() => process.exit(0)));
  }
}

module.exports = { app, startServer, shutdown };
