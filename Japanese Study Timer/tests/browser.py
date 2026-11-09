"""Disposable browser sync checks via web-access CDP; never sends production sync requests."""
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
    wait('!!document.querySelector("#syncUrl")')
    assert ev('document.querySelector("#syncUrl").value') == 'https://jp-study-sync.zechengyu90.workers.dev'
    assert ev('document.querySelector("#syncToken").type') == 'password'
    ev('''window.__requests=[];window.__reply={now:1000,sessions:[{id:"remote",data:JSON.stringify({id:"remote",date:"2026-11-09",duration:900,topic:"听力"})}],settings:JSON.stringify({dailyGoalMinutes:45,weeklyGoalDays:5})};window.fetch=async(u,o)=>{window.__requests.push(JSON.parse(o.body));return new Response(JSON.stringify(window.__reply),{status:200,headers:{"Content-Type":"application/json"}})};const local=loadData();local.sessions=[{id:"local",date:"2026-11-08",duration:600,topic:"阅读"}];local.activeTimer={topic:"本地计时",elapsed:30,running:false};saveData(local);switchTab("settings");document.querySelector("#syncToken").value="browser-test-only-key-123456789";saveSyncCfg();true''')
    wait('!syncing&&loadData().sessions.length===2')
    assert ev('loadData().settings.dailyGoalMinutes') == 45
    assert ev('loadData().activeTimer.topic') == '本地计时'
    assert ev('window.__requests[0].sessions[0].id') == 'local'
    assert ev('document.querySelector("#syncDetail").hidden')
    assert ev('document.querySelector("#syncToken").type') == 'password'
    assert not ev('"activeTimer" in window.__requests[0]')
    print('PASS: key-only setup, existing data upload, remote pull, goals, masked key and local timer')
    ev('Object.defineProperty(navigator,"onLine",{configurable:true,value:false});const d=loadData();d.sessions.push({id:"offline",date:"2026-11-09",duration:60,topic:"离线"});saveData(d);doSync();true')
    assert ev('window.__requests.length') == 1
    assert ev('loadData().sessions.length') == 3
    ev('Object.defineProperty(navigator,"onLine",{configurable:true,value:true});window.__reply={now:2000,sessions:[{id:"remote",deleted:1}],settings:null};doSync();true')
    wait('!syncing&&loadData().sessions.length===2')
    assert ev('window.__requests[1].sessions.some(s=>s.id==="offline")')
    assert ev('loadData().sessions.every(s=>s.id!=="remote")')
    assert ev('loadData().activeTimer.topic') == '本地计时'
    print('PASS: offline edits remain local, reconnect uploads pending record, remote deletion applies')
    ev('window.fetch=async()=>{throw new Error("simulated offline")};doSync({manual:true});true')
    wait('!syncing&&!!syncErr')
    assert ev('loadData().sessions.length') == 2
    assert ev('localStorage.getItem("jp-sync-token")') == 'browser-test-only-key-123456789'
    print('PASS: request failures preserve records and connection settings')
finally:
    call('/close?target='+target)
    server.shutdown()
