function enabled() { return (process.env.CONTENT_PIPELINE || 'enhanced') !== 'legacy'; }
function integer(name, fallback, min, max) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && process.env[name] !== '' && process.env[name] != null
    ? Math.max(min, Math.min(max, Math.floor(value))) : fallback;
}
function config() {
  return {
    dailyRequests: integer('LLM_DAILY_REQUEST_BUDGET', 180, 1, 10000),
    dailyTokens: integer('LLM_DAILY_TOKEN_BUDGET', 150000, 100, 10000000),
    replyReserve: integer('LLM_REPLY_RESERVE_PERCENT', 40, 0, 90) / 100,
    poolSize: integer('CONTENT_POOL_SIZE', 24, 4, 48),
    horizonHours: integer('CONTENT_POOL_HOURS', 12, 6, 24),
    refillAttempts: integer('CONTENT_REFILL_ATTEMPTS', 2, 1, 3),
    templates: process.env.CONTENT_TEMPLATES !== 'false',
  };
}
module.exports = { enabled, config };
