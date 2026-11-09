import {test} from 'node:test';
import assert from 'node:assert/strict';
import {backend,device,entry,post,worker,key,defaults} from './support.mjs';
test('two devices merge text, replies, pins and independent offline additions',async()=>{
 const env=backend(),a=device(env),b=device(env);a.write([{...entry('a'),pin:1}]);b.write([{...entry('b'),re:'a',side:-1,hl:1}]);
 await Promise.all([a.sync(),b.sync()]);await a.sync();await b.sync();assert.deepEqual(a.read(),b.read());assert.equal(a.read().length,2);assert.equal(a.read().find(e=>e.id==='b').hl,1);
 a.write(a.read().filter(e=>e.id!=='a'));await a.sync();await b.sync();assert.deepEqual(b.read().map(e=>e.id),['b']);
 const stale=await(await post(env,{since:Date.now()+100000,entries:[{id:'a',data:JSON.stringify(entry('a'))}]})).json();assert.ok(stale.entries.some(r=>r.id==='a'&&r.deleted));
 const c=device(env);await c.sync();assert.deepEqual(c.read().map(e=>e.id),['b']);
});
test('fresh defaults do not replace customized cloud tags; local custom tags are retained',async()=>{
 const env=backend(),a=device(env);a.writeTags([{...defaults[0],keywords:['精心维护']},defaults[1]]);await a.sync();
 const b=device(env);b.writeTags([...defaults,{id:'book',name:'读书',keywords:['书']}]);await b.sync();await a.sync();assert.deepEqual(a.tags(),b.tags());assert.deepEqual(a.tags()[0].keywords,['精心维护']);assert.ok(a.tags().some(t=>t.id==='book'));
 const blank=device(backend());await blank.sync();
});
test('personalized first-device tags can replace blank-device default seeds',async()=>{const env=backend(),blank=device(env);await blank.sync();const custom=device(env,{'aside-tags':JSON.stringify([{...defaults[0],keywords:['个性化']},defaults[1]])});await custom.sync();await blank.sync();assert.deepEqual(blank.tags()[0].keywords,['个性化']);});
test('failures and edits made during upload retain pending changes',async()=>{
 const env=backend(),a=device(env);a.write([entry('a')]);const original=a.ctx.fetch;a.ctx.fetch=async()=>{throw TypeError('offline');};await a.sync();assert.equal(a.store.has('aside-sync-at'),false);assert.equal(a.read().length,1);
 let once=true;a.ctx.fetch=async(...args)=>{const r=await original(...args);if(once){once=false;a.write([entry('a'),entry('b')]);}return r;};await a.sync();await a.sync();const b=device(env);await b.sync();assert.equal(b.read().length,2);
});
test('monotonic database cursor catches writes in the same millisecond',async()=>{
 const env=backend(),a=device(env),b=device(env);a.write([entry('a')]);await a.sync();await b.sync();b.write([...b.read(),entry('b')]);await b.sync();await a.sync();assert.equal(a.read().length,2);
});
test('unauthenticated requests, disallowed origins and malformed payloads fail safely',async()=>{
 const env=backend();assert.equal((await worker.fetch(new Request('https://sync.test/sync',{method:'POST',body:'{}'}),env)).status,401);
 assert.equal((await worker.fetch(new Request('https://sync.test/sync',{headers:{Origin:'https://bad.example'}}),env)).status,403);
 assert.equal((await post(env,{entries:[],tags:'not JSON'})).status,400);
 const r=await post(env,{entries:[],tags:null});assert.equal(r.headers.get('Cache-Control'),'no-store');
 env.SYNC_KEY_V2='another-key-with-at-least-24-characters';const response=await worker.fetch(new Request('https://sync.test/sync',{method:'POST',headers:{Authorization:'Bearer '+env.SYNC_KEY_V2,'Content-Type':'application/json'},body:'{"entries":[]}'}),env);assert.equal(response.status,200);
});
test('changing configuration ignores replies for the old connection',async()=>{const a=device(backend());a.write([entry('a')]);const original=a.ctx.fetch;a.ctx.fetch=async(...args)=>{const r=await original(...args);a.run('syncGeneration++;');return r;};await a.sync();assert.equal(a.store.has('aside-sync-at'),false);assert.equal(a.read().length,1);});
test('new defaults do not restore a default tag deliberately removed in the cloud',async()=>{const env=backend(),a=device(env,{'aside-tags':JSON.stringify([defaults[1]])});await a.sync();const blank=device(env);await blank.sync();assert.deepEqual(blank.tags().map(t=>t.id),['other']);});
