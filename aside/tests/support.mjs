import {readFileSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {webcrypto} from 'node:crypto';
import vm from 'node:vm';
import worker from '../cloud-worker/worker.js';
export {worker};
export const key='aside-test-only-sync-key-123456789';
export const defaults=[{id:'note',name:'笔记',keywords:[]},{id:'other',name:'其他',keywords:[],fallback:true}];
export const entry=id=>({id,text:'记录 '+id,ts:1794225600000,date:'2026-11-09',time:'20:00',tagId:'note',imgs:[]});
export function backend(){
 const sql=new DatabaseSync(':memory:');sql.exec(readFileSync(new URL('../cloud-worker/schema.sql',import.meta.url),'utf8'));const objects=new Map();
 const object=(id,body=false)=>{const value=objects.get(id);return value?{...value,size:value.bytes.byteLength,...(body?{body:new Blob([value.bytes]).stream()}:{})}:null;};
 return {SYNC_KEY:key,sql,objects,DB:{prepare(query){let args=[];return {bind(...values){args=values;return this;},async first(){return sql.prepare(query).get(...args)||null;},async all(){return {results:sql.prepare(query).all(...args)};},run(){const result=sql.prepare(query).run(...args);return {meta:{changes:Number(result.changes)}};}};},async batch(statements){sql.exec('BEGIN');try{const results=statements.map(s=>s.run());sql.exec('COMMIT');return results;}catch(e){sql.exec('ROLLBACK');throw e;}}},IMAGES:{async head(id){return object(id);},async get(id){return object(id,true);},async put(id,data,options){if(objects.has(id)&&options.onlyIf)return null;objects.set(id,{bytes:new Uint8Array(data),httpMetadata:options.httpMetadata,customMetadata:options.customMetadata});return object(id);}}};
}
const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
const client=html.slice(html.indexOf('const SYNC_URL_KEY'),html.indexOf("document.addEventListener('visibilitychange'",html.indexOf('const SYNC_URL_KEY')));
export function device(env,initial={},connected=true){
 const store=new Map(Object.entries({'aside-entries':'[]','aside-tags':JSON.stringify(defaults),...initial}));
 if(connected)store.set('aside-sync-token',key);
 const timers=[],elements=new Map(),requests=[];
 const ctx=vm.createContext({console,URL,Date,JSON,Math,Set,Map,AbortController,crypto:webcrypto,navigator:{onLine:true},
 localStorage:{getItem:k=>store.get(k)??null,setItem:(k,v)=>store.set(k,String(v)),removeItem:k=>store.delete(k)},setTimeout:fn=>{timers.push(fn);return timers.length;},clearTimeout(){},
 document:{body:{classList:{contains:()=>false}},getElementById(id){if(!elements.has(id))elements.set(id,{classList:{contains:()=>false},textContent:''});return elements.get(id);}},
 showToast(){},renderAll(){},renderSettings(){},hydrateImages(){},imgCache:new Map(),delImage:async()=>{},lbEntry:null,dateKey:()=> '2026-11-09',todayKey:()=> '2026-11-09',cnDate:()=> '',nowTime:()=> '20:00',
 AsideImages:{upload:async()=>0},CloudSyncUI:{validate:x=>x},fetch:async(url,options)=>{requests.push(url);return worker.fetch(new Request(url,{...options,headers:{...options.headers,Origin:'https://zecheng99.github.io'}}),env);}});
 ctx.window=ctx;
 vm.runInContext(`const ENTRIES_KEY='aside-entries',TAGS_KEY='aside-tags',SEED_TAGS=${JSON.stringify(defaults)};function loadJSON(k,f){return JSON.parse(localStorage.getItem(k)||JSON.stringify(f));}let entries=loadJSON(ENTRIES_KEY,[]),tags=loadJSON(TAGS_KEY,SEED_TAGS);function fallbackTag(){return tags.find(t=>t.fallback)||tags[tags.length-1];}function saveEntries(){localStorage.setItem(ENTRIES_KEY,JSON.stringify(entries));scheduleSync();}function saveTags(){localStorage.setItem(TAGS_KEY,JSON.stringify(tags));scheduleSync();}`,ctx);
 vm.runInContext(client,ctx);
 return {ctx,store,timers,requests,run:code=>vm.runInContext(code,ctx),async sync(){await ctx.doSync();},read:()=>JSON.parse(store.get('aside-entries')),tags:()=>JSON.parse(store.get('aside-tags')),write(rows){vm.runInContext('entries='+JSON.stringify(rows)+';saveEntries();',ctx);},writeTags(tags){vm.runInContext('tags='+JSON.stringify(tags)+';saveTags();',ctx);}};
}
export async function post(env,body){return worker.fetch(new Request('https://sync.test/sync',{method:'POST',headers:{Authorization:'Bearer '+key,'Content-Type':'application/json'},body:JSON.stringify(body)}),env);}
