// Explicit opt-in; only synthetic data is sent to the configured cloud providers.
if (process.env.SOLOVERSE_LIVE_AUDIT !== '1') process.exit(2);
const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {createRequire}=require('node:module');
const root=path.resolve(__dirname,'../..');
const backend=createRequire(path.join(root,'backend/package.json'));
backend('dotenv').config({path:path.join(root,'backend/.env')});
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'sv-evolution-live-'));
Object.assign(process.env,{DB_PATH:path.join(dir,'live.db'),JWT_SECRET:'evolution-live-only-signing-secret-long-enough',BACKGROUND_JOBS:'false',CONTENT_PIPELINE:'enhanced',CONTENT_POOL_SIZE:'8',CONTENT_TEMPLATES:'false',CONTENT_REVIEW:'true',LLM_DAILY_REQUEST_BUDGET:'16',LLM_DAILY_TOKEN_BUDGET:'100000',LLM_TOTAL_TIMEOUT_MS:'90000'});
fs.writeFileSync('/tmp/soloverse-evolution-current',dir);
const {db}=backend('./src/db/schema');
const {startServer,shutdown}=backend('./server');
const {publishPool}=backend('./src/services/contentPipeline');
const {processReactionQueue}=backend('./src/services/reactionScheduler');
let server,base,token,userId;
const results={syntheticOnly:true,requestCap:16,worlds:[]};
async function api(route,body){const response=await fetch(base+route,{method:body===undefined?'GET':'POST',headers:{'content-type':'application/json',...(token?{authorization:`Bearer ${token}`}:{})},...(body===undefined?{}:{body:JSON.stringify(body)})});const data=await response.json();if(!response.ok)throw Error(`${route}: HTTP ${response.status}: ${data.error}`);return data;}
async function materialize(){
  await db.execute({sql:"UPDATE content_candidates SET scheduled_at=datetime('now','-1 second') WHERE user_id=? AND state='pending'",args:[userId]});
  await publishPool(userId);await publishPool(userId);
}
async function answer(postId){
  const queued=(await db.execute({sql:"SELECT id,character_id FROM reaction_queue WHERE user_id=? AND post_id=? AND reaction_type='reply' AND done=0 ORDER BY scheduled_at LIMIT 1",args:[userId,postId]})).rows[0];
  if(!queued)return {error:'no reply reserved'};
  await db.execute({sql:"UPDATE reaction_queue SET scheduled_at=datetime('now','+1 day') WHERE user_id=? AND done=0",args:[userId]});
  await db.execute({sql:"UPDATE reaction_queue SET scheduled_at=datetime('now','-1 second') WHERE id=?",args:[queued.id]});
  await processReactionQueue();
  return {reservedAuthor:queued.character_id,replies:(await api('/api/timeline/replies/'+postId)).replies.map(p=>({id:p.id,author_id:p.author_id,author:p.author_handle,content:p.content}))};
}
async function capture(theme){
  console.log('[Live check] Preparing:',theme);
  await api('/api/timeline/seed',{});await materialize();
  const world=await api('/api/onboarding/world');
  const posts=(await api('/api/timeline')).posts;
  const candidates=(await db.execute({sql:'SELECT c.content,c.parent_id,c.state,c.theme_version,c.reviewed FROM content_candidates c WHERE user_id=? AND theme_version=?',args:[userId,world.settings.theme_version]})).rows;
  const entry={theme,residents:world.characters.length,themeVersion:world.settings.theme_version,posts:posts.map(p=>({id:p.id,author:p.author_handle,content:p.content,replies:p.reply_preview.map(r=>({author:r.author_handle,content:r.content}))})),candidates};
  results.worlds.push(entry);return entry;
}
async function main(){
  server=await startServer(0);base=`http://127.0.0.1:${server.address().port}`;
  const auth=await api('/api/auth/register',{email:'evolution@test.invalid',password:'AuditOnly2026!',username:'動作検証'});token=auth.token;userId=auth.userId;
  await api('/api/onboarding/submit',{position:'empathy',interests:'スターウォーズ',atmosphere:'calm',exclusions:['no_criticism']});
  const first=await capture('スターウォーズ');
  const question='スターウォーズで一番好きなキャラクターは誰？理由も教えて。';
  const posted=await api('/api/timeline/post',{content:question});
  first.question=question;first.answer=await answer(posted.post.id);
  const reply=first.answer.replies?.[0];
  if(reply){const followup=await api('/api/timeline/post',{content:'そのキャラクターの魅力を知るには、どの場面を見直すといい？',replyTo:reply.id});first.followup={scheduled:followup.scheduled,answer:await answer(followup.post.id)};}
  const before=(await db.execute({sql:'SELECT id,content,author_id,reply_to FROM posts WHERE user_id=? ORDER BY id',args:[userId]})).rows;
  console.log('[Live check] Switching the same account to programming / VTuber');
  results.switch=await api('/api/onboarding/theme',{interests:'プログラミング, VTUBER'});
  const second=await capture('プログラミング, VTUBER');
  const question2='Pythonのリストとタプルはどう使い分ける？初心者向けに理由も教えて。';
  const posted2=await api('/api/timeline/post',{content:question2});second.question=question2;second.answer=await answer(posted2.post.id);
  const after=(await db.execute({sql:'SELECT id,content,author_id,reply_to FROM posts WHERE user_id=? AND theme_version=1 ORDER BY id',args:[userId]})).rows;
  results.historyPreserved=JSON.stringify(before)===JSON.stringify(after);
  results.historyVisible=(await api('/api/timeline?history=true')).posts.some(p=>p.archived);
  results.oldPending=(await db.execute({sql:"SELECT COUNT(*) n FROM content_candidates WHERE user_id=? AND theme_version=1 AND state='pending'",args:[userId]})).rows[0].n;
  results.attempts=(await db.execute('SELECT provider,model,outcome,COUNT(*) n,SUM(tokens) tokens FROM llm_attempts GROUP BY provider,model,outcome')).rows;
  results.reviewCalls=(await db.execute("SELECT COUNT(*) n FROM llm_attempts WHERE job='content_review'")).rows[0].n;
  results.rejections=(await db.execute("SELECT reason,COUNT(*) n FROM content_events WHERE outcome='rejected' GROUP BY reason")).rows;
}
main().catch(error=>{results.error=error.message;console.error('[Live check]',error.message);process.exitCode=1;}).finally(async()=>{fs.writeFileSync(path.join(__dirname,'live-results.json'),JSON.stringify(results,null,2));console.log('[Live check] Results saved; temporary DB:',dir);if(server)await shutdown(server);else db.close();});
