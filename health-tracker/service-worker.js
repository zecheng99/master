const PREFIX='profast-';
const CACHE_NAME=PREFIX+'v11';
const BASE=new URL('./',self.location.href).pathname;
const ASSETS=[BASE,...['index.html','manifest.json','icon-192.png','icon-512.png','sync-core.js','cloud-sync.js'].map(path=>BASE+path),new URL('../shared/cloud-sync-ui.js',self.location.href).pathname];
self.addEventListener('install',e=>{e.waitUntil(caches.open(CACHE_NAME).then(c=>c.addAll(ASSETS)).then(()=>self.skipWaiting()));});
self.addEventListener('activate',e=>{e.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k.startsWith(PREFIX)&&k!==CACHE_NAME).map(k=>caches.delete(k)))).then(()=>self.clients.claim()));});
self.addEventListener('fetch',e=>{
 const url=new URL(e.request.url);
 if(e.request.method!=='GET'||url.origin!==self.location.origin||!ASSETS.includes(url.pathname)||e.request.headers.has('Authorization'))return;
 e.respondWith(fetch(e.request,{cache:'no-cache'}).then(response=>{if(response.ok){const clone=response.clone();e.waitUntil(caches.open(CACHE_NAME).then(cache=>cache.put(e.request,clone)));}return response;}).catch(async()=>await (await caches.open(CACHE_NAME)).match(e.request)||Response.error()));
});
