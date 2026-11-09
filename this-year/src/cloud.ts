import type { Wish, Entry } from './year';
export type State = {wishes:Wish[];entries:Entry[]};
export type Config = {url:string;key:string};
export const DEFAULT_URL='https://this-year-sync.zechengyu90.workers.dev';
const CONFIG='thisyear_connection_v1', SNAPSHOT='thisyear_snapshot_v1';
export function getConfig():Config{try{return JSON.parse(localStorage.getItem(CONFIG)||'null')||{url:DEFAULT_URL,key:''};}catch{return {url:DEFAULT_URL,key:''};}}
export function setConfig(c:Config){localStorage.setItem(CONFIG,JSON.stringify(c));}
export function checkConfig(c:Config):Config {const u=new URL(c.url.trim());if(u.username||u.password||u.search||u.hash||u.pathname!=='/'||(u.protocol!=='https:'&&!(['127.0.0.1','localhost'].includes(u.hostname)&&u.protocol==='http:')))throw new Error('请填写有效的 HTTPS 同步服务地址');if(c.key.trim().length<24)throw new Error('同步密钥至少需要 24 个字符');return {url:u.origin,key:c.key.trim()};}
export class CloudError extends Error{constructor(message:string,public status=0){super(message);}}
export async function requestRaw(path:string,method='GET',body?:unknown,config=getConfig()){
 if(!config.key)throw new CloudError('请先在“云同步与备份”中连接你的手账',401);
 const controller=new AbortController();const timeout=setTimeout(()=>controller.abort(),path==='state'&&method==='GET'?12000:45000);
 try{const response=await fetch(config.url+'/api/'+path,{method,cache:'no-store',signal:controller.signal,headers:{Authorization:'Bearer '+config.key,...(body instanceof FormData?{}:body?{'Content-Type':'application/json'}:{})},body:body instanceof FormData?body:body?JSON.stringify(body):undefined});if(!response.ok){let data:{error?:string}={};try{data=await response.json();}catch{}throw new CloudError(response.status===401?'同步密钥不正确，请到设置检查':data.error||`请求失败（${response.status}），请重试`,response.status);}return response;}
 catch(e){if(e instanceof CloudError)throw e;throw new CloudError('网络连接暂时不可用，内容已保留，请联网后重试');}finally{clearTimeout(timeout);}
}
export async function api<T=Record<string,unknown>>(path:string,method='GET',body?:unknown,config=getConfig()):Promise<T>{return (await requestRaw(path,method,body,config)).json() as Promise<T>;}
async function tag(config=getConfig()){const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(config.url+'|'+config.key));return Array.from(new Uint8Array(bytes)).map(n=>n.toString(16).padStart(2,'0')).join('');}
export async function remember(state:State,config=getConfig()){try{localStorage.setItem(SNAPSHOT,JSON.stringify({tag:await tag(config),state}));}catch{/* Cloud records are already saved even if this device has no cache space. */}}
export async function loadCachedState():Promise<State|null>{try{const saved=JSON.parse(localStorage.getItem(SNAPSHOT)||'null');if(getConfig().key&&saved?.tag===await tag()&&Array.isArray(saved.state?.wishes)&&Array.isArray(saved.state?.entries))return saved.state as State;}catch{}return null;}
export async function loadState(){try{const state=await api<State>('state');return {state,offline:false};}catch(e){if(e instanceof CloudError&&(e.status===401||e.status===403))throw e;const state=await loadCachedState();if(state)return {state,offline:true};throw e;}}
let database:Promise<IDBDatabase>|undefined;
function photoDB(){return database??=new Promise<IDBDatabase>((resolve,reject)=>{const r=indexedDB.open('thisyear_private_photos_v1',1);r.onupgradeneeded=()=>r.result.createObjectStore('photos');r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});}
async function cachedPhoto(key:string):Promise<Blob|undefined>{try{const db=await photoDB();return await new Promise((resolve,reject)=>{const r=db.transaction('photos').objectStore('photos').get(key);r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});}catch{return undefined;}}
async function savePhoto(key:string,blob:Blob){try{const db=await photoDB();await new Promise<void>((resolve,reject)=>{const t=db.transaction('photos','readwrite');t.objectStore('photos').put(blob,key);t.oncomplete=()=>resolve();t.onerror=()=>reject(t.error);});}catch{/* Photo cache is optional and may be evicted by the browser. */}}
export async function loadPhoto(id:string):Promise<Blob>{const key=(await tag())+'/'+id;try{const blob=await(await requestRaw('photos/'+id)).blob();void savePhoto(key,blob);return blob;}catch(e){if(e instanceof CloudError&&(e.status===401||e.status===403||e.status===404))throw e;const cached=await cachedPhoto(key);if(cached)return cached;throw e;}}
