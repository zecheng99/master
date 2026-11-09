/* Private image transport; original images remain in IndexedDB for offline use. */
(function(root){
 const CACHE='aside-sync-images-v1',MAX=5*1024*1024;
 let options,signature='',acknowledged={},connection='',active=0;const waiting=[],pending=new Map(),missing=new Set();
 const same=cfg=>{const now=options.getConfig();return cfg.url===now.url&&cfg.token===now.token;};
 async function limited(fn){if(active>=3)await new Promise(resolve=>waiting.push(resolve));active++;try{return await fn();}finally{active--;waiting.shift()?.();}}
 async function prepare(cfg){
  const value=cfg.url+'|'+cfg.token;if(connection===value)return;
  const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value));
  const next=Array.from(new Uint8Array(digest)).map(n=>n.toString(16).padStart(2,'0')).join('');
  if(!same(cfg))throw new Error('同步配置已更改');
  connection=value;signature=next;missing.clear();try{const saved=JSON.parse(localStorage.getItem(CACHE)||'null');acknowledged=saved?.connection===signature&&saved.items&&typeof saved.items==='object'?saved.items:{};}catch{acknowledged={};}
 }
 function remember(id,value){acknowledged[id]=value;try{localStorage.setItem(CACHE,JSON.stringify({connection:signature,items:acknowledged}));}catch{}}
 function blob(data){
  const match=/^data:(image\/(?:jpeg|png|webp));base64,([\s\S]+)$/.exec(data||'');
  if(!match)throw new Error('仅支持 JPEG、PNG 和 WebP 图片');
  if(match[2].length>MAX*4/3+8)throw new Error('图片超过 5 MB，请压缩后重试');
  const decoded=atob(match[2]),bytes=new Uint8Array(decoded.length);for(let i=0;i<decoded.length;i++)bytes[i]=decoded.charCodeAt(i);
  if(bytes.length>MAX)throw new Error('图片超过 5 MB，请压缩后重试');return new Blob([bytes],{type:match[1]});
 }
 async function dataURL(value){const bytes=new Uint8Array(await value.arrayBuffer());let text='';for(let i=0;i<bytes.length;i+=16384)text+=String.fromCharCode(...bytes.subarray(i,i+16384));return 'data:'+value.type+';base64,'+btoa(text);}
 async function request(cfg,id,method='GET',body){
  if(!same(cfg))throw new Error('同步配置已更改');
  const response=await fetch(cfg.url+'/images/'+encodeURIComponent(id),{method,body,cache:'no-store',signal:AbortSignal.timeout(20000),headers:{Authorization:'Bearer '+cfg.token,...(body?{'Content-Type':body.type}:{})}});
  if(!same(cfg))throw new Error('同步配置已更改');
  if(response.status===404&&method==='GET')return null;
  if(response.status===401){const error=new Error('图片同步密钥不正确');error.fatal=true;throw error;}
  if(!response.ok)throw new Error(response.status===409?'图片编号冲突，云端原图已保留':'图片同步失败（'+response.status+'）');return response;
 }
 async function get(id){
  const cached=await options.readImage(id);if(cached?.data){missing.delete(id);return cached.data;}
  const cfg=options.getConfig();if(!cfg.token||!navigator.onLine)return null;
  await prepare(cfg);const requestKey=signature+'/'+id;
  if(pending.has(requestKey))return pending.get(requestKey);
  const task=limited(async()=>{
   const response=await request(cfg,id);if(!response){missing.add(id);options.onMissing?.();return null;}
   const value=await response.blob();if(value.size>MAX)throw new Error('图片超过 5 MB');
   const data=await dataURL(value);if(!same(cfg))return null;
   await options.putImage({id,data,ts:Date.now()});missing.delete(id);options.onMissing?.();remember(id,options.hash(data));return data;
  }).finally(()=>pending.delete(requestKey));pending.set(requestKey,task);return task;
 }
 async function upload(cfg){
  await prepare(cfg);const ids=[...new Set(options.getEntries().flatMap(e=>e.imgs||[]))];let done=0,total=0;
  for(const id of ids){const local=await options.readImage(id);if(local?.data&&acknowledged[id]!==options.hash(local.data))total++;}
  if(!total)return 0;options.status('正在同步图片 · 0 / '+total);
  let cursor=0;
  const outcomes=await Promise.allSettled(Array.from({length:Math.min(3,ids.length)},async()=>{
   while(cursor<ids.length){const id=ids[cursor++],local=await options.readImage(id);if(!local?.data)continue;
    const hash=options.hash(local.data);if(acknowledged[id]===hash)continue;
    await request(cfg,id,'PUT',blob(local.data));if(!same(cfg))throw new Error('同步配置已更改');remember(id,hash);options.status('正在同步图片 · '+(++done)+' / '+total);
   }
  }));const failure=outcomes.find(result=>result.status==='rejected');if(failure)throw failure.reason;return done;
 }
 async function ensureAll(){
  const ids=[...new Set(options.getEntries().flatMap(e=>e.imgs||[]))];
  await Promise.all(ids.map(async id=>{if(!await get(id))throw new Error('有图片尚未上传，请先在保存原图的设备联网同步后再导出');}));
 }
 root.AsideImages={configure(value){options=value;},get,upload,ensureAll,missingCount:()=>[...missing].filter(id=>options.getEntries().some(e=>(e.imgs||[]).includes(id))).length,toBlob:blob,toDataURL:dataURL};
})(globalThis);
