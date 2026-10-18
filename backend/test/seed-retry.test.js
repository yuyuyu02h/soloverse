const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const ts=require('../../frontend/node_modules/typescript');
const flush=()=>new Promise(resolve=>setImmediate(resolve));
function harness(fetcher=async()=>new Response('{}')) {
  const intervals=new Map(),timers=new Map(),storage=new Map(),navigations=[];
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
  const context={window,document,localStorage,Event,Error,process:{env:{}},fetch:fetcher,console,setInterval:window.setInterval,clearInterval:window.clearInterval,Date:class extends Date{static now(){return now}},setTimeout:(fn,delay)=>{timers.set(++nextId,{fn,due:now+delay});return nextId},clearTimeout:id=>timers.delete(id),IntersectionObserver:class{observe(){}disconnect(){}}};
  function load(file,imports={}) {
    const source=fs.readFileSync(path.join(__dirname,'../../frontend',file),'utf8');
    const code=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2021,jsx:ts.JsxEmit.ReactJSX}}).outputText;
    const module={exports:{}};
    vm.runInNewContext(code,{...context,module,exports:module.exports,require:name=>{
      if(name in imports)return imports[name];
      if(name.endsWith('/visiblePolling'))return{startVisiblePolling:()=>()=>{}};
      if(name==='react')return react;
      if(name==='react/jsx-runtime')return{jsx,jsxs:jsx};
      if(name==='next/navigation')return{useRouter:()=>router};
      if(name==='motion/react')return{useReducedMotion:()=>false,motion:{div:'div'},AnimatePresence:'presence'};
      if(name.endsWith('.css'))return{default:{}};
      return{};
    }});return module.exports;
  }
  const api=load('lib/api.ts',{'./deployment':{SCREEN_PREVIEW:false}});

  function render(Component,props={}){index=0;tree=Component(props);const effects=pending;pending=[];effects.forEach(f=>f());return tree}
  function elements(node){if(arguments.length===0)node=tree;if(!node||typeof node!=='object')return[];if(Array.isArray(node))return node.flatMap(elements);return[node,...elements(node.props?.children)]}
  function text(node){if(arguments.length===0)node=tree;if(node==null||typeof node==='boolean')return'';if(typeof node!=='object')return String(node);if(Array.isArray(node))return node.map(text).join('');return text(node.props?.children)}
  return{...context,api,load,render,elements,text,navigations,intervals,async tick(ms){now+=ms;for(const [id,t] of [...timers])if(t.due<=now){timers.delete(id);t.fn()}for(const fn of [...intervals.values()])fn();await flush();await flush()},unmount(){for(const s of slots)s?.cleanup?.()},hide(){document.visibilityState='hidden';document.dispatchEvent(new Event('visibilitychange'))},show(){document.visibilityState='visible';document.dispatchEvent(new Event('visibilitychange'))}};
}

for(const reason of ['initial_posts_rejected','initial_posts_retry_limit','provider_quota'])test('initial-post retry scheduling: '+reason,async()=>{
 let seeds=0;
 const h=harness(async url=>new Response(JSON.stringify(url.endsWith('/me')?{userId:'A',username:'A',onboardingDone:true}:url.endsWith('/seed')?(++seeds===1?{status:'waiting',reason,retryAt:new Date(30000).toISOString(),message:'候補の確認結果による待機'}:{}):url.includes('/timeline?')?{posts:[],themeVersion:1}:{})));
 const Page=h.load('app/timeline/page.tsx',{'../../lib/api':h.api,'../../lib/deployment':{}}).default;
 h.render(Page);await flush();await flush();h.render(Page);
 assert.equal(seeds,1);
 await h.tick(29999);assert.equal(seeds,1);
 h.hide();await h.tick(1);h.render(Page);assert.equal(seeds,1);
 h.show();await flush();await flush();h.render(Page);
 assert.equal(seeds,reason==='initial_posts_rejected'?2:1);
 await h.tick(300000);assert.equal(seeds,reason==='initial_posts_rejected'?2:1);
 h.unmount();
});
