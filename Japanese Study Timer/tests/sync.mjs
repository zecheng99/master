import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {DatabaseSync} from 'node:sqlite';
const root=new URL('../',import.meta.url);
const source=readFileSync(new URL('sync-worker/src/index.js',root),'utf8');
const {default:worker}=await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));
const html=readFileSync(new URL('index.html',root),'utf8');
const storage=html.slice(html.indexOf("const KEY = 'jp-study-sessions'"),html.indexOf('// ── Tab Navigation'));
const client=html.slice(html.indexOf('const SYNC_URL_KEY'),html.indexOf('let toastTimer = null'));
const key='local-only-test-sync-key-123456789';
const session=id=>({id,date:'2026-11-09',duration:600,topic:'日语',startTime:'10:00'});
function backend(){
 const sql=new DatabaseSync(':memory:');sql.exec(readFileSync(new URL('sync-worker/schema.sql',root),'utf8'));
 const env={SYNC_KEY:key,DB:{prepare(query){let values=[];return {bind(...args){values=args;return this;},async all(){return {results:sql.prepare(query).all(...values)};},async first(){return sql.prepare(query).get(...values)||null;},run(){return sql.prepare(query).run(...values);}};},async batch(stmts){sql.exec('BEGIN');try{const out=stmts.map(s=>s.run());sql.exec('COMMIT');return out;}catch(e){sql.exec('ROLLBACK');throw e;}}}};
 return env;
}
function device(env,{connected=true}={}){
 const saved=new Map(),elements=new Map(),timers=[];
 if(connected)saved.set('jp-sync-token',key);
 const ctx=vm.createContext({console,URL,Date,JSON,Math,AbortController,navigator:{onLine:true},
 localStorage:{getItem:k=>saved.get(k)??null,setItem:(k,v)=>saved.set(k,String(v)),removeItem:k=>saved.delete(k)},
 setTimeout:fn=>{timers.push(fn);return timers.length;},clearTimeout(){},
 document:{getElementById(id){if(!elements.has(id))elements.set(id,{value:'',textContent:'',hidden:false,type:'password',classList:{contains:()=>false}});return elements.get(id);}},
 editingId:null,todayStr:()=> '2026-11-09',showToast(){},renderAll(){},renderStats(){},
 fetch:(url,opts)=>worker.fetch(new Request(url,{...opts,headers:{...opts.headers,Origin:'https://zecheng99.github.io'}}),env)});
 vm.runInContext(storage+'\n'+client,ctx);
 return {ctx,saved,elements,timers,run:s=>vm.runInContext(s,ctx),sync:()=>ctx.doSync(),
 read:()=>JSON.parse(saved.get('jp-study-sessions')||JSON.stringify({sessions:[],settings:{dailyGoalMinutes:30,weeklyGoalDays:6},activeTimer:null})),
 write(data){saved.set('jp-study-sessions',JSON.stringify(data));}};
}
const delay=()=>new Promise(resolve=>setTimeout(resolve,3));
test('new origin passes CORS; unauthenticated sync is rejected without caching',async()=>{
 const env=backend();const response=await worker.fetch(new Request('https://sync.test/sync',{method:'POST',headers:{Origin:'https://zecheng99.github.io'},body:'{}'}),env);
 assert.equal(response.status,401);assert.equal(response.headers.get('Access-Control-Allow-Origin'),'https://zecheng99.github.io');assert.equal(response.headers.get('Cache-Control'),'no-store');
});
test('default endpoint needs a user-provided key; no key leaves local data untouched',async()=>{
 const a=device(backend(),{connected:false});a.write({...a.read(),sessions:[session('one')]});let calls=0;a.ctx.fetch=()=>{calls++;throw Error();};await a.sync();assert.equal(calls,0);assert.equal(a.read().sessions.length,1);assert.equal(a.ctx.syncCfg().url,'https://jp-study-sync.zechengyu90.workers.dev');
});
test('two devices merge offline additions, edits, deletions and goals; timers stay local',async()=>{
 const env=backend(),a=device(env),b=device(env);
 a.write({...a.read(),sessions:[session('one')],settings:{dailyGoalMinutes:60,weeklyGoalDays:5},activeTimer:{running:true}});
 await a.sync();await delay();await b.sync();assert.deepEqual(b.read().sessions,a.read().sessions);assert.equal(b.read().settings.dailyGoalMinutes,60);assert.equal(b.read().activeTimer,null);
 b.ctx.navigator.onLine=false;b.write({...b.read(),sessions:[...b.read().sessions,session('two')]});await b.sync();assert.equal(a.read().sessions.length,1);
 b.ctx.navigator.onLine=true;await delay();await b.sync();await delay();await a.sync();assert.equal(a.read().sessions.length,2);assert.deepEqual(a.read().sessions,b.read().sessions);
 a.write({...a.read(),sessions:a.read().sessions.filter(s=>s.id!=='one')});await delay();await a.sync();await b.sync();assert.deepEqual(b.read().sessions.map(s=>s.id),['two']);
 b.write({...b.read(),sessions:[{...session('two'),duration:1200}]});await delay();await b.sync();await a.sync();assert.equal(a.read().sessions[0].duration,1200);assert.equal(a.read().activeTimer.running,true);
});
test('failed uploads remain pending and a retry commits them',async()=>{
 const env=backend(),a=device(env);a.write({...a.read(),sessions:[session('one')]});const original=a.ctx.fetch;a.ctx.fetch=async()=>{throw Error('offline');};await a.sync();assert.equal(a.saved.get('jp-sync-snap'),undefined);assert.equal(a.read().sessions.length,1);a.ctx.fetch=original;await a.sync();const b=device(env);await b.sync();assert.equal(b.read().sessions.length,1);
});
test('edits during upload queue another sync and preserve new records',async()=>{
 const env=backend(),a=device(env);a.write({...a.read(),sessions:[session('one')]});const original=a.ctx.fetch;let once=true;
 a.ctx.fetch=async(...args)=>{const res=await original(...args);if(once){once=false;a.write({...a.read(),sessions:[...a.read().sessions,session('two')]});await a.sync();}return res;};
 await a.sync();assert.equal(a.read().sessions.length,2);assert.ok(a.timers.length);await delay();await a.sync();const b=device(env);await b.sync();assert.equal(b.read().sessions.length,2);
});
test('configuration validation protects keys and switching connection resets every baseline',()=>{
 const a=device(backend());a.saved.set('jp-sync-seth','old');a.saved.set('jp-sync-at','99');a.saved.set('jp-sync-snap','{}');a.ctx.loadSyncCfg();a.ctx.document.getElementById('syncUrl');a.ctx.document.getElementById('syncToken');
 a.elements.get('syncUrl').value='http://example.com';a.elements.get('syncToken').value=key;a.ctx.saveSyncCfg();assert.equal(a.saved.get('jp-sync-url'),undefined);
 a.elements.get('syncUrl').value='https://different.example';a.ctx.navigator.onLine=false;a.ctx.saveSyncCfg();assert.equal(a.saved.get('jp-sync-seth'),undefined);assert.equal(a.saved.get('jp-sync-at'),undefined);assert.equal(a.saved.get('jp-sync-token'),key);
});
test('old connection replies cannot change new connection data or cursors',async()=>{
 const a=device(backend());const original=a.ctx.fetch;a.ctx.fetch=async(...args)=>{const res=await original(...args);a.saved.set('jp-sync-token','different-key-with-enough-characters');return res;};await a.sync();assert.equal(a.saved.get('jp-sync-at'),undefined);assert.equal(a.saved.get('jp-sync-snap'),undefined);assert.ok(a.timers.length);
});
