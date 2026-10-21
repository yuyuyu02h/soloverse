// Resume the already pending fictional scene after the provider's token reset.
const fs=require('node:fs'),path=require('node:path'),{createRequire}=require('node:module');
if(process.env.SOLOVERSE_LIVE_MODES!=='1')throw Error('Explicit fictional-data opt-in required');
const backend=createRequire(path.resolve(__dirname,'../../backend/package.json'));
backend('dotenv').config({path:path.resolve(__dirname,'../../backend/.env'),quiet:true});
Object.assign(process.env,{DB_PATH:path.join(fs.readFileSync('/tmp/soloverse-modes-followup-current','utf8'),'live.db'),CONTENT_PIPELINE:'enhanced',CONTENT_REVIEW:'true',LLM_PROVIDER_ORDER:'groq',GROQ_MODELS:'openai/gpt-oss-120b',LLM_DAILY_REQUEST_BUDGET:'30',LLM_DAILY_TOKEN_BUDGET:'200000'});
const originalFetch=global.fetch;let requests=0;global.fetch=(url,options)=>{if(++requests>3)throw Error('Audience check cap reached');return originalFetch(url,options);};
const {db,initDB}=backend('./src/db/schema'),{processPendingCelebrityScenes}=backend('./src/services/celebrityMode');
const result={fictionalOnly:true,requestCap:3};
(async()=>{await initDB();result.processed=await processPendingCelebrityScenes();result.scene=(await db.execute("SELECT status FROM celebrity_scenes WHERE post_id='reviewed-celebrity-post'")).rows[0];result.comments=(await db.execute("SELECT content,category FROM celebrity_comments WHERE scene_post_id='reviewed-celebrity-post' ORDER BY created_at LIMIT 8")).rows;})().catch(e=>{result.error=e.message;process.exitCode=1;}).finally(()=>{result.requests=requests;fs.writeFileSync(path.join(__dirname,'live-audience-results.json'),JSON.stringify(result,null,2));db.close();console.log('Fictional audience check:',JSON.stringify({processed:result.processed,status:result.scene?.status,requests,error:result.error}));});
