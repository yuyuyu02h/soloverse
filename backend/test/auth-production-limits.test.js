const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { createClient } = require('@libsql/client');
Object.assign(process.env, { SOLOVERSE_RUNTIME:'cloudflare',JWT_SECRET:'production-limit-test-secret-long-enough',REGISTRATION_CLOSED:'false' });
const { withDatabase } = require('../src/db/client');
const routes = require('../src/routes/auth');
const client = createClient({ url: 'file::memory:' });
const binding = { prepare(sql) { return { bind(...args) { return { async all() { const result=await client.execute({sql,args});return {results:result.rows}; } }; } }; } };
let server, base;
test.before(async()=>{
  await client.execute('CREATE TABLE login_rate_limits(key TEXT PRIMARY KEY,count INTEGER NOT NULL,reset_at INTEGER NOT NULL)');
  const app=express();app.use(express.json());
  app.use((req,res,next)=>withDatabase(binding,()=>new Promise((resolve,reject)=>{res.once('finish',resolve);res.once('error',reject);next();})).catch(next));
  app.use('/api/auth',routes);
  server=await new Promise(resolve=>{const started=app.listen(0,'127.0.0.1',()=>resolve(started));});base=`http://127.0.0.1:${server.address().port}`;
});
test.after(async()=>{await new Promise(resolve=>server.close(resolve));client.close();});
async function attempt(route) {return fetch(base+route,{method:'POST',headers:{'content-type':'application/json'},body:'{}'});}

test('production registration, normal login and admin login share the original ten-attempt window',async()=>{
  for(let i=0;i<10;i++)assert.equal((await attempt(['/api/auth/register','/api/auth/login','/api/auth/admin/login'][i%3])).status,400);
  const blocked=await attempt('/api/auth/login');assert.equal(blocked.status,429);assert.match((await blocked.json()).error,/15分/);
  await client.execute('UPDATE login_rate_limits SET reset_at=0');
  assert.equal((await attempt('/api/auth/admin/login')).status,400);
  assert.equal((await client.execute('SELECT count FROM login_rate_limits')).rows[0].count,1);
});

test('the same routes have no application attempt limit in local presentation mode',async()=>{
  process.env.SOLOVERSE_RUNTIME='local';
  try {for(let i=0;i<15;i++)assert.equal((await attempt('/api/auth/login')).status,400);}
  finally {process.env.SOLOVERSE_RUNTIME='cloudflare';}
  assert.equal((await client.execute('SELECT count FROM login_rate_limits')).rows[0].count,1);
});
