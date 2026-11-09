(function() {
  'use strict';
  const {merge,flatten,materialize}=HealthSyncCore;
  const DEFAULT_URL='https://health-tracker-sync.zechengyu90.workers.dev';
  const STATE='health_sync_entries_v1',CONFIG='health_sync_config_v1';
  let ui=null;
  let timer,running=false,rerun=false,generation=0,retries=0,status='未开启云同步';
  const read=(key,fallback)=>{try{return JSON.parse(localStorage.getItem(key))??fallback;}catch{return fallback;}};
  const entries=()=>read(STATE,{});
  const config=()=>({...read(CONFIG,{}),url:read(CONFIG,{}).url||DEFAULT_URL});
  const current=()=>flatten(loadJSON(RECORDS_KEY,{}),loadJSON('fasting-records',{}),loadJSON(FOODS_KEY,foods),Number(localStorage.getItem(TARGET_KEY))||target,Number(localStorage.getItem('fasting-mode'))||0);
  const persist=all=>localStorage.setItem(STATE,JSON.stringify(all));
  function capture(seed=false) {
    const all=entries(),data=current();
    const previous=Object.values(all).reduce((n,e)=>Math.max(n,Number(e.stamp.split('-')[0])),0);
    const stamp=seed?'0000000000000000-seed':String(Math.max(Date.now(),previous+1)).padStart(16,'0')+'-'+crypto.randomUUID();
    for(const key of new Set([...Object.keys(all),...Object.keys(data)])) {
      const value=data[key]??null;
      const customInitial=(key==='foods'&&JSON.stringify(value)!==JSON.stringify(typeof DEFAULT_FOODS==='undefined'?foods:DEFAULT_FOODS)) || (key==='target'&&value!==(typeof DEFAULT_TARGET==='undefined'?95:DEFAULT_TARGET)) || (key==='fastModeIndex'&&value!==0);
      const initialStamp=customInitial?'0000000000000001-seed':'0000000000000000-seed';
      if(JSON.stringify(all[key]?.value??null)!==JSON.stringify(value)) all[key]={value,stamp:seed?initialStamp:stamp};
      else if(customInitial&&all[key]?.stamp==='0000000000000000-seed') all[key]={value,stamp:initialStamp};
    }
    persist(all);
  }
  function setStatus(text) {
    status=text;ui?.setStatus(text,text.startsWith('同步失败'));
    const el=document.getElementById('health-sync-status');if(el)el.textContent=text;
    const button=document.getElementById('health-sync-button');if(button){button.title=text;button.setAttribute('aria-label','云同步：'+text);}
  }
  function changed() {
    capture();retries=0;
    if(config().key){setStatus(navigator.onLine?'有修改，等待同步':'离线，联网后自动同步');clearTimeout(timer);timer=setTimeout(sync,1200);}
  }
  function apply(all) {
    persist(all);
    const data=materialize(all);
    records=data.records;fastRecords=data.fastRecords;
    if(Array.isArray(data.foods)) foods=data.foods;
    if(data.target>0) target=data.target;
    if(FAST_MODES[data.fastModeIndex]) fastModeIndex=data.fastModeIndex;
    localStorage.setItem(RECORDS_KEY,JSON.stringify(records));localStorage.setItem('fasting-records',JSON.stringify(fastRecords));
    localStorage.setItem(FOODS_KEY,JSON.stringify(foods));localStorage.setItem(TARGET_KEY,String(target));localStorage.setItem('fasting-mode',String(fastModeIndex));
    renderCurrent();
  }
  async function request(cfg,options={}) {
    const response=await fetch(cfg.url+'/sync',{...options,cache:'no-store',signal:AbortSignal.timeout(15000),headers:{Authorization:'Bearer '+cfg.key,'Content-Type':'application/json'}});
    if(response.status===409)return null;
    if(response.status===401){const e=new Error('同步密钥不正确');e.fatal=true;throw e;}
    if(!response.ok)throw new Error('云端暂时不可用（'+response.status+'）');
    return response.json();
  }
  async function sync() {
    const cfg=config(),version=generation;
    if(!cfg.key)return;
    if(running){rerun=true;return;}
    if(!navigator.onLine){setStatus('离线，联网后自动同步');return;}
    // Keep the entry currently being edited on screen until the user finishes.
    if(document.querySelector('.modal-overlay.open:not(#health-sync-modal),.sheet.open,.picker-overlay.open,.action-overlay.open')) {clearTimeout(timer);timer=setTimeout(sync,2000);return;}
    running=true;clearTimeout(timer);setStatus('正在同步…');
    try {
      capture();
      for(let attempt=0;attempt<5;attempt++) {
        const remote=await request(cfg);if(version!==generation)return;
        if(!remote||!remote.entries||!Number.isSafeInteger(remote.revision))throw new Error('同步服务返回格式有误');
        let combined=merge(remote.entries,entries());
        if(JSON.stringify(combined)!==JSON.stringify(remote.entries)) {
          const result=await request(cfg,{method:'PUT',body:JSON.stringify({revision:remote.revision,entries:combined})});
          if(version!==generation)return;if(!result)continue;if(result.entries)combined=merge(combined,result.entries);
        }
        capture();const latest=merge(combined,entries());
        apply(latest);if(JSON.stringify(latest)!==JSON.stringify(combined))rerun=true;
        retries=0;setStatus('已同步 · '+new Date().toLocaleTimeString('zh-CN',{hour:'2-digit',minute:'2-digit'}));return;
      }
      throw new Error('其他设备正在更新，稍后自动重试');
    } catch(error) {
      if(version===generation){setStatus('同步失败：'+(error instanceof TypeError?'无法连接云端':error.message));if(!error.fatal&&retries<3){clearTimeout(timer);timer=setTimeout(sync,[3000,15000,60000][retries++]);}}
    } finally {running=false;if(rerun){rerun=false;clearTimeout(timer);timer=setTimeout(sync,600);}}
  }
  function ensureUI(){
    return ui??=CloudSyncUI.mount(document.body,{dialog:true,id:'health-sync-modal',ids:{url:'health-sync-url',key:'health-sync-key',reveal:'health-sync-show',status:'health-sync-status'},
      description:'蛋白质记录、断食记录、目标和食材库保存在你自己的 Cloudflare。手机和电脑填写相同的同步密钥，即可同步记录，离线时照常使用。',
      getConfig:config,onSave:connect,onDisconnect:disconnect,
      backup:{format:'JSON',accept:'.json,application/json',description:'导出包含摄入、断食、目标和食材库，不包含同步密钥。导入按记录合并，保留本机食材库。',export:()=>exportJSON(),import:event=>importJSON(event)}
    });
  }
  function open(){ensureUI().open();ui.setStatus(status);}
  function close(){ui?.close();}
  async function connect(next){
    try{
      const value=CloudSyncUI.validate(next||{url:document.getElementById('health-sync-url').value,key:document.getElementById('health-sync-key').value});
      const old=config();if(old.key&&(old.key!==value.key||old.url!==value.url)&&!confirm('更换连接配置后会合并本地与云端记录，继续？'))return;
      generation++;localStorage.setItem(CONFIG,JSON.stringify(value));retries=0;await sync();
    }catch(error){setStatus(error.message);throw error;}
  }
  function disconnect(){generation++;rerun=false;clearTimeout(timer);localStorage.removeItem(CONFIG);const input=document.getElementById('health-sync-key');if(input)input.value='';setStatus('已断开，本机和云端记录均保留');}
  window.HealthCloud={changed,sync,open,close,connect,disconnect};
  capture(localStorage.getItem(STATE)===null);
  window.addEventListener('online',()=>{retries=0;sync();});
  document.addEventListener('visibilitychange',()=>{if(!document.hidden){retries=0;sync();}});
  window.addEventListener('storage',e=>{if([STATE,CONFIG,RECORDS_KEY,'fasting-records',FOODS_KEY,TARGET_KEY,'fasting-mode'].includes(e.key)){generation++;apply(entries());sync();}});
  setInterval(()=>{if(!document.hidden)sync();},30000);
  sync();
})();
