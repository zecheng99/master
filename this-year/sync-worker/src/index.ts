import { seedTitles, todayInSingapore, CATEGORIES, MAX_PINNED, inferCategory } from '../../src/year';
class HttpError extends Error { constructor(public status: number, message: string) { super(message); } }
const fail = (status: number, message: string): never => { throw new HttpError(status, message); };
const uid = (v: unknown) => typeof v === 'string' && /^[\w-]{1,100}$/.test(v) ? v : fail(400, '无效的记录编号');
const str = (v: unknown, max: number, empty = false) => typeof v === 'string' && v.length <= max && (empty || v.trim()) ? v.trim() : fail(400, '请填写有效内容');
const date = (v: unknown) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && new Date(v + 'T00:00:00Z').toISOString().slice(0, 10) === v ? v : fail(400, '日期格式有误');
const integer = (v: unknown, min: number, max: number) => typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max ? v : fail(400, '次数超出范围');
const category = (v: unknown) => typeof v === 'string' && CATEGORIES.includes(v as typeof CATEGORIES[number]) ? v : fail(400, '请选择有效的分类');
const json = (v: unknown, status = 200) => Response.json(v, { status, headers: { 'Cache-Control': 'no-store' } });
async function handle(req: Request, env: Env) {
 try {
  
  const db = env.DB; const bucket = env.BUCKET; if (!db || !bucket) fail(503, '云端存储暂时不可用，请稍后重试');
  const owner = 'personal';
  const path = new URL(req.url).pathname.split('/').filter(Boolean).slice(1);
  const [kind, rawId, action] = path;
  const q = (sql: string, ...args: (string | number | null)[]) => db!.prepare(sql).bind(...args);
  const wish = async (id: string) => { const w = await q('SELECT * FROM wishes WHERE id=? AND owner=?', id, owner).first<Record<string, unknown>>(); return w ?? fail(404, '找不到这个心愿'); };
  const entry = async (id: string) => { const e = await q('SELECT * FROM entries WHERE id=? AND owner=?', id, owner).first<Record<string, unknown>>(); return e ?? fail(404, '找不到这条心得'); };
  const erasePhotos = async (sql: string, id: string) => {
   const { results } = await q(sql, id, owner).all<{object_key: string}>();
   if (results.length) await bucket!.delete(results.map(p => p.object_key));
  };
  if (kind === 'state' && req.method === 'GET') {
   await db!.batch([
    q('INSERT OR IGNORE INTO owners(id) VALUES(?)', owner),
    ...seedTitles.map((title, i) => q('INSERT INTO wishes(id,owner,title,target,category,position) SELECT ?,?,?,?,?,? WHERE EXISTS (SELECT 1 FROM owners WHERE id=? AND initialized=0)', crypto.randomUUID(), owner, title, i === 6 ? 15 : i === 7 ? 30 : null, inferCategory(title), i, owner)),
    q('UPDATE owners SET initialized=1 WHERE id=?', owner)
   ]);
   const [w,e,p] = await db!.batch<Record<string,unknown>>([q('SELECT * FROM wishes WHERE owner=? ORDER BY position,id',owner),q('SELECT * FROM entries WHERE owner=? ORDER BY day DESC,id DESC',owner),q('SELECT id,entry_id FROM photos WHERE owner=?',owner)]);
   return json({wishes:w.results,entries:e.results.map((r: Record<string,unknown>) => ({...r,photos:p.results.filter((a: Record<string,unknown>)=>a.entry_id===r.id)}))});
  }
  if (kind === 'wishes' && !rawId && req.method === 'POST') {
   const b = await req.json() as Record<string,unknown>; const id = uid(b.id);
   const existing = await q('SELECT owner FROM wishes WHERE id=?',id).first<{owner:string}>(); if(existing) { if(existing.owner!==owner) fail(409,'心愿编号已存在'); return json({id}); }
   const title = str(b.title,200);
   await q('INSERT INTO wishes(id,owner,title,target,category,position) VALUES(?,?,?,?,?,(SELECT COALESCE(MAX(position),-1)+1 FROM wishes WHERE owner=?))', id, owner, title, b.target == null ? null : integer(b.target,1,100000), 'category' in b ? category(b.category) : inferCategory(title), owner).run(); return json({id},201);
  }
  if (kind === 'wishes' && rawId) {
   const id = uid(rawId); const w = await wish(id);
   if (req.method === 'PATCH' && action === 'pin') {
    const b = await req.json() as {pinned: unknown};
    if(typeof b.pinned !== 'boolean') fail(400,'置顶状态格式有误');
    if(!b.pinned) { await q('UPDATE wishes SET pinned=0 WHERE id=? AND owner=?',id,owner).run(); return json({ok:true}); }
    if(Number(w.completed)) fail(409,'已完成的心愿不需要置顶');
    if(w.target && Number(w.progress)>0) fail(409,'已开始的次数型心愿会自动出现在首页“进行中”');
    // The count guard and write are one statement, so concurrent devices cannot exceed seven.
    const r = await q('UPDATE wishes SET pinned=1 WHERE id=? AND owner=? AND completed=0 AND (target IS NULL OR progress=0) AND (pinned=1 OR (SELECT COUNT(*) FROM wishes WHERE owner=? AND pinned=1)<?)',id,owner,owner,MAX_PINNED).run();
    if(!r.meta.changes) fail(409,'最多置顶 7 个心愿，请先取消一个，或刷新查看最新状态');
    return json({ok:true});
   }
   if (req.method === 'PATCH' && action === 'move') {
    const b = await req.json() as {direction: string}; if (!['up','down'].includes(b.direction)) fail(400,'无效的排序方向');
    const all = (await q('SELECT id FROM wishes WHERE owner=? ORDER BY position,id',owner).all<{id:string}>()).results;
    const i = all.findIndex(a=>a.id===id); const to = i+(b.direction==='up'?-1:1);
    if (to >= 0 && to < all.length) { [all[i],all[to]]=[all[to],all[i]]; await db!.batch(all.map((a,n)=>q('UPDATE wishes SET position=? WHERE id=? AND owner=?',n,a.id,owner))); }
    return json({ok:true});
   }
   if (req.method === 'PATCH' && !action) {
    const b = await req.json() as Record<string,unknown>;
    const title = 'title' in b ? str(b.title,200) : String(w.title);
    const nextCategory = 'category' in b ? category(b.category) : w.category as string|null ?? inferCategory(title);
    const target = 'target' in b ? b.target == null ? null : integer(b.target,1,100000) : w.target as number|null;
    let progress = 'progress' in b ? integer(b.progress,0,100000) : Number(w.progress);
    if (target) progress = Math.min(target,progress);
    let completed = target ? Number(progress>=target) : Number(w.completed);
    if ('completed' in b) { if (typeof b.completed !== 'boolean') fail(400,'完成状态有误'); completed = Number(b.completed); if(target) progress=completed?target:Math.min(progress,target-1); }
    const completedOn = completed ? ('completed_on' in b ? date(b.completed_on) : w.completed_on as string|null ?? todayInSingapore()) : null;
    const r = await q('UPDATE wishes SET title=?,target=?,progress=?,completed=?,completed_on=?,category=?,pinned=CASE WHEN ?=1 OR (? IS NOT NULL AND ?>0) THEN 0 ELSE pinned END WHERE id=? AND owner=?', title,target,progress,completed,completedOn,nextCategory,completed,target,progress,id,owner).run();
    if(!r.meta.changes) fail(404,'找不到这个心愿');
    return json({ok:true});
   }
   if(req.method==='DELETE' && !action) {
    await erasePhotos('SELECT p.object_key FROM photos p JOIN entries e ON e.id=p.entry_id WHERE e.wish_id=? AND p.owner=?',id);
    await db!.batch([q('DELETE FROM photos WHERE entry_id IN (SELECT id FROM entries WHERE wish_id=?) AND owner=?',id,owner),q('DELETE FROM entries WHERE wish_id=? AND owner=?',id,owner),q('DELETE FROM wishes WHERE id=? AND owner=?',id,owner)]); return json({ok:true});
   }
  }
  if(kind==='entries' && rawId) {
   const id=uid(rawId);
   if(req.method==='PUT' && !action) {
    const b=await req.json() as Record<string,unknown>; const wishId=uid(b.wish_id); await wish(wishId);
    const existing=await q('SELECT owner,wish_id FROM entries WHERE id=?',id).first<{owner:string;wish_id:string}>();
    if(existing && (existing.owner!==owner || existing.wish_id!==wishId)) fail(404,'找不到这条心得');
    await q('INSERT INTO entries(id,wish_id,owner,day,body) VALUES(?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET day=excluded.day,body=excluded.body WHERE entries.owner=excluded.owner AND entries.wish_id=excluded.wish_id',id,wishId,owner,date(b.day),str(b.body,10000,true)).run(); return json({ok:true});
   }
   await entry(id);
   if(req.method==='DELETE' && !action) {
    await erasePhotos('SELECT object_key FROM photos WHERE entry_id=? AND owner=?',id);
    await db!.batch([q('DELETE FROM photos WHERE entry_id=? AND owner=?',id,owner),q('DELETE FROM entries WHERE id=? AND owner=?',id,owner)]); return json({ok:true});
   }
   if(req.method==='POST' && action==='photos') {
    const size=Number(req.headers.get('content-length')); if(size>6*1024*1024) fail(413,'每张照片需小于 5 MB');
    const form=await req.formData(); const file=form.get('file'); const photoId=uid(form.get('id'));
    if(!(file instanceof File) || !['image/jpeg','image/png','image/webp'].includes(file.type) || !file.size || file.size>5*1024*1024) fail(400,'请选择 5 MB 以内的 JPEG、PNG 或 WebP 照片');
    const exists=await q('SELECT id FROM photos WHERE id=? AND entry_id=? AND owner=?',photoId,id,owner).first(); if(exists) return json({id:photoId});
    if(await q('SELECT id FROM photos WHERE id=?',photoId).first()) fail(409,'照片编号已存在');
    const bytes=await (file as File).arrayBuffer(); const b=new Uint8Array(bytes);
    const valid = (file as File).type==='image/jpeg' ? b[0]===255&&b[1]===216&&b[2]===255 : (file as File).type==='image/png' ? [137,80,78,71,13,10,26,10].every((n,i)=>b[i]===n) : String.fromCharCode(...b.slice(0,4))==='RIFF'&&String.fromCharCode(...b.slice(8,12))==='WEBP';
    if(!valid) fail(400,'照片格式与内容不符');
    const key=`${owner}/${id}/${photoId}`; await bucket!.put(key,bytes,{httpMetadata:{contentType:(file as File).type}});
    try { const result=await q('INSERT INTO photos(id,entry_id,owner,object_key,mime) SELECT ?,?,?,?,? WHERE (SELECT COUNT(*) FROM photos WHERE entry_id=?)<9',photoId,id,owner,key,(file as File).type,id).run(); if(!result.meta.changes) fail(400,'每条心得最多保存 9 张照片'); }
    catch(e) { await bucket!.delete(key); throw e; }
    return json({id:photoId},201);
   }
  }
  if(kind==='photos' && rawId) {
   const id=uid(rawId); const p=await q('SELECT * FROM photos WHERE id=? AND owner=?',id,owner).first<{object_key:string;mime:string}>(); if(!p) fail(404,'照片不存在');
   if(req.method==='GET') { const object=await bucket!.get(p!.object_key); if(!object) fail(404,'照片不存在'); return new Response(object!.body,{headers:{'Content-Type':p!.mime,'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'}}); }
   if(req.method==='DELETE') { await bucket!.delete(p!.object_key); await q('DELETE FROM photos WHERE id=? AND owner=?',id,owner).run(); return json({ok:true}); }
  }
  return json({error:'没有这个操作'},404);
 } catch(e) { if(e instanceof HttpError) return json({error:e.message},e.status); if(e instanceof SyntaxError || e instanceof RangeError) return json({error:'输入内容格式有误'},400); console.error('API request failed',e); return json({error:'保存暂时失败，请检查网络后重试'},500); }
}
export default { async fetch(req: Request, env: Env) {
 const origin=req.headers.get('Origin');
 const allowed=(env.ALLOWED_ORIGINS || 'https://zecheng99.github.io,https://shelvee11.github.io,http://localhost:8000,http://127.0.0.1:8000').split(',').map(s=>s.trim());
 const headers: Record<string,string>={'Cache-Control':'no-store','Vary':'Origin'};
 if(origin && !allowed.includes(origin)) return new Response('请求来源无效',{status:403,headers});
 if(origin) headers['Access-Control-Allow-Origin']=origin;
 headers['Access-Control-Allow-Methods']='GET,POST,PUT,PATCH,DELETE,OPTIONS';
 headers['Access-Control-Allow-Headers']='Authorization,Content-Type';
 if(req.method==='OPTIONS')return new Response(null,{status:204,headers});
 if(!env.SYNC_KEY || env.SYNC_KEY.length<24)return Response.json({error:'同步服务尚未配置'},{status:503,headers});
 const hash=(s:string)=>crypto.subtle.digest('SHA-256',new TextEncoder().encode(s));
 const [a,b]=(await Promise.all([hash('Bearer '+env.SYNC_KEY),hash(req.headers.get('Authorization')||'')])).map(v=>new Uint8Array(v));
 let diff=0;for(let i=0;i<a.length;i++)diff|=a[i]^b[i];
 if(diff)return Response.json({error:'同步密钥不正确，请在设置中检查'},{status:401,headers});
 const r=await handle(req,env);const h=new Headers(r.headers);for(const [k,v] of Object.entries(headers))h.set(k,v);return new Response(r.body,{status:r.status,headers:h});
} };
interface Env { DB: D1Database; BUCKET: R2Bucket; SYNC_KEY: string; ALLOWED_ORIGINS?: string; }
