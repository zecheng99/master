/* Private Aside text/tag sync (existing D1) and authenticated image sync (R2). */
const ORIGINS=['https://zecheng99.github.io','https://shelvee11.github.io','http://localhost:8000','http://127.0.0.1:8000'];
const MAX_BATCH=50,PULL_LIMIT=5000,MAX_BODY=4*1024*1024,MAX_IMAGE=5*1024*1024;
const validId=id=>typeof id==='string'&&/^[\w.-]{1,100}$/.test(id);
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
export function seedTags(current,incoming,defaults){
 if(!Array.isArray(current)||!current.length)return incoming;
 if(Array.isArray(defaults)&&same(current,defaults)&&!same(incoming,defaults))return incoming;
 const merged=current.slice(),ids=new Set(current.map(t=>t.id));
 for(const tag of incoming)if(!ids.has(tag.id)){const initial=Array.isArray(defaults)?defaults.find(t=>t.id===tag.id):null;if(initial&&same(initial,tag))continue;const i=merged.findIndex(t=>t.fallback);merged.splice(i<0?merged.length:i,0,{...tag,fallback:false});ids.add(tag.id);}
 return merged;
}
async function bytes(request,max){
 if(Number(request.headers.get('Content-Length'))>max)throw new Error('size');
 const chunks=[];let size=0;for await(const chunk of request.body||[]){size+=chunk.byteLength;if(size>max)throw new Error('size');chunks.push(chunk);}
 return new Uint8Array(await new Blob(chunks).arrayBuffer());
}
function imageType(data){
 if(data[0]===0xff&&data[1]===0xd8&&data[2]===0xff)return 'image/jpeg';
 if(data[0]===137&&data[1]===80&&data[2]===78&&data[3]===71&&data[4]===13&&data[5]===10&&data[6]===26&&data[7]===10)return 'image/png';
 if(new TextDecoder().decode(data.slice(0,4))==='RIFF'&&new TextDecoder().decode(data.slice(8,12))==='WEBP')return 'image/webp';
 return null;
}
async function authenticated(request,env){
 const keys=[env.SYNC_KEY,env.SYNC_KEY_V2].filter(k=>typeof k==='string'&&k.length>0);
 if(!keys.length)return false;
 const digest=s=>crypto.subtle.digest('SHA-256',new TextEncoder().encode(s));
 const actual=new Uint8Array(await digest(request.headers.get('Authorization')||''));
 const expected=await Promise.all(keys.map(key=>digest('Bearer '+key)));let match=0;
 for(const value of expected){const bytes=new Uint8Array(value);let diff=0;for(let i=0;i<bytes.length;i++)diff|=bytes[i]^actual[i];match|=Number(diff===0);}
 return !!match;
}
export default {async fetch(request,env){
 const origin=request.headers.get('Origin');
 const headers={'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','Vary':'Origin','X-Content-Type-Options':'nosniff'};
 const json=(value,status=200)=>Response.json(value,{status,headers});
 if(origin&&!ORIGINS.includes(origin))return json({error:'Origin not allowed'},403);
 if(origin)headers['Access-Control-Allow-Origin']=origin;
 headers['Access-Control-Allow-Methods']='GET,HEAD,POST,PUT,OPTIONS';headers['Access-Control-Allow-Headers']='Content-Type,Authorization';
 if(request.method==='OPTIONS')return new Response(null,{status:204,headers});
 const path=new URL(request.url).pathname;
 if(path==='/health')return json({ok:true,images:!!env.IMAGES});
 if(!await authenticated(request,env))return json({error:'Unauthorized'},401);
 const image=path.match(/^\/images\/([\w.-]{1,100})$/);
 if(image){
  if(!env.IMAGES)return json({error:'Image storage unavailable'},503);
  const objectKey='images/'+image[1];
  if(['GET','HEAD'].includes(request.method)){
   const object=await(request.method==='HEAD'?env.IMAGES.head(objectKey):env.IMAGES.get(objectKey));
   if(!object)return json({error:'Image not uploaded yet'},404);
   return new Response(request.method==='HEAD'?null:object.body,{headers:{...headers,'Content-Type':object.httpMetadata?.contentType||'application/octet-stream','Content-Length':String(object.size)}});
  }
  if(request.method!=='PUT')return json({error:'Method not allowed'},405);
  let data;try{data=await bytes(request,MAX_IMAGE);}catch{return json({error:'Image must be at most 5 MB'},413);}
  const type=imageType(data);if(!type)return json({error:'Only JPEG, PNG and WebP images are supported'},415);
  const sha256=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',data))).map(n=>n.toString(16).padStart(2,'0')).join('');
  const old=await env.IMAGES.head(objectKey);
  if(old){if(old.customMetadata?.sha256===sha256)return json({ok:true});return json({error:'Image ID conflict; original retained'},409);}
  // Immutable image IDs: retries must never replace a different original.
  const result=await env.IMAGES.put(objectKey,data,{httpMetadata:{contentType:type},customMetadata:{sha256},onlyIf:{etagDoesNotMatch:'*'}});
  if(!result){const stored=await env.IMAGES.head(objectKey);if(stored?.customMetadata?.sha256!==sha256)return json({error:'Image ID conflict; original retained'},409);}
  return json({ok:true});
 }
 if(path!=='/sync')return json({error:'Not found'},404);
 if(request.method!=='POST')return json({error:'Method not allowed'},405);
 let body;try{body=JSON.parse(new TextDecoder().decode(await bytes(request,MAX_BODY)));}catch{return json({error:'Invalid or oversized sync request'},400);}
 if(!body||!Array.isArray(body.entries||[]))return json({error:'Invalid data'},400);
 const since=Math.max(0,Number(body.since)||0),incoming=body.entries||[];let now=0;
 let incomingTags;try{incomingTags=typeof body.tags==='string'?JSON.parse(body.tags):null;}catch{return json({error:'Invalid tags'},400);}
 if(incomingTags&&(!Array.isArray(incomingTags)||!incomingTags.length||!incomingTags.every(t=>t&&validId(t.id)&&typeof t.name==='string')))return json({error:'Invalid tags'},400);
 try{
  const clock=await env.DB.prepare("SELECT updated FROM meta WHERE k='__clock__'").first();
  if(!clock)await env.DB.prepare("INSERT OR IGNORE INTO meta(k,v,updated) SELECT '__clock__','',MAX(?,COALESCE(MAX(updated),0)) FROM (SELECT updated FROM entries UNION ALL SELECT updated FROM meta)").bind(Date.now()).run();
  const statements=[];
  for(const row of incoming){
   if(!row||!validId(row.id))return json({error:'Invalid entry ID'},400);
   if(!row.deleted){let entry;try{entry=JSON.parse(row.data);}catch{return json({error:'Invalid entry'},400);}if(!entry||entry.id!==row.id||(entry.text!==undefined&&typeof entry.text!=='string')||!Array.isArray(entry.imgs||[])||!(entry.imgs||[]).every(validId))return json({error:'Invalid entry'},400);}
   statements.push(env.DB.prepare(`INSERT INTO entries(id,data,updated,deleted) VALUES(?,?,(SELECT updated FROM meta WHERE k='__clock__'),?) ON CONFLICT(id) DO UPDATE SET data=excluded.data,updated=excluded.updated,deleted=excluded.deleted WHERE entries.deleted=0 OR excluded.deleted=1`).bind(row.id,row.deleted?'':row.data,row.deleted?1:0));
  }
  if(incomingTags){
   let value=incomingTags;
   if(body.tagsSeed){const old=await env.DB.prepare("SELECT v FROM meta WHERE k='tags'").first();if(old)value=seedTags(JSON.parse(old.v),incomingTags,body.tagDefaults);}
   statements.push(env.DB.prepare("INSERT INTO meta(k,v,updated) VALUES('tags',?,(SELECT updated FROM meta WHERE k='__clock__')) ON CONFLICT(k) DO UPDATE SET v=excluded.v,updated=excluded.updated").bind(JSON.stringify(value)));
  }
  for(let i=0;i<statements.length;i+=MAX_BATCH-1)await env.DB.batch([env.DB.prepare("UPDATE meta SET updated=MAX(updated+1,?) WHERE k='__clock__'").bind(Date.now()),...statements.slice(i,i+MAX_BATCH-1)]);
  now=(await env.DB.prepare("SELECT updated FROM meta WHERE k='__clock__'").first()).updated;
  const pulled=await env.DB.prepare('SELECT id,data,updated,deleted FROM entries WHERE updated>? AND updated<=? ORDER BY updated,id LIMIT ?').bind(since,now,PULL_LIMIT).all();
  const isTruncated=(pulled.results||[]).length>=PULL_LIMIT;
  if(isTruncated){const last=pulled.results.at(-1);const tail=await env.DB.prepare('SELECT id,data,updated,deleted FROM entries WHERE updated=? AND id>? ORDER BY id').bind(last.updated,last.id).all();pulled.results.push(...(tail.results||[]));now=last.updated;}
  const forced=[],liveIds=[...new Set(incoming.filter(r=>!r.deleted).map(r=>r.id))];
  for(let i=0;i<liveIds.length;i+=MAX_BATCH){const ids=liveIds.slice(i,i+MAX_BATCH);const result=await env.DB.prepare(`SELECT id,data,updated,deleted FROM entries WHERE deleted=1 AND id IN (${ids.map(()=>'?').join(',')})`).bind(...ids).all();forced.push(...(result.results||[]));}
  const pushed=new Map(incoming.map(r=>[r.id,r.data]));
  const rows=[...new Map([...(pulled.results||[]),...forced].map(r=>[r.id,r])).values()].filter(r=>r.deleted||!pushed.has(r.id)||r.data!==pushed.get(r.id));
  const tags=body.tagsSeed?await env.DB.prepare("SELECT v FROM meta WHERE k='tags'").first():await env.DB.prepare("SELECT v FROM meta WHERE k='tags' AND updated>? AND updated<=?").bind(since,now).first();
  return json({now,entries:rows.map(r=>({id:r.id,data:r.data,deleted:r.deleted?1:0})),tags:tags?.v||null,truncated:isTruncated});
 }catch{return json({error:'Storage unavailable'},503);}
}};
