// Local UI fixture: a copy of the synthetic live database, with all cloud calls stubbed.
const fs=require('node:fs'),path=require('node:path'),{createRequire}=require('node:module');
const backend=createRequire(path.resolve(__dirname,'../../backend/package.json'));
Object.assign(process.env,{DB_PATH:fs.readFileSync('/tmp/soloverse-ui-evolution','utf8')+'/live.db',JWT_SECRET:'evolution-live-only-signing-secret-long-enough',BACKGROUND_JOBS:'false',CONTENT_PIPELINE:'enhanced',CONTENT_REVIEW:'true',CONTENT_TEMPLATES:'false',CONTENT_POOL_SIZE:'8',GROQ_API_KEY:'ui-stub-only',GROQ_MODELS:'ui-stub',GEMINI_API_KEY:'',OPENROUTER_API_KEY:'',LLM_PROVIDER_ORDER:'groq',LLM_REQUEST_INTERVAL_MS:'0',LLM_DAILY_REQUEST_BUDGET:'180',LLM_DAILY_TOKEN_BUDGET:'1000000'});
let batch=0;
global.fetch=async(_,options)=>{
 const body=JSON.parse(options.body),prompt=body.messages.at(-1).content;
 let content;
 if(prompt.includes('AIキャラクターを5人')){
  const theme=body.messages[0].content.match(/【テーマ・趣味[^\n]*\n([^\n]+)/)[1],offset=batch++*5;
  content=Array.from({length:5},(_,i)=>({name:'住人'+(offset+i+1),username:'cook_'+(offset+i),avatar_seed:'cook',bio:'料理の工夫を話すのが好き',personality:'料理の手順を丁寧に試す',interests:theme,reply_style:'具体的な理由を添える',reaction_frequency:'mid',delay_profile:'fast'}));
 }else if(prompt.includes('検査対象: ')){
  const rows=JSON.parse(prompt.split('検査対象: ')[1].split('\n各index')[0]);content=rows.map((_,index)=>({index,accepted:true,reason:'accepted'}));
 }else if(prompt.includes('日常投稿を')){
  const names=[...new Set([...prompt.matchAll(/"username":"(cook_\d+)"/g)].map(m=>m[1]))];
  const recipes=['カレーのレシピで玉ねぎをゆっくり炒めた。甘みが出て、家族にも好評だった。','スープ料理は最後に塩を加えると調整しやすい。今日は野菜の味を楽しめた。','料理の本で包丁の持ち方を復習した。材料をそろえるだけでも仕上がりが変わる。','卵焼きのレシピを試した。弱火でゆっくり巻くと、柔らかな食感になった。','パスタ料理のソースに茹で汁を加えてみた。麺との絡みが良くなってうれしい。','パンのレシピに挑戦した。発酵を待つ間にキッチンを片付けると作業が楽だった。','料理の下ごしらえで冷凍野菜を分けて保存した。平日の夕飯に活用したい。','味噌汁のレシピを見直した。だしを丁寧に取ると香りの違いが分かる。'];
  content=recipes.map((content,i)=>({username:names[i%names.length],content,reply_to_index:null}));
 }else content='料理は弱火でゆっくり加熱するのがおすすめ。焦がしにくくて味を確認しやすいから。';
 return new Response(JSON.stringify({model:'local-ui-stub',choices:[{finish_reason:'stop',message:{content:typeof content==='string'?content:JSON.stringify(content)}}],usage:{total_tokens:100}}),{headers:{'content-type':'application/json'}});
};
const {startServer,shutdown}=backend('./server');let server;
startServer(3001).then(s=>server=s).catch(e=>{console.error(e.message);process.exitCode=1});
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>shutdown(server).finally(()=>process.exit(0)));
