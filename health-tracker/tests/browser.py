"""Health tracker browser sync checks via web-access CDP; never sends production sync requests."""
import http.server
import json
from pathlib import Path
import threading
import time
import urllib.request

root = Path(__file__).resolve().parents[1]
class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(root), **kwargs)
    def log_message(self, *args):
        pass
server = http.server.ThreadingHTTPServer(('127.0.0.1', 0), Handler)
threading.Thread(target=server.serve_forever, daemon=True).start()
opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
proxy = 'http://localhost:3456'
def call(route, code=None):
    req = urllib.request.Request(proxy+route, data=code.encode() if code is not None else None)
    with opener.open(req, timeout=30) as response:
        out = json.load(response)
    assert not out.get('error'), out
    return out.get('value', out)
url = 'http://127.0.0.1:'+str(server.server_port)+'/'
target = call('/new?url='+url)['targetId']
def ev(code):
    return call('/eval?target='+target, code)
def wait(code):
    end = time.monotonic()+8
    while time.monotonic() < end:
        if ev(code):
            return
        time.sleep(.05)
    raise AssertionError(code)
try:
    wait('!!window.HealthCloud')
    assert ev('!!document.querySelector("#health-sync-button")')
    ev('window.__remote={revision:1,entries:{target:{value:120,stamp:"0000000000000100-seed"},"fast:2026-11-09:start":{value:"08:00",stamp:"0000000000000100-seed"},"protein:2026-11-09:remote":{value:{id:"remote",foodId:"f1",foodName:"鸡蛋",quantity:1,protein:7,timestamp:"10:00"},stamp:"0000000000000100-seed"}}};window.__calls=[];window.fetch=async(u,o)=>{window.__calls.push(o);if(o.method===\'PUT\'){window.__remote=JSON.parse(o.body);window.__remote.revision++;}return new Response(JSON.stringify(window.__remote),{headers:{"Content-Type":"application/json"}})};records={"2026-11-09":{entries:[{id:"local",foodId:"f1",foodName:"鸡蛋",quantity:1,protein:7,timestamp:"09:00"}]}};saveRecords();document.querySelector("#health-sync-button").click();document.querySelector("#health-sync-key").value="browser-health-test-key-123456789";HealthCloud.connect();true')
    wait('document.querySelector("#health-sync-status").textContent.startsWith("已同步")')
    assert ev('records["2026-11-09"].entries.length') == 2
    assert ev('target') == 120
    assert ev('fastRecords["2026-11-09"].start') == '08:00'
    assert ev('document.querySelector("#health-sync-key").type') == 'password'
    print('PASS: visible header entry, masked key setup, existing protein records merge, goals and fasting pull')
    ev('Object.defineProperty(navigator,"onLine",{configurable:true,value:false});fastRecords["2026-11-09"].end="16:00";saveFastRecords();HealthCloud.sync();true')
    count = ev('window.__calls.length')
    assert ev('fastRecords["2026-11-09"].end') == '16:00'
    ev('Object.defineProperty(navigator,"onLine",{configurable:true,value:true});HealthCloud.sync();true')
    wait('document.querySelector("#health-sync-status").textContent.startsWith("已同步")')
    assert ev('window.__remote.entries["fast:2026-11-09:end"].value') == '16:00'
    ev('records["2026-11-09"].entries=records["2026-11-09"].entries.filter(e=>e.id!=="local");saveRecords();HealthCloud.sync();true')
    wait('window.__remote.entries["protein:2026-11-09:local"].value===null')
    ev('window.__backup=null;shareOrDownload=(content)=>{window.__backup=JSON.parse(content);};exportJSON();true')
    assert not ev('JSON.stringify(window.__backup).includes("browser-health-test-key")')
    print('PASS: offline fasting update uploads after reconnect, protein deletion tombstone, backup excludes key')
    ev('window.fetch=async()=>{throw new TypeError("simulated failure")};HealthCloud.sync();true')
    wait('document.querySelector("#health-sync-status").textContent.startsWith("同步失败")')
    assert ev('records["2026-11-09"].entries.length') == 1
    ev('HealthCloud.disconnect();true')
    assert ev('records["2026-11-09"].entries.length') == 1
    ev('document.body.innerHTML="";const f=document.createElement("iframe");f.src=location.href;f.style.cssText="width:390px;height:844px;border:0";document.body.appendChild(f);true')
    wait('!!document.querySelector("iframe").contentWindow.HealthCloud')
    for width in [320,390,430]:
        ev(f'document.querySelector("iframe").style.width="{width}px";true')
        layout=ev('(()=>{const f=document.querySelector("iframe"),d=f.contentDocument;f.contentWindow.HealthCloud.open();const b=d.querySelector("#health-sync-modal .modal-box").getBoundingClientRect();return {width:f.contentWindow.innerWidth,scroll:d.documentElement.scrollWidth,left:b.left,right:b.right};})()')
        assert layout['width']==width and layout['scroll']==width and layout['left']>=0 and layout['right']<=width,layout
    print('PASS: failures and disconnect retain data; sync dialog fits 320/390/430px screens')
finally:
    call('/close?target='+target)
    server.shutdown()
