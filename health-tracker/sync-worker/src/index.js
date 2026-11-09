import '../../sync-core.js';
const {merge}=globalThis.HealthSyncCore;
const ALLOWED=['https://zecheng99.github.io','https://shelvee11.github.io','http://localhost:8000','http://127.0.0.1:8000'];
const MAX_BYTES=4*1024*1024;
const day=/^\d{4}-\d{2}-\d{2}$/;
const time=/^(?:[01]\d|2[0-3]):[0-5]\d$/;
const text=v=>typeof v==='string'&&v.length<=2000;
const number=v=>typeof v==='number'&&Number.isFinite(v);
export function validEntries(entries) {
  if(!entries||typeof entries!=='object'||Array.isArray(entries))return false;
  return Object.entries(entries).every(([key,e])=>{
    const parts=key.split(':');
    if(!['foods','target','fastModeIndex'].includes(key) && !(parts.length===3 && day.test(parts[1]) &&
        (parts[0]==='protein'&&/^[\w-]{1,100}$/.test(parts[2]) || parts[0]==='fast'&&['start','end'].includes(parts[2]))))return false;
    if(!e||typeof e!=='object'||typeof e.stamp!=='string'||!/^\d{16}-(seed|[a-f0-9-]{36})$/.test(e.stamp))return false;
    const v=e.value;if(v===null)return !['foods','target','fastModeIndex'].includes(key);
    if(key==='target')return number(v)&&v>0;
    if(key==='fastModeIndex')return Number.isInteger(v)&&v>=0&&v<3;
    if(key==='foods')return Array.isArray(v)&&v.length<=1000&&new Set(v.map(f=>f?.id)).size===v.length&&v.every(f=>f&&typeof f.id==='string'&&/^[\w-]{1,100}$/.test(f.id)&&text(f.name)&&text(f.unit)&&number(f.proteinPer)&&f.proteinPer>=0&&number(f.perAmount)&&f.perAmount>0);
    if(parts[0]==='fast')return typeof v==='string'&&time.test(v);
    return v&&String(v.id)===parts[2]&&text(v.foodName)&&number(v.quantity)&&v.quantity>0&&number(v.protein)&&v.protein>=0&&(!v.timestamp||time.test(v.timestamp));
  });
}
export default {async fetch(request,env){
  const origin=request.headers.get('Origin');
  const headers={'Content-Type':'application/json','Cache-Control':'no-store','Vary':'Origin'};
  const reply=(data,status=200)=>Response.json(data,{status,headers});
  if(origin&&!ALLOWED.includes(origin))return reply({error:'Origin not allowed'},403);
  if(origin)headers['Access-Control-Allow-Origin']=origin;
  headers['Access-Control-Allow-Methods']='GET,PUT,OPTIONS';headers['Access-Control-Allow-Headers']='Authorization,Content-Type';
  if(new URL(request.url).pathname!=='/sync')return reply({error:'Not found'},404);
  if(request.method==='OPTIONS')return new Response(null,{status:204,headers});
  if(!env.SYNC_KEY||env.SYNC_KEY.length<24)return reply({error:'Service not configured'},503);
  const digest=s=>crypto.subtle.digest('SHA-256',new TextEncoder().encode(s));
  const [a,b]=(await Promise.all([digest('Bearer '+env.SYNC_KEY),digest(request.headers.get('Authorization')||'')])).map(x=>new Uint8Array(x));
  let diff=0;for(let i=0;i<a.length;i++)diff|=a[i]^b[i];if(diff)return reply({error:'Unauthorized'},401);
  try{
    if(request.method==='GET'){
      const stored=await env.DB.prepare('SELECT revision, entries FROM sync_state WHERE id=1').first();
      return reply(stored?{revision:stored.revision,entries:JSON.parse(stored.entries)}:{revision:0,entries:{}});
    }
    if(request.method!=='PUT')return reply({error:'Method not allowed'},405);
    let size=0;const chunks=[];
    for await(const chunk of request.body||[]){size+=chunk.byteLength;if(size>MAX_BYTES)return reply({error:'Too large'},413);chunks.push(chunk);}
    let body;try{body=JSON.parse(await new Blob(chunks).text());}catch{return reply({error:'Invalid JSON'},400);}
    if(!body||!Number.isSafeInteger(body.revision)||body.revision<0||!validEntries(body.entries))return reply({error:'Invalid data'},400);
    const stored=await env.DB.prepare('SELECT revision, entries FROM sync_state WHERE id=1').first();
    if((stored?.revision||0)!==body.revision)return reply({error:'Revision conflict'},409);
    // Preserve deletion tombstones and entries omitted by an older client.
    const combined=merge(stored?JSON.parse(stored.entries):{},body.entries);
    const sql=body.revision===0
      ?env.DB.prepare('INSERT OR IGNORE INTO sync_state(id,revision,entries) VALUES(1,1,?)').bind(JSON.stringify(combined))
      :env.DB.prepare('UPDATE sync_state SET revision=revision+1,entries=? WHERE id=1 AND revision=?').bind(JSON.stringify(combined),body.revision);
    if(!(await sql.run()).meta.changes)return reply({error:'Revision conflict'},409);
    return reply({revision:body.revision+1,entries:combined});
  }catch{return reply({error:'Storage unavailable'},503);}
}};
