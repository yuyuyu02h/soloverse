if(process.env.SOLOVERSE_LIVE_AUDIT!=='1')process.exit(2);
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),{randomUUID}=require('node:crypto');
const {createRequire}=require('node:module');const backend=createRequire(path.resolve(__dirname,'../../backend/package.json'));
backend('dotenv').config({path:path.resolve(__dirname,'../../backend/.env')});
const source=fs.readFileSync('/tmp/soloverse-evolution-current','utf8');const dir=fs.mkdtempSync(path.join(os.tmpdir(),'sv-final-followup-'));
fs.copyFileSync(path.join(source,'live.db'),path.join(dir,'copy.db'));
Object.assign(process.env,{DB_PATH:path.join(dir,'copy.db'),CONTENT_PIPELINE:'enhanced',BACKGROUND_JOBS:'false',LLM_DAILY_REQUEST_BUDGET:'18',LLM_DAILY_TOKEN_BUDGET:'120000'});
const {db,initDB}=backend('./src/db/schema');
const {scheduleReplyReactions,processReactionQueue}=backend('./src/services/reactionScheduler');
(async()=>{
 await initDB();
 const user=(await db.execute("SELECT user_id FROM world_settings LIMIT 1")).rows[0].user_id;
 // Replay only the synthetic Star Wars conversation in a disposable snapshot.
 await db.execute({sql:"UPDATE world_settings SET interests='スターウォーズ' WHERE user_id=?",args:[user]});
 await db.execute({sql:"UPDATE world_theme_state SET theme='スターウォーズ',version=1 WHERE user_id=?",args:[user]});
 await db.execute('UPDATE reaction_queue SET done=1');
 const parent=(await db.execute("SELECT id,author_id,content FROM posts WHERE author_type='ai' AND reply_to IS NOT NULL AND theme_version=1 ORDER BY created_at LIMIT 1")).rows[0];
 const id=randomUUID(),question='そのキャラクターの魅力が分かる場面を、台詞を引用せずに教えて。';
 await db.execute({sql:"INSERT INTO posts(id,user_id,author_id,author_type,content,reply_to,theme_version) VALUES(?,?,?,'user',?,?,1)",args:[id,user,user,question,parent.id]});
 const scheduled=await scheduleReplyReactions(user,id,question,parent.id);
 const queued=(await db.execute({sql:"SELECT id FROM reaction_queue WHERE post_id=? ORDER BY scheduled_at LIMIT 1",args:[id]})).rows[0];
 await db.execute({sql:"UPDATE reaction_queue SET scheduled_at=datetime('now','-1 second') WHERE id=?",args:[queued.id]});
 await processReactionQueue();
 const answers=(await db.execute({sql:"SELECT author_id,content FROM posts WHERE reply_to=? AND author_type='ai'",args:[id]})).rows;
 const result={syntheticOnly:true,question,previousAnswer:parent.content,scheduled,answers,sameResident:answers.length>0&&answers[0].author_id===parent.author_id};
 fs.writeFileSync(path.join(__dirname,'followup-results.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));
 if(!result.sameResident)process.exitCode=1;
})().catch(e=>{console.error(e.message);process.exitCode=1}).finally(()=>db.close());
