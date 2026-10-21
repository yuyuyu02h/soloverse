// Retry only the missing community feed and verify the reviewed audience path.
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{createRequire}=require('node:module');
if(process.env.SOLOVERSE_LIVE_MODES!=='1')throw Error('Explicit fictional-data opt-in required');
const backend=createRequire(path.resolve(__dirname,'../../backend/package.json'));
backend('dotenv').config({path:path.resolve(__dirname,'../../backend/.env'),quiet:true});
const source=fs.readFileSync('/tmp/soloverse-modes-live-current','utf8'),dir=fs.mkdtempSync(path.join(os.tmpdir(),'sv-modes-followup-'));
fs.copyFileSync(path.join(source,'live.db'),path.join(dir,'live.db'));
Object.assign(process.env,{DB_PATH:path.join(dir,'live.db'),JWT_SECRET:'fictional-mode-live-check-signing-secret',BACKGROUND_JOBS:'false',CONTENT_PIPELINE:'enhanced',CONTENT_POOL_SIZE:'4',CONTENT_REFILL_ATTEMPTS:'1',CONTENT_TEMPLATES:'false',CONTENT_REVIEW:'true',LLM_PROVIDER_ORDER:'groq',GROQ_MODELS:'openai/gpt-oss-120b',LLM_DAILY_REQUEST_BUDGET:'26',LLM_DAILY_TOKEN_BUDGET:'200000'});
const originalFetch=global.fetch;let requests=0;
global.fetch=(url,options)=>{if(++requests>6)throw Error('Fictional follow-up request cap reached');return originalFetch(url,options);};
const {db,initDB}=backend('./src/db/schema'),{fillPool,publishPool}=backend('./src/services/contentPipeline'),{createCelebrityScene,processPendingCelebrityScenes}=backend('./src/services/celebrityMode');
const result={fictionalOnly:true,requestCap:6};
(async()=>{
 await initDB();
 const id=(await db.execute("SELECT id FROM users WHERE email='community@modes-test.invalid'")).rows[0].id;
 await db.execute({sql:"UPDATE content_pool_state SET next_fill_at=datetime('now','-1 second') WHERE user_id=?",args:[id]});
 result.communityCandidates=await fillPool(id,{seed:true});
 await db.execute({sql:"UPDATE content_candidates SET scheduled_at=datetime('now','-1 second') WHERE user_id=?",args:[id]});
 result.communityPublished=await publishPool(id);await publishPool(id);
 result.communityPosts=(await db.execute({sql:'SELECT content,reply_to FROM posts WHERE user_id=?',args:[id]})).rows;
 const star=(await db.execute("SELECT id FROM users WHERE email='celebrity@modes-test.invalid'")).rows[0].id;
 const post='reviewed-celebrity-post',text='リハーサル終わり。今日は声がよく出て気持ちよかった。';
 await db.execute({sql:"INSERT INTO posts(id,user_id,author_id,author_type,content) VALUES(?,?,?,'user',?)",args:[post,star,star,text]});
 await createCelebrityScene(star,post,text);result.audienceProcessed=await processPendingCelebrityScenes();
 result.audience=(await db.execute({sql:'SELECT content,category FROM celebrity_comments WHERE scene_post_id=? ORDER BY created_at LIMIT 8',args:[post]})).rows;
 result.events=(await db.execute("SELECT job,outcome,reason,COUNT(*) n FROM content_events GROUP BY job,outcome,reason")).rows;
})().catch(e=>{result.error=e.message;process.exitCode=1;console.error(e.message);}).finally(()=>{result.requests=requests;fs.writeFileSync(path.join(__dirname,'live-followup-results.json'),JSON.stringify(result,null,2));fs.writeFileSync('/tmp/soloverse-modes-followup-current',dir);db.close();console.log('Fictional follow-up saved. Requests:',requests);});
