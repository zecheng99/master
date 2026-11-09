import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {webcrypto} from 'node:crypto';
import vm from 'node:vm';
import worker from '../sync-worker/src/index.js';
const core=readFileSync(new URL('../sync-core.js',import.meta.url),'utf8');
const client=readFileSync(new URL('../cloud-sync.js',import.meta.url),'utf8');
const key='health-test-only-key-123456789';
const food={id:'f1',name:'鸡蛋',unit:'个',proteinPer:7,perAmount:1};
const entry=id=>({id,foodId:'f1',foodName:'鸡蛋',quantity:1,protein:7,timestamp:'10:00'});
const record=(...list)=>({'2026-11-09':{entries:list}});
function backend(){
 const sql=new DatabaseSync(':memory:');sql.exec(readFileSync(new URL('../sync-worker/schema.sql',import.meta.url),'utf8'));
 return {SYNC_KEY:key,DB:{prepare(query){let args=[];return {bind(...values){args=values;return this;},async first(){return sql.prepare(query).get(...args)||null;},async run(){const r=sql.prepare(query).run(...args);return {meta:{changes:Number(r.changes)}};}};}}};
}
function device(env,initial={},connected=true){
 const store=new Map(Object.entries({'protein-foods':JSON.stringify([food]),'protein-records':'{}','protein-target':'95','fasting-records':'{}','fasting-mode':'0',...initial}));
 if(connected)store.set('health_sync_config_v1',JSON.stringify({key}));
 const elements=new Map(),events={},timers=[],requests=[];
 const ctx=vm.createContext({console,URL,JSON,Math,Date,crypto:webcrypto,AbortSignal,
 navigator:{onLine:true,clipboard:{writeText:async()=>{}}},localStorage:{getItem:k=>store.get(k)??null,setItem:(k,v)=>store.set(k,String(v)),removeItem:k=>store.delete(k)},
 setTimeout:fn=>{timers.push(fn);return timers.length;},clearTimeout(){},setInterval(){},
 document:{hidden:false,querySelector:()=>null,addEventListener:(k,fn)=>events[k]=fn,getElementById(id){if(!elements.has(id))elements.set(id,{value:'',classList:{add(){},remove(){}},setAttribute(){}});return elements.get(id);}},
 addEventListener:(k,fn)=>events[k]=fn,confirm:()=>true,showToast(){},renderCurrent(){},
 fetch:async(url,options)=>{requests.push(options.method||'GET');return worker.fetch(new Request(url,options),env);}});
 ctx.window=ctx;
 vm.runInContext(`const FOODS_KEY='protein-foods',RECORDS_KEY='protein-records',TARGET_KEY='protein-target';const FAST_MODES=[{},{},{}];const DEFAULT_TARGET=95,DEFAULT_FOODS=[{"id": "f1", "name": "鸡蛋", "unit": "个", "proteinPer": 7, "perAmount": 1}];function loadJSON(k,f){return JSON.parse(localStorage.getItem(k)||JSON.stringify(f));}let foods=loadJSON(FOODS_KEY,[]),records=loadJSON(RECORDS_KEY,{}),fastRecords=loadJSON('fasting-records',{}),target=Number(localStorage.getItem(TARGET_KEY)),fastModeIndex=0;`,ctx);
 // Don't start a request until the test has control of the device.
 ctx.navigator.onLine=false;vm.runInContext(core,ctx);vm.runInContext(client,ctx);
 return {ctx,store,elements,requests,events,timers,async sync(){ctx.navigator.onLine=true;await ctx.HealthCloud.sync();},write(k,v){store.set(k,JSON.stringify(v));ctx.HealthCloud.changed();},read:k=>JSON.parse(store.get(k)||'null')};
}
test('without a key local data is available and no network request is made',async()=>{const d=device(backend(),{},false);d.write('protein-records',record(entry('one')));await d.sync();assert.deepEqual(d.requests,[]);assert.equal(d.read('protein-records')['2026-11-09'].entries.length,1);});
test('two offline devices merge additions, edits, deletion tombstones without resurrection',async()=>{
 const env=backend(),a=device(env),b=device(env);a.write('protein-records',record(entry('a')));b.write('protein-records',record(entry('b')));
 await Promise.all([a.sync(),b.sync()]);await a.sync();await b.sync();assert.equal(a.read('protein-records')['2026-11-09'].entries.length,2);assert.deepEqual(a.read('protein-records'),b.read('protein-records'));
 b.ctx.navigator.onLine=false;a.write('protein-records',record(entry('b')));await a.sync();b.write('protein-records',record(entry('a'),{...entry('b'),protein:14,quantity:2}));await b.sync();await a.sync();
 assert.deepEqual(a.read('protein-records')['2026-11-09'].entries,[{...entry('b'),protein:14,quantity:2}]);assert.deepEqual(a.read('protein-records'),b.read('protein-records'));
 const fresh=device(env,{'protein-records':JSON.stringify(record(entry('a')))});await fresh.sync();assert.deepEqual(fresh.read('protein-records'),a.read('protein-records'));
});
test('fasting fields merge independently and deletions propagate',async()=>{const env=backend(),a=device(env),b=device(env);a.write('fasting-records',{'2026-11-09':{start:'08:00'}});b.write('fasting-records',{'2026-11-09':{end:'16:00'}});await a.sync();await b.sync();await a.sync();assert.deepEqual(a.read('fasting-records'),{'2026-11-09':{start:'08:00',end:'16:00'}});b.write('fasting-records',{});await b.sync();await a.sync();assert.deepEqual(a.read('fasting-records'),{});});
test('new devices preserve cloud food ordering and goals; later changes synchronize',async()=>{
 const env=backend();const foods=[{...food,id:'f2',name:'牛奶'},food];const a=device(env,{'protein-foods':JSON.stringify(foods),'protein-target':'120','fasting-mode':'2'});await a.sync();const b=device(env);await b.sync();assert.deepEqual(b.read('protein-foods'),foods);assert.equal(b.read('protein-target'),120);assert.equal(b.read('fasting-mode'),2);
 b.write('protein-target',100);b.write('fasting-mode',1);b.write('protein-foods',foods.slice().reverse());await b.sync();await a.sync();assert.equal(a.read('protein-target'),100);assert.equal(a.read('fasting-mode'),1);assert.deepEqual(a.read('protein-foods'),foods.slice().reverse());
});
test('upload failure preserves changes, edits made during upload remain pending',async()=>{
 const env=backend(),a=device(env);a.write('protein-records',record(entry('a')));const original=a.ctx.fetch;a.ctx.fetch=async()=>{throw new TypeError('offline');};await a.sync();assert.equal(a.read('protein-records')['2026-11-09'].entries.length,1);
 let once=true;a.ctx.fetch=async(...args)=>{const r=await original(...args);if(args[1].method==='PUT'&&once){once=false;a.write('protein-records',record(entry('a'),entry('b')));}return r;};await a.sync();await a.sync();const b=device(env);await b.sync();assert.equal(b.read('protein-records')['2026-11-09'].entries.length,2);
});
test('disconnect and config changes ignore old inflight replies',async()=>{const a=device(backend());a.write('protein-records',record(entry('a')));const original=a.ctx.fetch;a.ctx.fetch=async(...args)=>{const r=await original(...args);a.ctx.HealthCloud.disconnect();return r;};await a.sync();assert.equal(a.store.has('health_sync_config_v1'),false);assert.equal(a.read('protein-records')['2026-11-09'].entries.length,1);});
test('auth, origin, shape validation, and optimistic concurrency guards reject invalid writes',async()=>{
 const env=backend();const request=(options)=>worker.fetch(new Request('https://sync.test/sync',options),env);
 assert.equal((await request({})).status,401);assert.equal((await request({headers:{Origin:'https://bad.example'}})).status,403);
 const headers={Authorization:'Bearer '+key,'Content-Type':'application/json',Origin:'https://zecheng99.github.io'};
 const get=await request({headers});assert.equal(get.headers.get('Access-Control-Allow-Origin'),'https://zecheng99.github.io');assert.equal(get.headers.get('Cache-Control'),'no-store');
 assert.equal((await request({method:'PUT',headers,body:JSON.stringify({revision:0,entries:{bad:{stamp:'bad',value:1}}})})).status,400);
 const put=()=>request({method:'PUT',headers,body:JSON.stringify({revision:0,entries:{}})});assert.equal((await put()).status,200);assert.equal((await put()).status,409);
});

test('a blank device cannot seed defaults over another device personalized initial settings',async()=>{const env=backend(),blank=device(env);await blank.sync();const custom=[{...food,name:'自定义鸡蛋'}];const phone=device(env,{'protein-foods':JSON.stringify(custom),'protein-target':'130','fasting-mode':'2'});await phone.sync();await blank.sync();assert.deepEqual(blank.read('protein-foods'),custom);assert.equal(blank.read('protein-target'),130);assert.equal(blank.read('fasting-mode'),2);});
