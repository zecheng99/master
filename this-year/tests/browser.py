"""Run against disposable local D1/R2 via the web-access CDP proxy, never production."""
import urllib.request,json,time,re,sys
from pathlib import Path
opener=urllib.request.build_opener(urllib.request.ProxyHandler({}))
proxy='http://localhost:3456'
target=sys.argv[1] if len(sys.argv)>1 else json.load(opener.open(proxy+'/new?url=http%3A%2F%2F127.0.0.1%3A8000%2Fmaster%2Fthis-year%2F'))['targetId']
def call(route,code=None):
 req=urllib.request.Request(proxy+route,data=code.encode() if isinstance(code,str) else json.dumps(code).encode() if code is not None else None)
 with opener.open(req,timeout=35) as r:data=json.load(r)
 if data.get('error'):raise AssertionError(data['error'])
 return data.get('value',data)
def ev(code):return call('/eval?target='+target,code)
def wait(code,seconds=20):
 end=time.time()+seconds
 while time.time()<end:
  if ev(code):return
  time.sleep(.25)
 raise AssertionError('Timed out: '+code+'\n'+str(ev('document.body.innerText.slice(-1400)')))
def set_input(selector,value,textarea=False):
 ev("(()=>{const e=document.querySelector("+json.dumps(selector)+");Object.getOwnPropertyDescriptor("+('HTMLTextAreaElement' if textarea else 'HTMLInputElement')+".prototype,'value').set.call(e,"+json.dumps(value)+");e.dispatchEvent(new Event('input',{bubbles:true}));return true;})()")
def click(selector):ev('document.querySelector('+json.dumps(selector)+').click();true')
def button(text):ev('Array.from(document.querySelectorAll("button")).find(e=>e.textContent.trim()==='+json.dumps(text)+').click();true')
key=re.search(r'SYNC_KEY="([^"]+)"',Path('sync-worker/.dev.vars').read_text()).group(1)
ev('localStorage.setItem("thisyear_connection_v1",'+json.dumps(json.dumps({'url':'http://127.0.0.1:8787','key':key}))+');true')
ev("(async()=>{const c=JSON.parse(localStorage.thisyear_connection_v1);if(c.url!=='http://127.0.0.1:8787')throw Error('Local only');const headers={Authorization:'Bearer '+c.key};const data=await(await fetch(c.url+'/api/state',{headers})).json();for(const w of data.wishes.filter(w=>w.title.startsWith('浏览器验证')))await fetch(c.url+'/api/wishes/'+w.id,{method:'DELETE',headers});setTimeout(()=>location.reload(),100);return true;})()")
time.sleep(.5)
wait('document.querySelectorAll(".wish-card").length===11')
ev("window.confirm=()=>true;window.scrollTo(0,0);true")
click('.section-head .primary');set_input('.wish-form input','浏览器验证心愿');button('次数目标');set_input('.wish-form input[type=number]','3');ev('document.querySelector(".wish-form").requestSubmit();true')
wait('document.querySelectorAll(".wish-card").length===12 && !document.querySelector(".modal")')
ev("Array.from(document.querySelectorAll('.wish-card')).find(e=>e.textContent.includes('浏览器验证心愿')).querySelector('[aria-label=\"记录一次\"]').click();true")
wait("Array.from(document.querySelectorAll('.wish-card')).some(e=>e.textContent.includes('浏览器验证心愿')&&e.textContent.includes('1 / 3'))")
ev("Array.from(document.querySelectorAll('.wish-card')).find(e=>e.textContent.includes('浏览器验证心愿')).querySelector('.wish-content').click();true")
button('写一笔');set_input('#entry-body','照片与心得：第一次测试',True)
call('/setFiles?target='+target,{'selector':'.upload-label input[type=file]','files':[str(Path('public/icon-512.png').resolve())]})
wait('document.querySelectorAll(".photo-thumb img").length===1 && document.querySelector(".photo-thumb img").naturalWidth>0')
button('保存记录');wait('!document.querySelector(".entry-editor")&&document.querySelectorAll(".entry-photos img").length===1');ev('document.querySelector(".entry-photos img").scrollIntoView();true');wait('document.querySelector(".entry-photos img").naturalWidth>0')
print('PASS: browser create/count wish, compose journal, compress/upload/decode photo',flush=True)
click('[aria-label="编辑这条心得"]');set_input('#entry-body','失败后重试，文字仍在',True)
ev("window.__realFetch=window.fetch;window.fetch=(u,o)=>o?.method==='PUT'?Promise.reject(new TypeError('simulated network failure')):window.__realFetch(u,o);true")
button('保存记录');wait('document.querySelector(".inline-error")&&document.querySelector("#entry-body").value==="失败后重试，文字仍在"')
ev('window.fetch=window.__realFetch;true');button('保存记录');wait('!document.querySelector(".entry-editor")&&document.querySelector(".entry p").textContent==="失败后重试，文字仍在"')
click('.stepper button:last-child');wait('document.querySelector(".stepper span").textContent==="2 / 3"');click('.stepper button:last-child');wait('document.querySelector(".detail-actions").textContent.includes("撤销完成")')
click('[aria-label="关闭"]');click('.top-note')
ev("window.__originalObjectURL=URL.createObjectURL;URL.createObjectURL=b=>{if(b.type==='application/json')window.__backupBlob=b;return window.__originalObjectURL(b);};window.__anchorClick=HTMLAnchorElement.prototype.click;HTMLAnchorElement.prototype.click=function(){if(this.download)return;window.__anchorClick.call(this);};Object.defineProperty(navigator,'canShare',{value:()=>false,configurable:true});true")
button('导出完整备份');wait('!!window.__backupBlob')
summary=ev("(async()=>{const b=JSON.parse(await window.__backupBlob.text());return {wishes:b.wishes.length,entries:b.entries.length,photos:b.photos.length,hasSecret:JSON.stringify(b).includes(JSON.parse(localStorage.thisyear_connection_v1).key)};})()")
assert summary=={'wishes':12,'entries':1,'photos':1,'hasSecret':False},summary
click('[aria-label="关闭"]');ev("Array.from(document.querySelectorAll('.wish-card')).find(e=>e.textContent.includes('浏览器验证心愿')).querySelector('.wish-content').click();true");button('删除心愿');wait('document.querySelectorAll(".wish-card").length===11&&!document.querySelector(".modal")')
click('.top-note')
for i in range(2):
 ev("(()=>{const input=document.querySelector('.import-label input');const dt=new DataTransfer();dt.items.add(new File([window.__backupBlob],'backup.json',{type:'application/json'}));input.files=dt.files;input.dispatchEvent(new Event('change',{bubbles:true}));return true;})()")
 wait('document.querySelectorAll(".wish-card").length===12&&!document.querySelector(".backup-tools button").disabled')
click('[aria-label="关闭"]');ev("Array.from(document.querySelectorAll('.wish-card')).find(e=>e.textContent.includes('浏览器验证心愿')).querySelector('.wish-content').click();true")
wait('document.querySelectorAll(".entry").length===1&&document.querySelectorAll(".entry-photos img").length===1');ev('document.querySelector(".entry-photos img").scrollIntoView();true');wait('document.querySelector(".entry-photos img").naturalWidth>0')
assert ev('document.querySelector(".stepper span").textContent')=='3 / 3'
print('PASS: failed-save draft retention, retry, auto completion, photo-inclusive backup and idempotent restore',flush=True)
click('[aria-label="关闭"]');ev('window.scrollTo(0,0);true');call('/screenshot?target='+target+'&file=/private/tmp/thisyear-desktop.png')
ev("(()=>{const f=document.createElement('iframe');f.id='mobile-qa';f.src=location.href;f.style.cssText='width:390px;height:844px;border:0;display:block;margin:auto;background:#f7f5ed';document.body.replaceChildren(f);document.body.style.margin='0';document.body.style.background='#e6e6dd';return true;})()")
wait('document.querySelector("iframe")?.contentDocument?.querySelectorAll(".wish-card").length===12')
layout=ev("(()=>{const f=document.querySelector('iframe'),d=f.contentDocument,w=f.contentWindow;return {width:w.innerWidth,scroll:d.documentElement.scrollWidth,columns:w.getComputedStyle(d.querySelector('.wish-grid')).gridTemplateColumns,photos:d.querySelectorAll('.wish-card').length};})()")
assert layout['width']==390 and layout['scroll']==390 and ' ' not in layout['columns'],layout
call('/screenshot?target='+target+'&file=/private/tmp/thisyear-mobile.png')
print('PASS: 390px mobile viewport, single-column cards, no horizontal overflow',flush=True)
print('Local QA target: '+target,flush=True)
