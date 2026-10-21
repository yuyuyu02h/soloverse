const test = require('node:test');
const assert = require('node:assert/strict');
const { db, withDatabase, compactInserts } = require('../src/db/client');
const { hashPassword, verifyPassword, clientCredential } = require('../src/services/passwords');

test('D1 bindings remain isolated across concurrent request contexts', async () => {
  function binding(id) { return { prepare() { return { bind() { return { async all() { await new Promise(r=>setTimeout(r,5)); return { results:[{id}] }; } }; } }; } }; }
  const results = await Promise.all(['first','second'].map(id=>withDatabase(binding(id),async()=>{
    const a=await db.execute('SELECT id'); const b=await db.execute('SELECT id'); return [a.rows[0].id,b.rows[0].id];
  })));
  assert.deepEqual(results,[['first','first'],['second','second']]);
});

test('D1 saves large homogeneous batches using one bound JSON parameter', () => {
  const inputs=Array.from({length:150},(_,i)=>({sql:'INSERT INTO comments(id,content) VALUES(?,?)',args:[String(i),`quote '\" ${i}`]}));
  const compact=compactInserts(inputs);assert.equal(compact.length,1);assert.equal(compact[0].args.length,1);
  assert.deepEqual(JSON.parse(compact[0].args[0]),inputs.map(row=>row.args));
  assert.match(compact[0].sql,/json_each\(\?\)/);
  assert.equal(compactInserts(['DELETE FROM comments',...inputs,'UPDATE comments SET content=content']).length,3);
});

test('Cloudflare native password format accepts only the correct password and fixed work factor', async () => {
  process.env.SOLOVERSE_RUNTIME='cloudflare';
  try {
    const email='fictional@example.test';
    const saved=await hashPassword('Fictional-Test-Password!',email);
    const credential=await clientCredential(email,'Fictional-Test-Password!');
    assert.match(saved,/^client-pbkdf2-sha256\$600000\$100000\$/);
    assert.equal(await verifyPassword(credential,saved,'client-pbkdf2-v1'),true);
    assert.equal(await verifyPassword('wrong-password',saved,'client-pbkdf2-v1'),false);
    assert.equal(await verifyPassword(credential,saved.replace('$600000$','$1$'),'client-pbkdf2-v1'),false);
    assert.equal(await verifyPassword(credential,saved),false);
    assert.equal(await verifyPassword('Fictional-Test-Password!',saved,'client-pbkdf2-v1'),false);
    assert.equal(await verifyPassword('Fictional-Test-Password!','$2a$12$old-bcrypt-hash'),false);
  } finally { delete process.env.SOLOVERSE_RUNTIME; }
});

test('Cloudflare LLM tasks retain their own request context instead of draining another request queue', async () => {
  const { schedule } = require('../src/services/llmRuntime');
  const binding = id => ({ prepare() { return { bind() { return { async all() { return { results: [{ id }] }; } }; } }; } });
  process.env.SOLOVERSE_RUNTIME = 'cloudflare';
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  try {
    const first = withDatabase(binding('first'), () => schedule({}, async () => { await gate; return (await db.execute('SELECT id')).rows[0].id; }));
    const second = withDatabase(binding('second'), () => schedule({}, async () => (await db.execute('SELECT id')).rows[0].id));
    release();
    assert.deepEqual(await Promise.all([first, second]), ['first', 'second']);
  } finally { delete process.env.SOLOVERSE_RUNTIME; }
});
