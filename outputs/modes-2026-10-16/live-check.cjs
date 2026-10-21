// Opt-in live check. Fictional data only, isolated database, bounded provider requests.
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{createRequire}=require('node:module');
if(process.env.SOLOVERSE_LIVE_MODES!=='1')throw Error('Set SOLOVERSE_LIVE_MODES=1 for the explicitly authorized fictional-data check');
const backend=createRequire(path.resolve(__dirname,'../../backend/package.json'));
backend('dotenv').config({path:path.resolve(__dirname,'../../backend/.env'),quiet:true});
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'sv-modes-live-'));
Object.assign(process.env,{DB_PATH:path.join(dir,'live.db'),JWT_SECRET:'fictional-mode-live-check-signing-secret',BACKGROUND_JOBS:'false',CONTENT_PIPELINE:'enhanced',CONTENT_POOL_SIZE:'4',CONTENT_REFILL_ATTEMPTS:'1',CONTENT_TEMPLATES:'false',CONTENT_REVIEW:'true',LLM_DAILY_REQUEST_BUDGET:'18',LLM_DAILY_TOKEN_BUDGET:'100000',ADMIN_USER_IDS:''});
const originalFetch=global.fetch;let externalCalls=0;
global.fetch=(url,options)=>{if(!/^http:\/\/(127\.0\.0\.1|localhost):/.test(String(url))&&++externalCalls>18)throw Error('Fictional-data check request cap reached');return originalFetch(url,options);};
const {db}=backend('./src/db/schema'),{startServer,shutdown}=backend('./server');
const {themeState}=backend('./src/services/worldTheme'),{generateReply,publishPool}=backend('./src/services/contentPipeline');
const {processPendingCelebrityScenes}=backend('./src/services/celebrityMode');
const result={fictionalOnly:true,requestCap:18,worlds:[]};let server,base,token,userId;
async function api(route,body){const response=await fetch(base+route,{method:body===undefined?'GET':'POST',headers:{'content-type':'application/json',...(token?{authorization:`Bearer ${token}`}:{})},...(body===undefined?{}:{body:JSON.stringify(body)})});const data=await response.json();if(!response.ok)throw Error(`${route}: ${response.status}: ${data.error}`);return data;}
(async()=>{
 server=await startServer(0);base='http://127.0.0.1:'+server.address().port;
 for(const [mode,key,context] of [['hobby','hobbies','自作キーボード'],['community','community','V系界隈'],['celebrity','celebrityRole','ソロのロックミュージシャン']]){
  console.log('Checking fictional mode:',mode);
  token=null;const auth=await api('/api/auth/register',{email:`${mode}@modes-test.invalid`,password:'FictionalOnly2026!',username:`架空検証_${mode}`});token=auth.token;userId=auth.userId;
  await api('/api/onboarding/submit',{mode,[key]:context,atmosphere:'active',exclusions:[]});
  const world=await api('/api/onboarding/world');const entry={mode,context,residents:world.characters.map(c=>({name:c.name,username:c.username,role:c.participation_role,bio:c.bio,personality:c.personality,replyStyle:c.reply_style}))};result.worlds.push(entry);
  try {entry.seed=await api('/api/timeline/seed',{});}catch(e){entry.seed={error:e.message};}
  await db.execute({sql:"UPDATE content_candidates SET scheduled_at=datetime('now','-1 second') WHERE user_id=?",args:[userId]});await publishPool(userId);
  entry.posts=(await api('/api/timeline')).posts.map(p=>({content:p.content,replies:p.reply_preview.map(r=>r.content)}));
  if(mode==='celebrity'){
   const post=await api('/api/timeline/post',{content:'リハーサル終わり。今日は声がよく出て気持ちよかった。'});await processPendingCelebrityScenes();
   entry.audience=(await db.execute({sql:'SELECT content,category FROM celebrity_comments WHERE scene_post_id=? ORDER BY created_at LIMIT 8',args:[post.post.id]})).rows;
  }else{
   const question=mode==='hobby'?'自作キーボードのスイッチを初めて選ぶなら、どこを比べるといい？':'セトリの順番で音源を聴き直すのって、どこが楽しい？';
   try{entry.reply={question,content:await generateReply(userId,world.characters[0],await themeState(userId),question)};}catch(e){entry.reply={question,error:e.message};}
  }
 }
})().catch(error=>{result.error=error.message;console.error('Live check:',error.message);process.exitCode=1;}).finally(async()=>{
 result.externalCalls=externalCalls;result.attempts=(await db.execute('SELECT provider,model,job,outcome,tokens FROM llm_attempts')).rows;
 result.events=(await db.execute('SELECT job,outcome,reason,COUNT(*) AS count FROM content_events GROUP BY job,outcome,reason')).rows;
 fs.writeFileSync(path.join(__dirname,'live-results.json'),JSON.stringify(result,null,2));fs.writeFileSync('/tmp/soloverse-modes-live-current',dir);
 console.log('Fictional-only results saved. Requests:',externalCalls);if(server)await shutdown(server);else db.close();
});
