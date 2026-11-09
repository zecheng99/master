import {api,loadPhoto,type State} from './cloud';
import {CATEGORIES, MAX_PINNED, canPin, getCategory, homeSections, type Wish, type Entry} from './year';
function download(file:File){const url=URL.createObjectURL(file);const a=document.createElement('a');a.href=url;a.download=file.name;a.click();setTimeout(()=>URL.revokeObjectURL(url),30000);}
async function share(file:File){if(navigator.canShare?.({files:[file]})){try{await navigator.share({files:[file],title:'这一年备份'});return;}catch(e){if(e instanceof DOMException&&e.name==='AbortError')return;}}download(file);}
export async function exportBackup(state:State){
 const photos:{id:string;entry_id:string;mime:string;data:string}[]=[];let bytes=0;
 for(const entry of state.entries)for(const p of entry.photos){const blob=await loadPhoto(p.id);bytes+=blob.size;if(bytes>60*1024*1024)throw new Error('照片总量超过当前单文件备份上限（60 MB），请联系维护者分批备份');const data=await new Promise<string>((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(String(r.result).split(',')[1]);r.onerror=()=>reject(new Error('读取照片失败'));r.readAsDataURL(blob);});photos.push({id:p.id,entry_id:entry.id,mime:blob.type,data});}
 const file=new File([JSON.stringify({app:'this-year',version:1,exportedAt:new Date().toISOString(),wishes:state.wishes,entries:state.entries,photos})],`这一年-备份-${new Date().toISOString().slice(0,10)}.json`,{type:'application/json'});await share(file);
}
const validId=(id:unknown)=>typeof id==='string'&&/^[\w-]{1,100}$/.test(id);
const validDate=(day:unknown)=>typeof day==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(day)&&Number.isFinite(Date.parse(day))&&new Date(day+'T00:00:00Z').toISOString().slice(0,10)===day;
export async function importBackup(file:File){
 if(file.size>100*1024*1024)throw new Error('备份文件超过 100 MB');
 const b=JSON.parse(await file.text());
 if(b.app!=='this-year'||b.version!==1||!Array.isArray(b.wishes)||!Array.isArray(b.entries)||!Array.isArray(b.photos)||b.wishes.length>5000||b.entries.length>10000)throw new Error('不是有效的「这一年」备份文件');
 const wishIds=new Set<string>(),entryIds=new Set<string>(),photoIds=new Set<string>();
 for(const w of b.wishes){if(!validId(w.id)||wishIds.has(w.id)||typeof w.title!=='string'||!w.title.trim()||w.title.length>200||(w.target!==null&&(!Number.isInteger(w.target)||w.target<1||w.target>100000))||!Number.isInteger(w.progress)||w.progress<0||w.progress>100000||![0,1].includes(w.completed)||(w.completed&&!validDate(w.completed_on)))throw new Error('备份中的心愿格式有误');if((w.pinned!==undefined&&![0,1].includes(w.pinned))||(w.category!=null&&!CATEGORIES.includes(w.category)))throw new Error('备份中的置顶或分类格式有误');wishIds.add(w.id);}
 for(const e of b.entries){if(!validId(e.id)||entryIds.has(e.id)||!wishIds.has(e.wish_id)||!validDate(e.day)||typeof e.body!=='string'||e.body.length>10000||!Array.isArray(e.photos))throw new Error('备份中的心得格式有误');entryIds.add(e.id);}
 const counts=new Map<string,number>();
 for(const p of b.photos){if(!validId(p.id)||photoIds.has(p.id)||!entryIds.has(p.entry_id)||!['image/jpeg','image/png','image/webp'].includes(p.mime)||typeof p.data!=='string'||p.data.length>7*1024*1024||!/^[A-Za-z0-9+/]*={0,2}$/.test(p.data))throw new Error('备份中的照片格式有误');const bytes=Uint8Array.from(atob(p.data),c=>c.charCodeAt(0));if(!bytes.length||bytes.length>5*1024*1024)throw new Error('备份中的照片超出大小限制');p.bytes=bytes;photoIds.add(p.id);counts.set(p.entry_id,(counts.get(p.entry_id)||0)+1);if(counts.get(p.entry_id)!>9)throw new Error('每条心得最多 9 张照片');}
 for(const e of b.entries)if(e.photos.some((p:{id:string})=>!photoIds.has(p.id)||!b.photos.some((a:{id:string;entry_id:string})=>a.id===p.id&&a.entry_id===e.id)))throw new Error('备份缺少照片文件');
 if(!confirm(`将合并 ${b.wishes.length} 条心愿、${b.entries.length} 条心得和 ${b.photos.length} 张照片。已有相同编号的记录保持不变。继续吗？`))return;
 const state=await api<State>('state');const knownWishes=new Set(state.wishes.map(w=>w.id)),knownEntries=new Set(state.entries.map(e=>e.id)),knownPhotos=new Set(state.entries.flatMap(e=>e.photos.map(p=>p.id)));
 const newPins=(b.wishes as Wish[]).filter(w=>!knownWishes.has(w.id)&&!!w.pinned&&canPin(w));
 if(homeSections(state.wishes).pinned.length+newPins.length>MAX_PINNED)throw new Error('合并后置顶将超过 7 项，请先取消部分置顶后再导入');
 for(const w of b.wishes as Wish[]){if(knownWishes.has(w.id))continue;await api('wishes','POST',{id:w.id,title:w.title,target:w.target,category:getCategory(w)});await api('wishes/'+w.id,'PATCH',{title:w.title,target:w.target,category:getCategory(w),progress:w.progress,completed:!!w.completed,...(w.completed?{completed_on:w.completed_on}:{})});if(w.pinned&&canPin(w))await api('wishes/'+w.id+'/pin','PATCH',{pinned:true});}
 for(const e of b.entries as Entry[]){if(!knownEntries.has(e.id))await api('entries/'+e.id,'PUT',{wish_id:e.wish_id,day:e.day,body:e.body});}
 for(const p of b.photos){if(knownPhotos.has(p.id))continue;const f=new FormData();f.append('id',p.id);f.append('file',new File([p.bytes],p.id,{type:p.mime}));await api('entries/'+p.entry_id+'/photos','POST',f);}
}
