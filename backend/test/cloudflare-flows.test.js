const test=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const os=require('node:os');const path=require('node:path');
Object.assign(process.env,{SOLOVERSE_RUNTIME:'cloudflare',JWT_SECRET:'fictional-local-test-secret-long-enough',ADMIN_USER_IDS:'owner',GROQ_API_KEY:'fictional',GROQ_MODELS:'test',LLM_PROVIDER_ORDER:'groq',LLM_REQUEST_INTERVAL_MS:'0',CONTENT_REVIEW:'true',CONTENT_TEMPLATES:'false',CONTENT_POOL_SIZE:'12',CONTENT_REFILL_ATTEMPTS:'1'});
const {createClient}=require('@libsql/client');const dir=fs.mkdtempSync(path.join(os.tmpdir(),'sv-d1-flow-'));const client=createClient({url:'file:'+path.join(dir,'test.db')});
const {withDatabase,db,queryCount}=require('../src/db/client');
const runtime=require('../src/services/llmRuntime');runtime.attachDatabase(db);
const pipeline=require('../src/services/contentPipeline');const {serializeWorldTask}=require('../src/services/worldTasks');
let trace=[], network=0;
const binding={prepare(sql){return{bind(...args){return{async all(){trace.push(sql.replace(/\s+/g,' ').slice(0,100));if(trace.length+network>45)throw new Error('D1_ERROR: Too many subrequests');const r=await client.execute({sql,args});return{results:r.rows,meta:{changes:r.rowsAffected}};},async run(){return this.all();}};}};},async batch(statements){return Promise.all(statements.map(s=>s.all()));}};
const originalFetch=global.fetch;
global.fetch=async(url,options)=>{network++;const b=JSON.parse(options.body),p=b.messages.at(-1).content;let content;if(p.includes('検査対象: ')){const rows=JSON.parse(p.split('検査対象: ')[1].split('\n各index')[0]);content=rows.map((_,index)=>({index,accepted:true,reason:'accepted'}));}else{const names=[...p.matchAll(/"username":"([^"]+)"/g)].map(m=>m[1]);content=['映画の撮影場所を調べてみた。画面で見た風景と実際の街並みを比べるのが面白い。','好きな俳優の昔のインタビューを読んだ。役作りの話が具体的で印象に残った。','映画館の音響が良かった。静かな場面の足音まで自然に聞こえて驚いた。','昨日観た作品の音楽が忘れられない。ピアノの旋律が帰り道も頭の中で続いていた。'].map((content,i)=>({username:names[i%names.length],content}));}return new Response(JSON.stringify({choices:[{finish_reason:'stop',message:{content:JSON.stringify(content)}}],usage:{total_tokens:100}}),{headers:{'x-ratelimit-remaining-tokens':'8000','x-ratelimit-reset-tokens':'1s'}});};

async function request(task) {
 trace=[]; network=0;
 await withDatabase(binding,async()=>{
  // Include authentication/activity and seed-route queries in the same limit.
  await db.execute('SELECT 1');await db.execute('SELECT 1');await db.execute('SELECT 1');
  await require('../src/services/worldTheme').themeState('owner');
  await db.execute('SELECT COUNT(*) FROM posts');
  await serializeWorldTask('owner',task);
 },{waitUntil(){}});
 assert.ok(trace.length+network<=45, `subrequests=${trace.length+network}`);
}
test.before(async()=>{await client.execute('PRAGMA foreign_keys=ON');for(const f of ['0001_initial.sql','0002_seed_wait.sql'])await client.executeMultiple(fs.readFileSync(path.join(__dirname,'../../cloudflare/migrations',f),'utf8'));
await client.execute("INSERT INTO users(id,email,password_hash,username,onboarding_done) VALUES('owner','owner@test.invalid','unused','owner',1)");await client.execute("INSERT INTO world_settings VALUES('owner','admired','映画俳優','calm','','large')");await client.execute({sql:'INSERT INTO generation_sessions VALUES(?,?,?,NULL)',args:['s','owner',Date.now()+300000]});for(let i=0;i<10;i++)await client.execute({sql:"INSERT INTO ai_characters(id,user_id,name,username,avatar_seed,personality,interests,reply_style,reaction_frequency,delay_profile) VALUES(?,'owner','住人',?,'seed','映画を楽しむ','映画','短い','mid','normal')",args:['c'+i,'resident_'+i]});
});
test.after(()=>{global.fetch=originalFetch;client.close();fs.rmSync(dir,{recursive:true,force:true});});

test('Cloudflare seed generates, then reviews in a separate bounded invocation and releases each lock',async()=>{
 await request(async()=>assert.rejects(pipeline.seedEnhanced('owner'),e=>e.code==='LLM_DEFERRED' && e.message==='initial_posts_review'));
 assert.equal(network,1);
 assert.equal((await client.execute('SELECT COUNT(*) n FROM deployment_locks')).rows[0].n,0);
 assert.equal((await client.execute('SELECT COUNT(*) n FROM content_candidates WHERE reviewed=0')).rows[0].n,4);
 assert.equal((await client.execute('SELECT COUNT(*) n FROM posts')).rows[0].n,0);
 await request(async()=>assert.equal(await pipeline.seedEnhanced('owner'),4));
 assert.equal(network,1);
 assert.equal((await client.execute('SELECT COUNT(*) n FROM deployment_locks')).rows[0].n,0);
 assert.equal((await client.execute('SELECT COUNT(*) n FROM posts')).rows[0].n,4);
 const before=(await client.execute('SELECT COUNT(*) n FROM llm_attempts')).rows[0].n;
 await request(async()=>assert.equal(await pipeline.seedEnhanced('owner'),0));
 assert.equal((await client.execute('SELECT COUNT(*) n FROM llm_attempts')).rows[0].n,before);
});

test('Cloudflare lock contention is typed, cannot steal an active lease, and expired or failed work releases safely',async()=>{
 await client.execute({sql:'INSERT INTO deployment_locks VALUES(?,?,?)',args:['world:owner','other-worker',Date.now()+180000]});
 trace=[];network=0;
 await withDatabase(binding,async()=>{
  await assert.rejects(serializeWorldTask('owner',()=>assert.fail('must not run')),e=>e.code==='WORLD_BUSY' && Date.parse(e.retryAt)>Date.now());
  assert.equal((await client.execute('SELECT owner FROM deployment_locks')).rows[0].owner,'other-worker');
  await client.execute('UPDATE deployment_locks SET expires_at=0');
  await assert.rejects(serializeWorldTask('owner',async()=>{
   const lease=(await client.execute('SELECT expires_at FROM deployment_locks')).rows[0];
   assert.ok(lease.expires_at<=Date.now()+180000);
   throw new Error('fictional failure');
  }),/fictional failure/);
 },{waitUntil(){}});
 assert.equal((await client.execute('SELECT COUNT(*) n FROM deployment_locks')).rows[0].n,0);
});
