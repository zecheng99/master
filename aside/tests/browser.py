"""Two isolated browser origins against disposable local Wrangler D1/R2; never production."""
from pathlib import Path
import http.server,threading,subprocess,json,time
from urllib.parse import quote
root=Path(__file__).resolve().parents[2]
class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self,*args,**kwargs):super().__init__(*args,directory=str(root),**kwargs)
    def translate_path(self,path):return super().translate_path(path.removeprefix('/master'))
    def log_message(self,*args):pass
server=http.server.ThreadingHTTPServer(('127.0.0.1',8000),Handler)
threading.Thread(target=server.serve_forever,daemon=True).start()
proxy='http://localhost:3456';targets=[]
def call(route,code=None):
    command=['curl','-fsS','--max-time','40',proxy+route]
    if code is not None:command+=['-X','POST','--data-binary',code]
    out=json.loads(subprocess.check_output(command));assert not out.get('error'),out
    return out.get('value',out)
def ev(target,code):return call('/eval?target='+target,code)
def wait(target,code,seconds=30):
    end=time.monotonic()+seconds
    while time.monotonic()<end:
        if ev(target,code):return
        time.sleep(.1)
    raise AssertionError(code+'\n'+str(ev(target,'document.body.innerText.slice(-1000)')))
def page(host):
    target=call('/new?url='+quote('http://'+host+':8000/master/aside/',safe=''))['targetId'];targets.append(target)
    wait(target,'typeof openSyncSetup==="function"&&!!window.AsideImages')
    return target
def connect(target):
    ev(target,'openSyncSetup();document.querySelector("#aside-sync-url").value="http://127.0.0.1:8793";document.querySelector("#aside-sync-key").value="aside-browser-test-key-123456789";document.querySelector(".cs-form").requestSubmit();true')
    wait(target,'!syncing&&!!localStorage.getItem("aside-sync-at")')
    assert ev(target,'syncCfg().url')=='http://127.0.0.1:8793'
    ev(target,'syncUI.close();true')
try:
    a=page('127.0.0.1')
    ev(a,'tags[0].keywords.push("浏览器测试词");saveTags();true')
    ev(a,'(async()=>{const blob=await(await fetch("icon-192.png")).blob();await attachBlobs([blob]);document.querySelector("#input").value="浏览器测试：吃了鸡蛋";await addEntry();return true;})()')
    connect(a);wait(a,'!syncing&&!syncErr')
    first=ev(a,'entries[0].id');image=ev(a,'entries[0].imgs[0]')
    assert ev(a,'(async()=>{const c=syncCfg();return (await fetch(c.url+"/images/"+entries[0].imgs[0],{method:"HEAD",headers:{Authorization:"Bearer "+c.token}})).ok;})()')
    b=page('localhost');connect(b)
    wait(b,'entries.length===1&&!!document.querySelector("#stream img[src]")')
    assert ev(b,'tags[0].keywords.includes("浏览器测试词")')
    assert ev(b,'(async()=>!!(await readImage(entries[0].imgs[0]))?.data)()')
    print('PASS: distinct browser stores, existing keyword protection, text and real JPEG upload/download via local Worker/R2',flush=True)
    ev(b,'Object.defineProperty(navigator,"onLine",{configurable:true,value:false});true')
    assert ev(b,'(async()=>!!(await imgURL(entries[0].imgs[0])))()')
    ev(b,'(async()=>{const blob=await(await fetch("icon-192.png")).blob();await attachBlobs([blob]);document.querySelector("#input").value="浏览器测试：离线图片";await addEntry();await doSync();return true;})()')
    assert ev(b,'entries.length')==2
    ev(b,'Object.defineProperty(navigator,"onLine",{configurable:true,value:true});doSync({manual:true});true')
    wait(b,'!syncing&&!syncErr');ev(a,'doSync({manual:true});true');wait(a,'entries.length===2&&!syncing')
    wait(a,'document.querySelectorAll("#stream img[src]").length===2')
    print('PASS: cached image opens offline, offline text/photo saves, reconnect uploads and both devices converge',flush=True)
    ev(a,'window.confirm=()=>true;entries=entries.filter(e=>e.id!=='+json.dumps(first)+');saveEntries();doSync({manual:true});true')
    wait(a,'!syncing');ev(b,'doSync({manual:true});true');wait(b,'entries.length===1&&!syncing')
    ev(a,'entries.push({id:"legacy",ts:Date.now(),date:todayKey(),time:"20:00",text:"旧设备图片",tagId:tags[0].id,imgs:["legacy-photo"]});saveEntries();doSync({manual:true});true')
    wait(a,'!syncing');ev(b,'doSync({manual:true});true');wait(b,'entries.some(e=>e.id==="legacy")&&!syncing')
    wait(b,'!!document.querySelector(".img-sync-placeholder")')
    ev(b,'window.__backup=null;shareOrDownload=(content)=>{window.__backup=JSON.parse(content);};exportJSON();true')
    wait(b,'document.querySelector("#toast").textContent.includes("备份未完成")')
    assert not ev(b,'!!window.__backup')
    ev(a,'(async()=>{const local=await readImage(entries.find(e=>e.imgs.length&&e.id!=="legacy").imgs[0]);await putImage({id:"legacy-photo",data:local.data,ts:Date.now()});await doSync({manual:true});return true;})()')
    ev(b,'doSync({manual:true});true');wait(b,'!syncing&&document.querySelectorAll("#stream img[src]").length===2')
    ev(b,'exportJSON();true');wait(b,'!!window.__backup')
    assert ev(b,'window.__backup.images.some(i=>i.id==="legacy-photo")')
    assert not ev(b,'JSON.stringify(window.__backup).includes("aside-browser-test-key")')
    print('PASS: remote deletion, legacy-image placeholder, incomplete backup is blocked, later upload hydrates and full backup excludes key',flush=True)
    ev(b,'openSyncSetup();true');assert ev(b,'document.querySelector("#aside-sync-key").type')=='password'
    assert ev(b,'document.querySelectorAll("#aside-sync-modal .cs-backup").length')==2
    ev(b,'syncUI.close();document.body.innerHTML="";const f=document.createElement("iframe");f.src=location.href;f.style.cssText="width:390px;height:844px;border:0";document.body.appendChild(f);true')
    wait(b,'typeof document.querySelector("iframe").contentWindow.openSyncSetup==="function"')
    for width in [320,390,430]:
        ev(b,f'document.querySelector("iframe").style.width="{width}px";true')
        info=ev(b,'(()=>{const f=document.querySelector("iframe"),w=f.contentWindow,d=f.contentDocument;w.openSyncSetup();const panel=d.querySelector(".cs-dialog").getBoundingClientRect();return {width:w.innerWidth,scroll:d.documentElement.scrollWidth,left:panel.left,right:panel.right};})()')
        assert info['width']==width and info['scroll']==width and info['left']>=0 and info['right']<=width,info
    print('PASS: shared panel, JSON/Markdown exports centralized, saved credentials remain masked and 320/390/430px layout fits',flush=True)
finally:
    for target in targets:call('/close?target='+target)
    server.shutdown()
