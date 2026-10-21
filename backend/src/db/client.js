const path = require('node:path');
const { AsyncLocalStorage } = require('node:async_hooks');
const storage = new AsyncLocalStorage();
const databasePath = process.env.SOLOVERSE_RUNTIME === 'cloudflare' ? null : process.env.DB_PATH ? path.resolve(process.env.DB_PATH) : path.join(__dirname, '../../soloverse.db');
let local;
function localClient() {
  if (process.env.SOLOVERSE_RUNTIME === 'cloudflare') throw new Error('D1 binding context is required');
  return local ||= require('@libsql/client').createClient({ url: `file:${databasePath}` });
}
function statement(binding, input) {
  const { sql, args = [] } = typeof input === 'string' ? { sql: input } : input;
  return binding.prepare(sql).bind(...args.map(value => value === undefined ? null : value));
}
function result(value) { return { rows: value.results || [], rowsAffected: value.meta?.changes || 0, lastInsertRowid: value.meta?.last_row_id }; }
function changesWorldSettings(input) {
  const sql = typeof input === 'string' ? input : input.sql;
  return /^\s*(?:INSERT(?: OR (?:IGNORE|REPLACE))? INTO|UPDATE|DELETE FROM)\s+world_settings\b/i.test(sql);
}
// Reserve five of Free D1's 50 queries for leases and buffered telemetry.
function requireQueryBudget(count, cleanup = false) {
  const context = storage.getStore();
  if (!context || context.queries + count <= (cleanup ? 50 : 45)) return;
  const error = new Error('worker_budget');
  error.code = 'LLM_DEFERRED';
  error.retryAt = new Date(Date.now() + 1500).toISOString();
  throw error;
}
async function execute(input, cleanup = false) {
  const context = storage.getStore();
  if (!context?.binding) return localClient().execute(input);
  requireQueryBudget(1, cleanup);
  context.queries++;
  if (changesWorldSettings(input)) context.cache.clear();
  return result(await statement(context.binding, input).all());
}
const db = {
  execute: input => execute(input),
  executeCleanup: input => execute(input, true),
  requireQueryBudget,
  async batch(inputs, mode) {
    const binding = storage.getStore()?.binding;
    if (!binding) return localClient().batch(inputs, mode);
    if (!inputs.length) return [];
    if (inputs.some(changesWorldSettings)) storage.getStore().cache.clear();
    const compact = compactInserts(inputs);
    // Admit the entire atomic batch before starting any of its statements.
    requireQueryBudget(compact.length);
    storage.getStore().queries += compact.length;
    return (await binding.batch(compact.map(input => statement(binding, input)))).map(result);
  },
  close() { local?.close(); },
};
async function withDatabase(binding, task, executionContext) {
  return storage.run({ binding, cache: new Map(), telemetry: [], queries: 0, executionContext }, async () => {
    try { return await task(); }
    finally {
      const rows = storage.getStore().telemetry;
      if (rows.length) await db.executeCleanup({ sql: `INSERT INTO content_events(user_id,job,outcome,reason,scores,created_at) SELECT json_extract(value,'$[0]'),json_extract(value,'$[1]'),json_extract(value,'$[2]'),json_extract(value,'$[3]'),json_extract(value,'$[4]'),json_extract(value,'$[5]') FROM json_each(?)`, args: [JSON.stringify(rows)] });
    }
  });
}
function compactInserts(inputs) {
  const output = [];
  for (let i = 0; i < inputs.length;) {
    const first = inputs[i];
    const match = typeof first === 'object' && first.sql.match(/^(\s*INSERT(?: OR (?:IGNORE|REPLACE))? INTO [\s\S]+?)\s+VALUES\s*\((\?(?:\s*,\s*\?)*)\)\s*$/i);
    const group = [first];
    if (match) while (i + group.length < inputs.length && inputs[i+group.length]?.sql === first.sql) group.push(inputs[i+group.length]);
    if (group.length > 1) output.push({ sql: `${match[1]} SELECT ${first.args.map((_,j)=>`json_extract(value,'$[${j}]')`).join(',')} FROM json_each(?)`, args:[JSON.stringify(group.map(item=>item.args))] });
    else output.push(first);
    i += group.length;
  }
  return output;
}
db.memo = async (key, task) => {
  const context = storage.getStore();
  if (!context) return task();
  if (context.cache.has(key)) return context.cache.get(key);
  const pending = Promise.resolve().then(task);
  context.cache.set(key, pending);
  try { return await pending; }
  catch (error) { if (context.cache.get(key) === pending) context.cache.delete(key); throw error; }
};
db.bufferContent = row => storage.getStore().telemetry.push(row);
db.keepAlive = promise => storage.getStore()?.executionContext?.waitUntil(promise);
function queryCount() { return storage.getStore()?.queries || 0; }
module.exports = { db, databasePath, withDatabase, queryCount, compactInserts };
