"""Run against disposable local D1/R2 via web-access CDP Proxy, never production."""
import urllib.request,json,time,re,sys
from pathlib import Path
opener=urllib.request.build_opener(urllib.request.ProxyHandler({}));proxy='http://localhost:3456'
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
def card_action(title,selector):ev('Array.from(document.querySelectorAll(".wish-card")).find(e=>e.textContent.includes('+json.dumps(title)+')).querySelector('+json.dumps(selector)+').click();true')
key=re.search(r'SYNC_KEY="([^"]+)"',Path('sync-worker/.dev.vars').read_text()).group(1)
ev('localStorage.setItem("thisyear_connection_v1",'+json.dumps(json.dumps({'url':'http://127.0.0.1:8787','key':key}))+');true')
ev("(async()=>{const c=JSON.parse(localStorage.thisyear_connection_v1);if(c.url!=='http://127.0.0.1:8787')throw Error('Local only');const headers={Authorization:'Bearer '+c.key};const data=await(await fetch(c.url+'/api/state',{headers})).json();for(const w of data.wishes){if(w.title.startsWith('浏览器验证')){await fetch(c.url+'/api/wishes/'+w.id,{method:'DELETE',headers});continue;}if(w.pinned)await fetch(c.url+'/api/wishes/'+w.id+'/pin',{method:'PATCH',headers:{...headers,'Content-Type':'application/json'},body:JSON.stringify({pinned:false})});if(w.title.includes('声乐')||w.title.includes('健身'))await fetch(c.url+'/api/wishes/'+w.id,{method:'PATCH',headers:{...headers,'Content-Type':'application/json'},body:JSON.stringify(w.title.includes('声乐')?{title:'上15节声乐课',target:15,progress:7,category:'学习与成长'}:{progress:1})});}setTimeout(()=>location.reload(),100);return true;})()")
time.sleep(.5)
wait('document.querySelectorAll(".home-ongoing .wish-card").length===2')
assert ev('document.querySelectorAll("[role=tab]").length')==2
assert ev('document.querySelectorAll(".home-pinned .wish-card").length')==0
click('#tab-all');wait('document.querySelectorAll(".wish-card").length===11')
assert ev('document.querySelectorAll(".category-section").length')==4
for i in range(7):
 ev('Array.from(document.querySelectorAll(".pin-button")).find(b=>b.getAttribute("aria-pressed")==="false"&&!b.disabled).click();true')
 wait(f'document.querySelectorAll(".pin-button.is-pinned").length==={i+1}')
assert ev('Array.from(document.querySelectorAll(".pin-button")).filter(b=>b.getAttribute("aria-pressed")==="false").every(b=>b.disabled)')
click('#tab-home');wait('document.querySelectorAll(".home-pinned .wish-card").length===7')
assert ev('document.querySelectorAll(".home-ongoing .wish-card").length')==2
for i in range(7):
 click('.home-pinned .pin-button');wait(f'document.querySelectorAll(".home-pinned .wish-card").length==={6-i}')
click('#tab-all');wait('document.querySelectorAll(".wish-card").length===11')
print('PASS: two tabs, four categories, seven-pin cap, unpin, automatic voice 7/15 and gym 1/30 sections',flush=True)
ev('window.confirm=()=>true;true')
click('[data-action="add-wish"]');set_input('.wish-form input','浏览器验证心愿');button('次数目标');set_input('.wish-form input[type=number]','3')
ev("document.querySelector('#wish-category').value='学习与成长';document.querySelector('#wish-category').dispatchEvent(new Event('change',{bubbles:true}));true")
ev('document.querySelector(".wish-form").requestSubmit();true');wait('document.querySelectorAll(".wish-card").length===12&&!document.querySelector(".modal")')
card_action('浏览器验证心愿','.pin-button');wait('document.querySelectorAll(".pin-button.is-pinned").length===1');click('#tab-home');wait('document.querySelectorAll(".home-pinned .wish-card").length===1')
click('.home-pinned [aria-label="记录一次"]');wait('document.querySelectorAll(".home-pinned .wish-card").length===0&&document.querySelectorAll(".home-ongoing .wish-card").length===3')
click('#tab-all');wait('document.querySelectorAll(".wish-card").length===12');card_action('浏览器验证心愿','.wish-content')
button('写一笔');set_input('#entry-body','照片与心得：第一次测试',True)
call('/setFiles?target='+target,{'selector':'.upload-label input[type=file]','files':[str(Path('public/icon-512.png').resolve())]})
wait('document.querySelectorAll(".photo-thumb img").length===1&&document.querySelector(".photo-thumb img").naturalWidth>0')
button('保存记录');wait('!document.querySelector(".entry-editor")&&document.querySelectorAll(".entry-photos img").length===1');ev('document.querySelector(".entry-photos img").scrollIntoView();true');wait('document.querySelector(".entry-photos img").naturalWidth>0')
print('PASS: pinned count moves to ongoing without duplication; category editing; journal and photo upload',flush=True)
click('[aria-label="编辑这条心得"]');set_input('#entry-body','失败后重试，文字仍在',True)
ev("window.__realFetch=window.fetch;window.fetch=(u,o)=>o?.method==='PUT'?Promise.reject(new TypeError('simulated failure')):window.__realFetch(u,o);true")
button('保存记录');wait('document.querySelector(".inline-error")&&document.querySelector("#entry-body").value==="失败后重试，文字仍在"')
ev('window.fetch=window.__realFetch;true');button('保存记录');wait('!document.querySelector(".entry-editor")&&document.querySelector(".entry p").textContent==="失败后重试，文字仍在"')
click('.stepper button:last-child');wait('document.querySelector(".stepper span").textContent==="2 / 3"');click('.stepper button:last-child');wait('document.querySelector(".detail-actions").textContent.includes("撤销完成")')
click('[aria-label="关闭"]');click('[data-action="add-wish"]');set_input('.wish-form input','浏览器验证备份置顶');ev('document.querySelector(".wish-form").requestSubmit();true');wait('document.querySelectorAll(".wish-card").length===13&&!document.querySelector(".modal")')
card_action('浏览器验证备份置顶','.pin-button');wait('document.querySelectorAll(".pin-button.is-pinned").length===1');click('.top-note')
ev("window.__originalObjectURL=URL.createObjectURL;URL.createObjectURL=b=>{if(b.type==='application/json')window.__backupBlob=b;return window.__originalObjectURL(b);};window.__anchorClick=HTMLAnchorElement.prototype.click;HTMLAnchorElement.prototype.click=function(){if(this.download)return;window.__anchorClick.call(this);};Object.defineProperty(navigator,'canShare',{value:()=>false,configurable:true});true")
button('导出完整备份');wait('!!window.__backupBlob')
summary=ev("(async()=>{const b=JSON.parse(await window.__backupBlob.text());return {wishes:b.wishes.length,entries:b.entries.length,photos:b.photos.length,hasSecret:JSON.stringify(b).includes(JSON.parse(localStorage.thisyear_connection_v1).key),pins:b.wishes.filter(w=>w.pinned).length,category:b.wishes.find(w=>w.title==='浏览器验证心愿').category};})()")
assert summary=={'wishes':13,'entries':1,'photos':1,'hasSecret':False,'pins':1,'category':'学习与成长'},summary
click('[aria-label="关闭"]');card_action('浏览器验证心愿','.wish-content');button('删除心愿');wait('document.querySelectorAll(".wish-card").length===12&&!document.querySelector(".modal")')
card_action('浏览器验证备份置顶','.wish-content');button('删除心愿');wait('document.querySelectorAll(".wish-card").length===11&&!document.querySelector(".modal")');click('.top-note')
for i in range(2):
 ev("(()=>{const input=document.querySelector('.import-label input');const dt=new DataTransfer();dt.items.add(new File([window.__backupBlob],'backup.json',{type:'application/json'}));input.files=dt.files;input.dispatchEvent(new Event('change',{bubbles:true}));return true;})()")
 wait('document.querySelectorAll(".wish-card").length===13&&!document.querySelector(".backup-tools button").disabled')
click('[aria-label="关闭"]');card_action('浏览器验证心愿','.wish-content');wait('document.querySelectorAll(".entry").length===1&&document.querySelectorAll(".entry-photos img").length===1');ev('document.querySelector(".entry-photos img").scrollIntoView();true');wait('document.querySelector(".entry-photos img").naturalWidth>0')
assert ev('document.querySelector(".stepper span").textContent')=='3 / 3'
click('[aria-label="关闭"]');assert ev('document.querySelectorAll(".pin-button.is-pinned").length')==1
print('PASS: save-failure retention and retry, completion, category/pin/photo-inclusive backup and idempotent restore',flush=True)
click('#tab-home');wait('document.querySelectorAll(".home-ongoing .wish-card").length===2&&document.querySelectorAll(".home-pinned .wish-card").length===1')
ev('window.scrollTo(0,0);true');call('/screenshot?target='+target+'&file=/private/tmp/thisyear-focus-desktop.png')
ev("(()=>{const f=document.createElement('iframe');f.src=location.href;f.style.cssText='width:390px;height:844px;border:0;display:block;margin:auto';document.body.replaceChildren(f);return true;})()")
wait('document.querySelector("iframe")?.contentDocument?.querySelectorAll(".home-pinned .wish-card").length===1&&document.querySelector("iframe")?.contentDocument?.querySelectorAll(".home-ongoing .wish-card").length===2')
for width in [320,390,430]:
 ev(f"document.querySelector('iframe').style.width='{width}px';true")
 layout=ev("(()=>{const f=document.querySelector('iframe'),d=f.contentDocument,w=f.contentWindow;return {width:w.innerWidth,scroll:d.documentElement.scrollWidth,columns:w.getComputedStyle(d.querySelector('.wish-grid')).gridTemplateColumns};})()")
 assert layout['width']==width and layout['scroll']==width and ' ' not in layout['columns'],layout
 ev("document.querySelector('iframe').contentDocument.querySelector('#tab-all').click();true")
 wait('document.querySelector("iframe").contentDocument.querySelectorAll(".wish-card").length===13')
 assert ev('document.querySelector("iframe").contentDocument.documentElement.scrollWidth')==width
 ev("document.querySelector('iframe').contentDocument.querySelector('#tab-home').click();true")
ev("document.querySelector('iframe').style.width='390px';true");call('/screenshot?target='+target+'&file=/private/tmp/thisyear-focus-mobile.png')
print('PASS: both pages at 320/390/430px, no overflow, one pinned card plus two ongoing courses without duplicates',flush=True)
print('Local QA target: '+target,flush=True)
