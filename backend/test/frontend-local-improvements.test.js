const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const ts=require('../../frontend/node_modules/typescript');
const flush=()=>new Promise(resolve=>setImmediate(resolve));
function harness(fetcher=async()=>new Response('{}')) {
  const intervals=new Map(),storage=new Map(),navigations=[];
  let nextId=0,now=0,index=0,pending=[],tree;
  const slots=[];
  const window=Object.assign(new EventTarget(),{ location:{pathname:'/',href:'/'},setInterval:fn=>{intervals.set(++nextId,fn);return nextId},clearInterval:id=>intervals.delete(id) });
  const document=Object.assign(new EventTarget(),{visibilityState:'visible'});
  const localStorage={getItem:k=>storage.get(k)??null,setItem:(k,v)=>storage.set(k,v),removeItem:k=>storage.delete(k)};
  const react={
    useState(initial){const i=index++;if(!(i in slots))slots[i]=initial;return[slots[i],value=>{slots[i]=typeof value==='function'?value(slots[i]):value}]},
    useRef(initial){const i=index++;return slots[i] ||= {current:initial}},
    useCallback:fn=>fn,
    useLayoutEffect(){},
    useEffect(effect,deps){const i=index++,old=slots[i];if(old && deps && deps.every((d,j)=>Object.is(d,old.deps[j])))return;pending.push(()=>{old?.cleanup?.();slots[i]={deps,cleanup:effect()}})},
  };
  const jsx=(type,props)=>({type,props});
  const router={replace:url=>navigations.push(url)};
  const context={window,document,localStorage,Event,Error,process:{env:{}},fetch:fetcher,console,Date:class extends Date{static now(){return now}},setTimeout:()=>0,clearTimeout(){},IntersectionObserver:class{observe(){}disconnect(){}}};
  function load(file,imports={}) {
    const source=fs.readFileSync(path.join(__dirname,'../../frontend',file),'utf8');
    const code=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2021,jsx:ts.JsxEmit.ReactJSX}}).outputText;
    const module={exports:{}};
    vm.runInNewContext(code,{...context,module,exports:module.exports,require:name=>{
      if(name in imports)return imports[name];
      if(name==='react')return react;
      if(name==='react/jsx-runtime')return{jsx,jsxs:jsx};
      if(name==='next/navigation')return{useRouter:()=>router};
      if(name==='motion/react')return{useReducedMotion:()=>false,motion:{div:'div'},AnimatePresence:'presence'};
      if(name.endsWith('.css'))return{default:{}};
      return{};
    }});return module.exports;
  }
  const api=load('lib/api.ts',{'./deployment':{SCREEN_PREVIEW:false}});
  const polling=load('lib/visiblePolling.ts');
  const updates=load('lib/timelineUpdates.ts');
  function render(Component,props={}){index=0;tree=Component(props);const effects=pending;pending=[];effects.forEach(f=>f());return tree}
  function elements(node){if(arguments.length===0)node=tree;if(!node||typeof node!=='object')return[];if(Array.isArray(node))return node.flatMap(elements);return[node,...elements(node.props?.children)]}
  function text(node){if(arguments.length===0)node=tree;if(node==null||typeof node==='boolean')return'';if(typeof node!=='object')return String(node);if(Array.isArray(node))return node.map(text).join('');return text(node.props?.children)}
  return{...context,api,polling,updates,load,render,elements,text,navigations,intervals,async tick(ms){now+=ms;for(const fn of [...intervals.values()])fn();await flush();await flush()},unmount(){for(const s of slots)s?.cleanup?.()},hide(){document.visibilityState='hidden';document.dispatchEvent(new Event('visibilitychange'))},show(){document.visibilityState='visible';document.dispatchEvent(new Event('visibilitychange'))}};
}

for(const failure of ['503','offline'])test('home preserves session on '+failure+' and its retry restores the timeline',async()=>{
 let failing=true;
 const h=harness(async()=>{if(failing){if(failure==='offline')throw new Error('offline');return new Response(JSON.stringify({error:'一時障害'}),{status:503})}return new Response(JSON.stringify({userId:'A',username:'A',onboardingDone:true}))});
 h.api.setToken('valid');h.api.setUser({userId:'A',username:'A'});
 const Home=h.load('app/page.tsx',{'../lib/api':h.api,'../lib/deployment':{SCREEN_PREVIEW:false,PRIVATE_APP:false}}).default;
 h.render(Home);await flush();h.render(Home);
 assert.equal(h.api.getToken(),'valid');assert.equal(h.api.getUser().userId,'A');assert.equal(h.navigations.length,0);
 const retry=h.elements().find(e=>e.type==='button'&&h.text(e)==='ログイン状態を再確認する');assert.ok(retry);
 failing=false;retry.props.onClick();h.render(Home);await flush();
 assert.deepEqual(h.navigations,['/timeline']);assert.equal(h.api.getToken(),'valid');h.unmount();
});

test('home still clears a truly invalid session and enables ordinary login',async()=>{
 const h=harness(async()=>new Response(JSON.stringify({error:'expired'}),{status:401}));h.api.setToken('expired');h.api.setUser({userId:'A',username:'A'});
 const Home=h.load('app/page.tsx',{'../lib/api':h.api,'../lib/deployment':{SCREEN_PREVIEW:false,PRIVATE_APP:false}}).default;
 h.render(Home);await flush();h.render(Home);assert.equal(h.api.getToken(),null);assert.equal(h.api.getUser(),null);
 const submit=h.elements().find(e=>e.type==='button'&&e.props.type==='submit');assert.equal(submit.props.disabled,false);h.unmount();
});

test('visible polling pauses hidden reads, resumes immediately, prevents overlap and removes listeners',async()=>{
 const h=harness();let calls=0,finish;
 const stop=h.polling.startVisiblePolling(()=>{calls++;return new Promise(resolve=>finish=resolve)},5000);
 await h.tick(5000);await h.tick(5000);assert.equal(calls,1);
 h.hide();await h.tick(30000);assert.equal(calls,1);
 h.show();finish();await flush();assert.equal(calls,2);
 stop();finish();await flush();h.hide();h.show();await h.tick(30000);assert.equal(calls,2);assert.equal(h.intervals.size,0);
});

test('delta fetching drains every bounded page and stops for hidden tabs or changed worlds',async()=>{
 const h=harness(),paths=[];
 const get=async p=>{paths.push(p);return paths.length===1?{posts:[{id:'new'}],themeVersion:1,deltaCursor:{before:'2026-10-01 00:00:00',beforeId:'new'}}:{posts:[{id:'older'}],themeVersion:1,deltaCursor:null}};
 const result=await h.updates.getTimelineUpdates(get,'2026-09-01',true,()=>true);
 assert.deepEqual(Array.from(result.posts,p=>p.id),['new','older']);assert.match(paths[1],/history=true&before=/);assert.match(paths[0],/delta=true/);
 let active=true,count=0;
 assert.equal(await h.updates.getTimelineUpdates(async()=>{count++;active=false;return{posts:[],themeVersion:1,deltaCursor:{before:'x',beforeId:'x'}}},'old',false,()=>active),null);assert.equal(count,1);
 let page=0;
 const changed=await h.updates.getTimelineUpdates(async()=>++page===1?{posts:[{id:'old-world'}],themeVersion:1,deltaCursor:{before:'x',beforeId:'x'}}:{posts:[{id:'new-world'}],themeVersion:2},'old',false,()=>true);
 assert.equal(changed.themeVersion,2);assert.equal(changed.posts.length,0);
});

for(const mode of ['hobby','celebrity'])test(mode+' timeline preserves update cadence and combines the thirty-second refresh',async()=>{
 const requests=[];const post={id:'p',content:'映画',created_at:'2026-10-01T00:00:00Z',author_name:'A',author_handle:'A',author_type:'user',experience_mode:mode};
 const h=harness(async url=>{requests.push(url);return new Response(JSON.stringify(url.endsWith('/me')?{userId:'A',username:'A',onboardingDone:true}:url.includes('/timeline?')?{posts:[post],themeVersion:1}:url.endsWith('/unread-count')?{count:0}:{}))});
 const Page=h.load('app/timeline/page.tsx',{'../../lib/api':h.api,'../../lib/deployment':{},'../../lib/visiblePolling':h.polling,'../../lib/timelineUpdates':h.updates}).default;
 h.render(Page);await flush();await flush();h.render(Page);requests.length=0;
 await h.tick(5000);assert.equal(requests.length,mode==='celebrity'?2:0);
 requests.length=0;await h.tick(25000);assert.equal(requests.length,3); // delta, known IDs, unread count; no duplicate fast refresh
 h.hide();requests.length=0;await h.tick(30000);assert.equal(requests.length,0);
 h.show();await flush();await flush();assert.equal(requests.length,3);h.unmount();assert.equal(h.intervals.size,0);
});

test('a saved reply remains visible and cannot be mistaken for a failed send when its reload fails',async()=>{
 const h=harness();let gets=0,sends=0;
 const api={get:async()=>{if(++gets>1)throw new Error('reload outage');return{replies:[]}},post:async()=>{sends++;return{post:{id:'saved',content:'映画の話を続けたい',author_name:'A',author_handle:'A',created_at:'2026-10-01',author_type:'user'}}}};
 const Panel=h.load('components/ReplyPanel.tsx',{'../lib/api':{api},'../lib/visiblePolling':h.polling,'./utils':{renderContent:s=>s,timeAgo:()=>''}}).ReplyPanel;
 const props={post:{id:'parent',author_name:'住人',author_handle:'resident',content:'映画'},currentUser:{userId:'A',username:'A'},onClose(){}};
 h.render(Panel,props);await flush();h.render(Panel,props);
 h.elements().find(e=>e.type==='textarea').props.onChange({target:{value:'映画の話を続けたい'}});h.render(Panel,props);
 await h.elements().find(e=>e.type==='button'&&h.text(e)==='返信').props.onClick();h.render(Panel,props);
 assert.equal(sends,1);assert.equal(h.elements().find(e=>e.type==='textarea').props.value,'');
 assert.match(h.text(),/返信は送信済み/);assert.match(h.text(),/映画の話を続けたい/);assert.doesNotMatch(h.text(),/返信に失敗しました/);h.unmount();
});
