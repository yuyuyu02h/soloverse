if(process.env.SOLOVERSE_LIVE_AUDIT!=='1')process.exit(2);
const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {createRequire}=require('node:module');const root=path.resolve(__dirname,'../..');const backend=createRequire(path.join(root,'backend/package.json'));
backend('dotenv').config({path:path.join(root,'backend/.env')});
Object.assign(process.env,{DB_PATH:path.join(fs.mkdtempSync(path.join(os.tmpdir(),'sv-review-live-')),'test.db'),CONTENT_PIPELINE:'enhanced',LLM_DAILY_REQUEST_BUDGET:'4',LLM_DAILY_TOKEN_BUDGET:'30000'});
const {db,initDB}=backend('./src/db/schema');const {evaluate}=backend('./src/services/contentQuality');const {reviewBatch}=backend('./src/services/contentReview');
(async()=>{
 await initDB();await db.execute("INSERT INTO users(id,email,password_hash,username) VALUES('audit','audit@test.invalid','unused','audit')");
 const settings={interests:'スターウォーズ'};
 const original=JSON.parse(fs.readFileSync(path.join(__dirname,'live-results.json'),'utf8')).worlds[0].candidates;
 const local=original.map(c=>({content:c.content,assessment:evaluate(c.content,{settings,profile:{topics:[],preferences:[]}})}));
 const eligible=local.filter(c=>c.assessment.accepted);
 const verdicts=await reviewBatch('audit',settings,eligible,{priority:'interactive'});
 const result={syntheticOnly:true,ruleDecisions:local,reviewDecisions:eligible.map((c,i)=>({content:c.content,...verdicts[i]})),attempts:(await db.execute('SELECT provider,model,outcome FROM llm_attempts')).rows};
 fs.writeFileSync(path.join(__dirname,'review-results.json'),JSON.stringify(result,null,2));
 console.log(JSON.stringify({candidates:original.length,ruleRejected:local.filter(c=>!c.assessment.accepted).length,reviewRejected:verdicts.filter(v=>!v.accepted).length,accepted:verdicts.filter(v=>v.accepted).length,attempts:result.attempts},null,2));
})().catch(e=>{console.error(e.message);process.exitCode=1}).finally(()=>db.close());
