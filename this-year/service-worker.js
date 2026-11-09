const PREFIX='thisyear-';
const CACHE=PREFIX+"88c5c413a8652a";
const ASSETS=["/master/this-year/","/master/this-year/index.html","/master/this-year/manifest.json","/master/this-year/favicon.svg","/master/this-year/icon-192.png","/master/this-year/icon-512.png","/master/this-year/apple-touch-icon.png","/master/this-year/assets/index-yyo1etra.js","/master/this-year/assets/index-G3f-0dJn.css"];
self.addEventListener('install',e=>{e.waitUntil(caches.open(CACHE).then(c=>c.addAll(ASSETS)).then(()=>self.skipWaiting()));});
self.addEventListener('activate',e=>{e.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k.startsWith(PREFIX)&&k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim()));});
self.addEventListener('fetch',e=>{const u=new URL(e.request.url);if(e.request.method!=='GET'||u.origin!==self.location.origin||!ASSETS.includes(u.pathname)||e.request.headers.has('Authorization'))return;e.respondWith(fetch(e.request,{cache:'no-cache'}).then(r=>{if(r.ok){const clone=r.clone();e.waitUntil(caches.open(CACHE).then(c=>c.put(e.request,clone)));}return r;}).catch(async()=>await caches.match(e.request)||Response.error()));});
