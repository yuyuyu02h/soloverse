const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sv-auth-repeat-'));
Object.assign(process.env, {
  DB_PATH: path.join(dir, 'test.db'),
  JWT_SECRET: 'repeat-auth-test-secret-with-more-than-32-characters',
  BACKGROUND_JOBS: 'false', REGISTRATION_CLOSED: 'false',
  DEMO_RESET_USER_IDS: '', TRUST_PROXY: 'false', SOLOVERSE_RUNTIME: 'local',
});
const { startServer, shutdown } = require('../server');
let server, base;
async function post(route, body, token) {
  const response = await fetch(base + route, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
  });
  return { status: response.status, data: await response.json() };
}
test.before(async () => {
  server = await startServer(0);
  base = `http://127.0.0.1:${server.address().port}`;
});
test.after(async () => { await shutdown(server); });

test('repeated visitor registration, login and logout exceed the former shared IP limit', async () => {
  for (let index = 0; index < 12; index++) {
    const credentials = { email: `visitor${index}@demo.invalid`, password: 'test-password' };
    const registered = await post('/api/auth/register', { ...credentials, username: `来場者${index}` });
    assert.equal(registered.status, 200, `registration ${index + 1}`);
    assert.equal(registered.data.onboardingDone, false);
    assert.equal((await post('/api/auth/logout', {}, registered.data.token)).status, 200);
    const loggedIn = await post('/api/auth/login', credentials);
    assert.equal(loggedIn.status, 200, `login ${index + 1}`);
    assert.equal((await post('/api/auth/logout', {}, loggedIn.data.token)).status, 200);
    if (index === 0) process.env.ADMIN_USER_IDS = registered.data.userId;
  }
  for (let index = 0; index < 12; index++) {
    assert.equal((await post('/api/auth/admin/login', { email: 'visitor0@demo.invalid', password: 'test-password' })).status, 200);
  }
});

test('removing attempt limits preserves password verification, admin authorization and registration closure', async () => {
  assert.equal((await post('/api/auth/login', { email: 'visitor0@demo.invalid', password: 'wrong-password' })).status, 401);
  assert.equal((await post('/api/auth/admin/login', { email: 'visitor1@demo.invalid', password: 'test-password' })).status, 403);
  assert.equal((await post('/api/auth/login', { email: 'visitor0@demo.invalid', password: 'test-password' })).status, 200);
  process.env.REGISTRATION_CLOSED = 'true';
  try {
    assert.equal((await post('/api/auth/register', { email: 'closed@demo.invalid', password: 'test-password', username: 'closed' })).status, 403);
  } finally { process.env.REGISTRATION_CLOSED = 'false'; }
});
