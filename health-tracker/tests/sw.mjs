import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const base='https://zecheng99.github.io/master/health-tracker/';
function runtime(){
 const events={},deleted=[],stored=[];let fail=false;const cache={addAll:async paths=>{stored.push(...paths);},put:async req=>{stored.push(req.url);}};
 const ctx=vm.createContext({URL,Response,self:{location:{href:base+'sw.js',origin:'https://zecheng99.github.io'},addEventListener:(name,fn)=>events[name]=fn,skipWaiting:async()=>{},clients:{claim:async()=>{}}},caches:{open:async()=>cache,keys:async()=>['profast-v8','profast-v10','thisyear-keep','spendex-keep'],delete:async key=>deleted.push(key),match:async()=>new Response('cached')},fetch:async()=>{if(fail)throw Error('offline');return new Response('new');}});
 vm.runInContext(readFileSync(new URL('../service-worker.js',import.meta.url),'utf8'),ctx);
 return {events,deleted,stored,offline(){fail=true;},async event(name,request){let promise;const pending=[];events[name]({request,waitUntil:p=>pending.push(p),respondWith:p=>promise=p});const response=promise?await promise:null;await Promise.all(pending);return response;}};
}
test('installation covers icons and updates only this app cache',async()=>{const r=runtime();await r.event('install');assert.ok(r.stored.some(path=>path.endsWith('sync-core.js')));assert.ok(r.stored.some(path=>path.endsWith('cloud-sync.js')));await r.event('activate');assert.deepEqual(r.deleted,['profast-v8']);});
test('static pages update online and reopen from cache offline',async()=>{const r=runtime();const request=new Request(base);assert.equal(await(await r.event('fetch',request)).text(),'new');r.offline();assert.equal(await(await r.event('fetch',request)).text(),'cached');});
test('sync writes, auth requests, and other apps bypass static cache',async()=>{const r=runtime();for(const req of [new Request('https://health-tracker-sync.zechengyu90.workers.dev/sync',{method:'POST',body:'{}'}),new Request(base,{headers:{Authorization:'Bearer local-test'}}),new Request('https://zecheng99.github.io/master/this-year/')])assert.equal(await r.event('fetch',req),null);assert.deepEqual(r.stored,[]);});
