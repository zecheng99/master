import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {webcrypto} from 'node:crypto';
import {backend,worker,key,entry} from './support.mjs';
const jpeg=new Uint8Array([255,216,255,224,1,2,3,4,255,217]);
const url='data:image/jpeg;base64,'+Buffer.from(jpeg).toString('base64');
function imageDevice(env,images=[],rows=[{...entry('one'),imgs:['photo']}]){
 const store=new Map(),local=new Map(images.map(v=>[v.id,v]));let cfg={url:'https://sync.test',token:key};const requests=[];
 const ctx=vm.createContext({console,Map,Set,JSON,Date,Promise,Blob,Uint8Array,TextEncoder,crypto:webcrypto,AbortSignal,atob,btoa,navigator:{onLine:true},localStorage:{getItem:k=>store.get(k)??null,setItem:(k,v)=>store.set(k,v)},fetch:async(address,opts)=>{requests.push(opts.method||'GET');return worker.fetch(new Request(address,opts),env);}});
 vm.runInContext(readFileSync(new URL('../cloud-images.js',import.meta.url),'utf8'),ctx);
 ctx.AsideImages.configure({getConfig:()=>cfg,getEntries:()=>rows,readImage:async id=>local.get(id),putImage:async image=>local.set(image.id,image),hash:value=>value,status(){}});
 return {ctx,local,requests,cfg,changeConfig:()=>{cfg={url:'https://other.test',token:key};}};
}
test('images upload privately, a second device downloads and can reopen offline',async()=>{
 const env=backend(),a=imageDevice(env,[{id:'photo',data:url}]);await a.ctx.AsideImages.upload(a.cfg);assert.equal(env.objects.size,1);
 await a.ctx.AsideImages.upload(a.cfg);assert.deepEqual(a.requests,['PUT']);
 const b=imageDevice(env);const received=await b.ctx.AsideImages.get('photo');assert.equal(received,url);assert.equal(b.local.get('photo').data,url);b.ctx.navigator.onLine=false;assert.equal(await b.ctx.AsideImages.get('photo'),url);
 await b.ctx.AsideImages.ensureAll();assert.deepEqual(b.requests,['GET']);
});
test('failed image uploads remain pending and retry without replacing originals',async()=>{
 const env=backend(),a=imageDevice(env,[{id:'photo',data:url}]);const original=a.ctx.fetch;a.ctx.fetch=async()=>{throw new TypeError('offline');};await assert.rejects(a.ctx.AsideImages.upload(a.cfg));assert.equal(a.local.size,1);a.ctx.fetch=original;await a.ctx.AsideImages.upload(a.cfg);
 const other='data:image/jpeg;base64,'+Buffer.from([255,216,255,224,7,8,255,217]).toString('base64');a.local.set('photo',{id:'photo',data:other});await assert.rejects(a.ctx.AsideImages.upload(a.cfg),/编号冲突/);assert.deepEqual(env.objects.get('images/photo').bytes,jpeg);
});
test('missing legacy images prevent an incomplete full backup and can arrive later',async()=>{const env=backend(),a=imageDevice(env);assert.equal(await a.ctx.AsideImages.get('photo'),null);assert.equal(a.ctx.AsideImages.missingCount(),1);await assert.rejects(a.ctx.AsideImages.ensureAll(),/原图/);const origin=imageDevice(env,[{id:'photo',data:url}]);await origin.ctx.AsideImages.upload(origin.cfg);assert.equal(await a.ctx.AsideImages.get('photo'),url);assert.equal(a.ctx.AsideImages.missingCount(),0);});
test('image authorization, size, format checks and cache policy',async()=>{
 const env=backend();assert.equal((await worker.fetch(new Request('https://sync.test/images/photo'),env)).status,401);
 const headers={Authorization:'Bearer '+key};assert.equal((await worker.fetch(new Request('https://sync.test/images/photo',{method:'PUT',headers,body:'<svg></svg>'}),env)).status,415);
 assert.equal((await worker.fetch(new Request('https://sync.test/images/photo',{method:'PUT',headers:{...headers,'Content-Length':String(6*1024*1024)},body:'x'}),env)).status,413);
 await worker.fetch(new Request('https://sync.test/images/photo',{method:'PUT',headers,body:jpeg}),env);const response=await worker.fetch(new Request('https://sync.test/images/photo',{headers}),env);assert.equal(response.headers.get('Cache-Control'),'no-store');assert.equal(response.headers.get('Content-Type'),'image/jpeg');assert.deepEqual(new Uint8Array(await response.arrayBuffer()),jpeg);
});
test('responses from an old image connection cannot enter the local cache',async()=>{const env=backend(),origin=imageDevice(env,[{id:'photo',data:url}]);await origin.ctx.AsideImages.upload(origin.cfg);const b=imageDevice(env);const original=b.ctx.fetch;b.ctx.fetch=async(...args)=>{const res=await original(...args);b.changeConfig();return res;};await assert.rejects(b.ctx.AsideImages.get('photo'),/配置已更改/);assert.equal(b.local.size,0);});
