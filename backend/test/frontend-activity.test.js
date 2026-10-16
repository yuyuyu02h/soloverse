const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('../../frontend/node_modules/typescript');

function browser(fetcher = async () => new Response('{}')) {
  const values = new Map(), intervals = new Map();
  const window = Object.assign(new EventTarget(), {
    location: { pathname: '/timeline', href: '/timeline' },
    setInterval: callback => { const id = intervals.size + 1; intervals.set(id, callback); return id; },
    clearInterval: id => intervals.delete(id),
  });
  const document = Object.assign(new EventTarget(), { visibilityState: 'visible' });
  const localStorage = { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key) };
  let cleanup;
  const context = { window, document, localStorage, Event, process: { env: {} }, fetch: fetcher };
  function load(file, imports) {
    const source = fs.readFileSync(path.join(__dirname, '../../frontend', file), 'utf8');
    const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.ReactJSX } }).outputText;
    const module = { exports: {} };
    vm.runInNewContext(code, { ...context, exports: module.exports, module, require: name => imports[name] });
    return module.exports;
  }
  const api = load('lib/api.ts', { './deployment': { SCREEN_PREVIEW: false } });
  const component = load('components/GenerationActivity.tsx', {
    react: { useEffect: effect => { cleanup = effect(); } },
    '../lib/api': api, '../lib/deployment': { SCREEN_PREVIEW: false },
  });
  return { ...context, ...api, intervals, mount: () => component.GenerationActivity(), unmount: () => cleanup() };
}
const flush = () => new Promise(resolve => setImmediate(resolve));

test('visible requests report activity; hidden-tab polling does not', async () => {
  const calls = [];
  const page = browser(async (_, options) => { calls.push(options); return new Response('{}'); });
  page.setToken('account-A');
  await page.api.get('/api/auth/me');
  assert.equal(calls[0].headers['X-SoloVerse-Active'], '1');
  page.document.visibilityState = 'hidden';
  await page.api.get('/api/auth/me');
  assert.equal(calls[1].headers['X-SoloVerse-Active'], undefined);
});

test('heartbeat skips hidden pages, resumes on visibility, and cleans up', async () => {
  const calls = [];
  const page = browser(async (url, options) => { calls.push({ url, options }); return new Response('{}'); });
  page.setToken('account-A'); page.mount(); await flush();
  assert.equal(calls.length, 1);
  assert.ok(calls[0].url.endsWith('/api/auth/activity'));
  page.document.visibilityState = 'hidden';
  for (const callback of page.intervals.values()) callback();
  await flush(); assert.equal(calls.length, 1);
  page.document.visibilityState = 'visible';
  page.document.dispatchEvent(new Event('visibilitychange'));
  await flush(); assert.equal(calls.length, 2);
  page.clearToken();
  for (const callback of page.intervals.values()) callback();
  await flush(); assert.equal(calls.length, 2);
  page.unmount(); assert.equal(page.intervals.size, 0);
});

test('sign-in starts heartbeat without a page reload; admin pages do not renew', async () => {
  let count = 0;
  const page = browser(async () => { count++; return new Response('{}'); });
  page.mount(); await flush(); assert.equal(count, 0);
  page.setToken('account-A'); await flush(); assert.equal(count, 1);
  page.window.location.pathname = '/admin';
  for (const callback of page.intervals.values()) callback();
  await flush(); assert.equal(count, 1);
  page.unmount();
});

test('logout clears local credentials immediately and sends the captured session with keepalive', async () => {
  let options, reject;
  const page = browser(async (_, request) => { options = request; return new Promise((resolve, fail) => { reject = fail; }); });
  page.setToken('account-A'); page.setUser({ userId: 'A', username: 'A' });
  const logout = page.logout();
  assert.equal(page.getToken(), null); assert.equal(page.getUser(), null);
  assert.equal(options.headers.Authorization, 'Bearer account-A'); assert.equal(options.keepalive, true);
  page.setToken('account-B');
  reject(new Error('offline')); await logout;
  assert.equal(page.getToken(), 'account-B');
});

test('an old account request failing after a switch cannot clear the new account session', async () => {
  let respond;
  const page = browser(() => new Promise(resolve => { respond = resolve; }));
  page.setToken('account-A');
  const request = page.api.get('/api/auth/me');
  const rejected = assert.rejects(request, /expired/);
  page.setToken('account-B'); page.setUser({ userId: 'B', username: 'B' });
  respond(new Response(JSON.stringify({ error: 'expired' }), { status: 401 }));
  await rejected;
  assert.equal(page.getToken(), 'account-B'); assert.equal(page.getUser().userId, 'B');
  assert.equal(page.window.location.href, '/timeline');
});

test('switching accounts in another tab discards the previous page state', async () => {
  const page = browser(); page.mount();
  const event = new Event('storage');
  Object.assign(event, { key: 'sv_token', oldValue: 'account-A', newValue: 'account-B' });
  page.window.dispatchEvent(event);
  assert.equal(page.window.location.href, '/');
  page.unmount();
});
