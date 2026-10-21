const test = require('node:test');
const assert = require('node:assert/strict');
Object.assign(process.env, { SOLOVERSE_RUNTIME: 'cloudflare', JWT_SECRET: 'fictional-auth-outage-secret-long-enough', ADMIN_USER_IDS: 'owner' });
const { withDatabase } = require('../src/db/client');
const { authMiddleware, generateToken } = require('../src/middleware/auth');
const jwt = require('jsonwebtoken');

let fault, revoked = false, touches = 0;
const binding = { prepare(sql) { return { bind() { return { async all() {
  if (fault && sql.includes(fault)) throw new Error('fictional temporary D1 failure');
  if (sql.startsWith('SELECT 1 FROM users')) return { results: [{ exists: 1 }] };
  if (sql.startsWith('SELECT revoked_at')) return { results: revoked ? [{ revoked_at: Date.now() }] : [] };
  if (sql.startsWith('INSERT INTO generation_sessions')) touches++;
  return { results: [] };
} }; } }; } };
async function authenticate(token, active = false) {
  let status = 200, body, accepted = false;
  const headers = {};
  await withDatabase(binding, () => authMiddleware({
    headers: { authorization: `Bearer ${token}`, ...(active ? { 'x-soloverse-active': '1' } : {}) }, baseUrl: '/api/timeline', path: '/',
  }, { status(value) { status = value; return this; }, set(key, value) { headers[key] = value; }, json(value) { body = value; } }, () => { accepted = true; }));
  return { status, body, accepted, headers };
}

test('D1 outage during user lookup, revocation or activity yields 503 and the same token recovers', async () => {
  // First check exercises the uncached existence lookup.
  const token = generateToken('owner');
  for (const operation of ['SELECT 1 FROM users', 'SELECT revoked_at', 'INSERT INTO generation_sessions']) {
    fault = operation;
    const failed = await authenticate(token, true);
    assert.equal(failed.status, 503, operation);
    assert.equal(failed.body.code, 'AUTH_UNAVAILABLE');
    assert.equal(failed.headers['Retry-After'], '5');
    assert.equal(failed.accepted, false);
    fault = null;
    assert.equal((await authenticate(token, true)).accepted, true);
  }
  assert.ok(touches > 0);
});

test('invalid, expired and revoked tokens still yield 401 without admitting a request', async () => {
  for (const token of ['invalid', jwt.sign({ userId: 'owner' }, process.env.JWT_SECRET, { expiresIn: -1 })]) {
    const result = await authenticate(token);
    assert.equal(result.status, 401); assert.equal(result.body.code, 'INVALID_TOKEN'); assert.equal(result.accepted, false);
  }
  revoked = true;
  try {
    const result = await authenticate(generateToken('owner'));
    assert.equal(result.status, 401); assert.equal(result.body.code, 'SESSION_REVOKED'); assert.equal(result.accepted, false);
  } finally { revoked = false; }
});
