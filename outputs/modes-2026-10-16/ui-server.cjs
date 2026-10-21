// Isolated, fictional UI data. All cloud generation is stubbed locally.
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{createRequire}=require('node:module');
const backend=createRequire(path.resolve(__dirname,'../../backend/package.json'));
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'sv-mode-ui-'));
Object.assign(process.env,{DB_PATH:path.join(dir,'ui.db'),JWT_SECRET:'mode-ui-test-only-signing-secret-long',BACKGROUND_JOBS:'false',CONTENT_PIPELINE:'enhanced',CONTENT_REVIEW:'true',CONTENT_TEMPLATES:'false',CONTENT_POOL_SIZE:'4',CONTENT_REFILL_ATTEMPTS:'1',GROQ_API_KEY:'ui-stub',GROQ_MODELS:'ui-stub',GEMINI_API_KEY:'',OPENROUTER_API_KEY:'',LLM_PROVIDER_ORDER:'groq',LLM_REQUEST_INTERVAL_MS:'0',ADMIN_USER_IDS:'admin-ui'});
let batch=0;
global.fetch=async(_,options)=>{
 const body=JSON.parse(options.body),prompt=body.messages.at(-1).content,system=body.messages[0].content;
 const context=system.match(/【テーマ・趣味[^\n]*\n([^\n]+)/)?.[1]||'V系界隈';
 const match=prompt.match(/AIキャラクターを(\d+)人/);
 let content;
 if(match){const offset=batch++*5;content=Array.from({length:Number(match[1])},(_,i)=>({name:'検証住人'+(offset+i+1),username:'resident_'+(offset+i),avatar_seed:'seed'+i,bio:context+'の感想を話しています',personality:context+'の話題'+i+'を気軽に楽しむ',interests:context,reply_style:'短く具体的に返す',reaction_frequency:'mid',delay_profile:'normal'}));}
 else if(prompt.includes('検査対象: ')){const rows=JSON.parse(prompt.split('検査対象: ')[1].split('\n各index')[0]);content=rows.map((_,index)=>({index,accepted:true,reason:'accepted'}));}
 else if(prompt.includes('日常投稿を')){
  const names=[...new Set([...prompt.matchAll(/"username":"(resident_\d+)"/g)].map(m=>m[1]))];
  const texts=context.includes('V系')?['セトリの流れが好きで、音源も同じ順番に並べて聴いてる。','対盤で初めて聴いた曲が気になって、帰り道ずっと探してた。','セトリを同じ順番で聴くのわかる。曲のつなぎまで思い出せる感じする。','ライブハウスの後方で全体を見るのも好き。照明と音の重なりがよく分かる。']:context.includes('VTuber')?['歌枠のアーカイブ見てたら、あのサビだけ何度も戻してしまう。','配信の切り抜きから本編まで見始めて、結局最後まで見てしまった。','アーカイブだと好きな歌を繰り返せるのがいい。生配信とは違う楽しさがある。','Live2Dの細かい表情を見るのが好き。目線の動きで印象が変わる。']:[context+'を試して、手順をメモにまとめた。次は別のやり方も比べたい。',context+'の道具を整理したら、忘れていた工夫を思い出した。',context+'の手順のメモ、どこから書き始めると分かりやすい？',context+'の入門記事を読んだ。実際に触ると説明の意味がよく分かった。'];
  content=texts.map((content,i)=>({username:names[i%names.length],content,reply_to_index:i===2?0:null}));
 }else content=context+'の話を気軽に楽しんでいます。';
 return new Response(JSON.stringify({model:'local-ui-stub',choices:[{finish_reason:'stop',message:{content:typeof content==='string'?content:JSON.stringify(content)}}],usage:{total_tokens:100}}),{headers:{'content-type':'application/json'}});
};
const {db}=backend('./src/db/schema'),{startServer,shutdown}=backend('./server');
let server;
(async()=>{server=await startServer(3001);const bcrypt=backend('bcryptjs');const hash=await bcrypt.hash('TestOnly2026!',4);
 for(const id of ['admin-ui','hobby-ui','celebrity-ui','community-ui'])await db.execute({sql:'INSERT INTO users(id,email,password_hash,username) VALUES(?,?,?,?)',args:[id,id+'@test.invalid',hash,id]});
 fs.writeFileSync('/tmp/soloverse-mode-ui-current',dir);console.log('UI fixture ready: isolated DB, admin-ui and three mode users');
})();
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>shutdown(server).finally(()=>process.exit(0)));
