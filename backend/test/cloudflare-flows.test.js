const test=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const os=require('node:os');const path=require('node:path');
Object.assign(process.env,{SOLOVERSE_RUNTIME:'cloudflare',JWT_SECRET:'fictional-local-test-secret-long-enough',ADMIN_USER_IDS:'owner',GROQ_API_KEY:'fictional',GROQ_MODELS:'test',LLM_PROVIDER_ORDER:'groq',LLM_REQUEST_INTERVAL_MS:'0',CONTENT_REVIEW:'true',CONTENT_TEMPLATES:'false',CONTENT_POOL_SIZE:'12',CONTENT_REFILL_ATTEMPTS:'1'});
const {createClient}=require('@libsql/client');const dir=fs.mkdtempSync(path.join(os.tmpdir(),'sv-d1-flow-'));const client=createClient({url:'file:'+path.join(dir,'test.db')});
const {withDatabase,db,queryCount}=require('../src/db/client');
const runtime=require('../src/services/llmRuntime');runtime.attachDatabase(db);
const pipeline=require('../src/services/contentPipeline');const {serializeWorldTask}=require('../src/services/worldTasks');
let trace=[], network=0, reviewAccepted=true;
const binding={prepare(sql){return{bind(...args){return{async all(){trace.push(sql.replace(/\s+/g,' ').slice(0,100));if(trace.length+network>45)throw new Error('D1_ERROR: Too many subrequests '+JSON.stringify({network,trace}));const r=await client.execute({sql,args});return{results:r.rows,meta:{changes:r.rowsAffected}};},async run(){return this.all();}};}};},async batch(statements){return Promise.all(statements.map(s=>s.all()));}};
const originalFetch=global.fetch;
global.fetch=async(url,options)=>{network++;const b=JSON.parse(options.body),p=b.messages.at(-1).content;let content;if(p.includes('検査対象: ')){const rows=JSON.parse(p.split('検査対象: ')[1].split('\n各index')[0]);content=rows.map((_,index)=>({index,accepted:reviewAccepted,reason:reviewAccepted?'accepted':'off_topic'}));}else{const names=[...p.matchAll(/"username":"([^"]+)"/g)].map(m=>m[1]);content=['映画の撮影場所を調べてみた。画面で見た風景と実際の街並みを比べるのが面白い。','好きな俳優の昔のインタビューを読んだ。役作りの話が具体的で印象に残った。','映画館の音響が良かった。静かな場面の足音まで自然に聞こえて驚いた。','昨日観た作品の音楽が忘れられない。ピアノの旋律が帰り道も頭の中で続いていた。'].map((content,i)=>({username:names[i%names.length],content}));}return new Response(JSON.stringify({choices:[{finish_reason:'stop',message:{content:JSON.stringify(content)}}],usage:{total_tokens:100}}),{headers:{'x-ratelimit-remaining-tokens':'8000','x-ratelimit-reset-tokens':'1s'}});};

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
test.before(async()=>{await client.execute('PRAGMA foreign_keys=ON');for(const f of ['0001_initial.sql','0002_seed_wait.sql','0003_post_deletion_mentions.sql'])await client.executeMultiple(fs.readFileSync(path.join(__dirname,'../../cloudflare/migrations',f),'utf8'));
await client.execute("INSERT INTO users(id,email,password_hash,username,onboarding_done) VALUES('owner','owner@test.invalid','unused','owner',1)");await client.execute("INSERT INTO world_settings VALUES('owner','admired','映画俳優','calm','','large')");await client.execute({sql:'INSERT INTO generation_sessions VALUES(?,?,?,NULL)',args:['s','owner',Date.now()+300000]});for(let i=0;i<10;i++)await client.execute({sql:"INSERT INTO ai_characters(id,user_id,name,username,avatar_seed,personality,interests,reply_style,reaction_frequency,delay_profile) VALUES(?,'owner','住人',?,'seed','映画を楽しむ','映画','短い','mid','normal')",args:['c'+i,'resident_'+i]});
});
test.after(()=>{global.fetch=originalFetch;client.close();fs.rmSync(dir,{recursive:true,force:true});});

test('Cloudflare seed generates, reviews and publishes in separate bounded invocations and releases each lock',async()=>{
 await request(async()=>assert.rejects(pipeline.seedEnhanced('owner'),e=>e.code==='LLM_DEFERRED' && e.message==='initial_posts_review'));
 assert.equal(network,1);
 assert.equal((await client.execute('SELECT COUNT(*) n FROM deployment_locks')).rows[0].n,0);
 assert.equal((await client.execute('SELECT COUNT(*) n FROM content_candidates WHERE reviewed=0')).rows[0].n,4);
 assert.equal((await client.execute('SELECT COUNT(*) n FROM posts')).rows[0].n,0);
 await request(async()=>assert.rejects(pipeline.seedEnhanced('owner'),e=>e.code==='LLM_DEFERRED' && e.message==='initial_posts_publish'));
 assert.equal(network,1);
 assert.equal((await client.execute('SELECT COUNT(*) n FROM posts')).rows[0].n,0);
 await request(async()=>assert.equal(await pipeline.seedEnhanced('owner'),4));
 assert.equal(network,0);
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

test('Cloudflare posting returns a retryable conflict during a world update, then saves the post after release',async()=>{
 const http=require('node:http');
 const {app}=require('../server');
 const {generateToken}=require('../src/middleware/auth');
 let completed;
 const server=http.createServer((req,res)=>{
  trace=[];network=0;
  const pending=[];
  completed=withDatabase(binding,async()=>{
   await new Promise(resolve=>{res.once('finish',resolve);app(req,res);});
   await Promise.all(pending);
  },{waitUntil(promise){pending.push(promise);}});
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const url=`http://127.0.0.1:${server.address().port}/api/timeline/post`;
 const token=generateToken('owner');
 const send=async()=>{
  const response=await originalFetch(url,{method:'POST',headers:{'content-type':'application/json',authorization:`Bearer ${token}`},body:JSON.stringify({content:'撮影が終わりました。今日は静かな場面の演技に集中できました。'})});
  const data=await response.json(); await completed;
  assert.ok(trace.length+network<=45);
  return {status:response.status,data};
 };
 try {
  await client.execute({sql:'INSERT INTO deployment_locks VALUES(?,?,?)',args:['world:owner','held-by-another-worker',Date.now()+180000]});
  const waiting=await send();
  assert.equal(waiting.status,409);assert.equal(waiting.data.code,'WORLD_BUSY');
  assert.equal((await client.execute("SELECT COUNT(*) n FROM posts WHERE author_type='user'")).rows[0].n,0);
  await client.execute('UPDATE deployment_locks SET expires_at=0');
  const posted=await send();
  assert.equal(posted.status,200);assert.equal(posted.data.success,true);
  assert.equal((await client.execute("SELECT COUNT(*) n FROM posts WHERE author_type='user'")).rows[0].n,1);
  assert.equal((await client.execute('SELECT COUNT(*) n FROM celebrity_scenes')).rows[0].n,1);
  assert.equal((await client.execute('SELECT COUNT(*) n FROM deployment_locks')).rows[0].n,0);
 }finally{await new Promise(resolve=>server.close(resolve));}
});


test('three-provider waterfall stays within the Worker request budget and reviews through the surviving provider',async()=>{
 await client.executeMultiple('DELETE FROM content_candidates; DELETE FROM content_pool_state; DELETE FROM posts; DELETE FROM llm_attempts; DELETE FROM llm_provider_limits;');
 const savedFetch=global.fetch;
 const saved={};
 const settings={LLM_PROVIDER_ORDER:'groq,gemini,openrouter',GROQ_MODELS:'waterfall-groq',GEMINI_MODELS:'waterfall-gemini',OPENROUTER_MODELS:'openrouter/free',GEMINI_API_KEY:'fictional-gemini',OPENROUTER_API_KEY:'fictional-openrouter'};
 for(const [key,value] of Object.entries(settings)){saved[key]=process.env[key];process.env[key]=value;}
 const models=[];
 global.fetch=async(url,options)=>{
  const model=JSON.parse(options.body).model;models.push(model);
  if(model==='waterfall-groq'||model==='waterfall-gemini'){
   network++;
   return new Response(JSON.stringify({error:{message:'fictional unavailable'}}),{status:model==='waterfall-groq'?429:503,headers:{'retry-after':'60'}});
  }
  return savedFetch(url,options);
 };
 try{
  await request(async()=>assert.rejects(pipeline.seedEnhanced('owner'),e=>e.code==='LLM_DEFERRED'&&e.message==='initial_posts_review'));
  assert.equal(network,3);
  assert.deepEqual(models,['waterfall-groq','waterfall-gemini','openrouter/free']);
  await request(async()=>assert.rejects(pipeline.seedEnhanced('owner'),e=>e.code==='LLM_DEFERRED'&&e.message==='initial_posts_publish'));
  assert.equal(network,1);
  await request(async()=>assert.equal(await pipeline.seedEnhanced('owner'),4));
  assert.equal(network,0);
  assert.equal((await client.execute('SELECT COUNT(*) n FROM deployment_locks')).rows[0].n,0);
  assert.equal((await client.execute('SELECT COUNT(*) n FROM posts')).rows[0].n,4);
  process.env.LLM_DAILY_REQUEST_BUDGET='1';
  const before=models.length;
  await request(async()=>assert.rejects(require('../src/services/llm').callLLM('','fictional',64,{userId:'owner'}),e=>e.code==='LLM_DEFERRED'&&e.message==='daily_budget'));
  assert.equal(models.length,before);
 }finally{
  delete process.env.LLM_DAILY_REQUEST_BUDGET;
  global.fetch=savedFetch;
  for(const key of Object.keys(settings)){if(saved[key]===undefined)delete process.env[key];else process.env[key]=saved[key];}
 }
});

async function resetSeedFixture() {
 process.env.GROQ_MODELS='seed-'+require('node:crypto').randomUUID();
 await client.executeMultiple('DELETE FROM content_candidates; DELETE FROM content_pool_state; DELETE FROM posts; DELETE FROM llm_attempts; DELETE FROM llm_provider_limits; DELETE FROM content_events;');
}

test('Cloudflare all-rejected review persists two short retries, respects cooldown on reload and eventually recovers', async()=>{
 await resetSeedFixture();reviewAccepted=false;
 try {
  for(let round=0;round<3;round++){
   await request(async()=>assert.rejects(pipeline.seedEnhanced('owner'),e=>e.message==='initial_posts_review'));
   assert.equal(network,1);
   const reason=round<2?'initial_posts_rejected':'initial_posts_retry_limit';
   const delay=[30000,60000,1800000][round];
   await request(async()=>assert.rejects(pipeline.seedEnhanced('owner'),e=>e.message===reason && Date.parse(e.retryAt)>=Date.now()+delay-1000));
   assert.equal(network,1);
   const before=(await client.execute('SELECT COUNT(*) n FROM llm_attempts')).rows[0].n;
   await request(async()=>assert.rejects(pipeline.seedEnhanced('owner'),e=>e.message===reason));
   assert.equal(network,0);
   assert.equal((await client.execute('SELECT COUNT(*) n FROM llm_attempts')).rows[0].n,before);
   assert.equal((await client.execute("SELECT COUNT(*) n FROM content_events WHERE job='seed_recovery'")).rows[0].n,round+1);
   assert.equal((await client.execute('SELECT COUNT(*) n FROM deployment_locks')).rows[0].n,0);
   if(round<2) await client.execute("UPDATE content_pool_state SET next_fill_at='2000-01-01'");
  }
  assert.equal((await client.execute('SELECT COUNT(*) n FROM posts')).rows[0].n,0);
  await client.execute("UPDATE content_pool_state SET next_fill_at='2000-01-01'");
  reviewAccepted=true;
  await request(async()=>assert.rejects(pipeline.seedEnhanced('owner'),e=>e.message==='initial_posts_review'));
  await request(async()=>assert.rejects(pipeline.seedEnhanced('owner'),e=>e.message==='initial_posts_publish'));
  await request(async()=>assert.equal(await pipeline.seedEnhanced('owner'),4));
 } finally {reviewAccepted=true;}
});

test('three-provider all-rejected review still leaves query and lease cleanup headroom', async(t)=>{
 await resetSeedFixture();
 await request(async()=>assert.rejects(pipeline.seedEnhanced('owner'),e=>e.message==='initial_posts_review'));
 const savedFetch=global.fetch,saved={};
 const settings={LLM_PROVIDER_ORDER:'groq,gemini,openrouter',GEMINI_MODELS:'rejected-gemini',OPENROUTER_MODELS:'openrouter/free',GEMINI_API_KEY:'fictional-gemini',OPENROUTER_API_KEY:'fictional-openrouter'};
 for(const [key,value] of Object.entries(settings)){saved[key]=process.env[key];process.env[key]=value;}
 reviewAccepted=false;
 global.fetch=async(url,options)=>{
  const model=JSON.parse(options.body).model;
  if(model!=='openrouter/free'){
   network++;return new Response(JSON.stringify({error:{message:'fictional unavailable'}}),{status:503});
  }
  return savedFetch(url,options);
 };
 try {
  await request(async()=>assert.rejects(pipeline.seedEnhanced('owner'),e=>e.message==='initial_posts_rejected'));
  assert.equal(network,3);
  t.diagnostic(`rejected recovery: ${trace.length} DB queries + ${network} provider calls, including cleanup`);
  assert.equal((await client.execute('SELECT COUNT(*) n FROM deployment_locks')).rows[0].n,0);
  assert.equal((await client.execute("SELECT COUNT(*) n FROM content_candidates WHERE state='discarded'")).rows[0].n,4);
 } finally {
  reviewAccepted=true;global.fetch=savedFetch;
  for(const key of Object.keys(settings)){if(saved[key]===undefined)delete process.env[key];else process.env[key]=saved[key];}
 }
});

test('existing thirty-minute empty state recovers even when an AI reply was already published',async()=>{
 await resetSeedFixture();
 await client.execute("INSERT INTO posts(id,user_id,author_id,author_type,content) VALUES('seed-parent','owner','owner','user','映画の音楽を聴いています。')");
 await client.execute("INSERT INTO posts(id,user_id,author_id,author_type,content,reply_to,ai) VALUES('seed-reply','owner','c0','ai','映画のサウンドトラックは印象に残りますね。','seed-parent',1)");
 await client.execute({sql:"INSERT INTO content_pool_state(user_id,next_fill_at,theme_version) VALUES('owner',?,1)",args:[new Date(Date.now()+1800000).toISOString()]});
 await request(async()=>assert.rejects(pipeline.seedEnhanced('owner'),e=>e.message==='initial_posts_rejected' && Date.parse(e.retryAt)<Date.now()+31000));
 assert.equal(network,0);
});

test('background review rejection is recovered by the next seed request without another AI call',async()=>{
 await resetSeedFixture();reviewAccepted=false;
 try {
  await request(async()=>assert.rejects(pipeline.seedEnhanced('owner'),e=>e.message==='initial_posts_review'));
  await request(async()=>assert.equal(await pipeline.publishPool('owner'),0));
  assert.equal(network,1);
  await request(async()=>assert.rejects(pipeline.seedEnhanced('owner'),e=>e.message==='initial_posts_rejected'));
  assert.equal(network,0);
 } finally {reviewAccepted=true;}
});
