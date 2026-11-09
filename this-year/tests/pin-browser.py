"""Pin latency and rollback regression checks with a disposable HTTP backend and CDP."""
import copy
import http.server
import json
from pathlib import Path
import threading
import time
import urllib.request

ROOT = Path(__file__).resolve().parents[1]
opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
state = {"wishes": [{"id": "test-pin", "title": "测试心愿", "target": None,
    "progress": 0, "completed": 0, "completed_on": None, "position": 0,
    "category": "日常生活", "pinned": 0}], "entries": []}
gate = threading.Event()
started = threading.Event()
read_gate = threading.Event()
read_started = threading.Event()
control = {"fail": False, "state_reads": 0, "hold_read": False, "offline": False}

class Handler(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *args):
        pass

    def translate_path(self, path):
        relative = path.split("?", 1)[0].removeprefix("/master/this-year/")
        return str(ROOT / (relative or "index.html"))

    def send_json(self, data, status=200):
        body = json.dumps(data).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        if self.path == "/api/state":
            control["state_reads"] += 1
            snapshot = copy.deepcopy(state)
            if control["hold_read"]:
                control["hold_read"] = False
                read_started.set()
                read_gate.wait(10)
            self.send_json({"error": "offline"} if control["offline"] else snapshot,
                           503 if control["offline"] else 200)
        elif self.path.startswith("/master/this-year/"):
            super().do_GET()
        else:
            self.send_error(404)

    def do_PATCH(self):
        assert self.path == "/api/wishes/test-pin/pin"
        body = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
        started.set()
        gate.wait(10)
        if control["fail"]:
            self.send_json({"error": "模拟置顶保存失败"}, 409)
        else:
            state["wishes"][0]["pinned"] = int(body["pinned"])
            self.send_json({"ok": True})

server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), Handler)
threading.Thread(target=server.serve_forever, daemon=True).start()
base = "http://127.0.0.1:" + str(server.server_port)
proxy = "http://localhost:3456"

def call(route, code=None):
    req = urllib.request.Request(proxy + route, data=code.encode() if code is not None else None)
    with opener.open(req, timeout=20) as response:
        result = json.load(response)
    assert not result.get("error"), result
    return result.get("value", result)

target = call("/new?url=" + base + "/master/this-year/")["targetId"]

def ev(code):
    return call("/eval?target=" + target, code)

def wait(code, seconds=5):
    end = time.monotonic() + seconds
    while time.monotonic() < end:
        if ev(code):
            return
        time.sleep(.03)
    raise AssertionError(code)

def pinned():
    return ev('document.querySelector(".pin-button")?.getAttribute("aria-pressed")')

try:
    config = {"url": base, "key": "local-test-only-key-123456789"}
    ev('localStorage.setItem("thisyear_connection_v1",' + json.dumps(json.dumps(config)) + ');true')
    call("/navigate?target=" + target + "&url=" + base + "/master/this-year/")
    wait('!!document.querySelector("#tab-all")')
    ev('document.querySelector("#tab-all").click();true')
    wait('!!document.querySelector(".pin-button")')
    wait('!!localStorage.getItem("thisyear_snapshot_v1")')
    initial_reads = control["state_reads"]
    # Hold an old read until AFTER the pin commits, then verify it cannot revert the UI/cache.
    control["hold_read"] = True
    ev('Object.defineProperty(document,"visibilityState",{configurable:true,value:"visible"});window.dispatchEvent(new Event("online"));true')
    assert read_started.wait(3)
    begin = time.monotonic()
    ev('document.querySelector(".pin-button").click();true')
    wait('document.querySelector(".pin-button").getAttribute("aria-pressed")==="true"', 1)
    elapsed = time.monotonic() - begin
    assert started.wait(3)
    assert state["wishes"][0]["pinned"] == 0, "UI must update before the server reply"
    assert ev('JSON.parse(localStorage.thisyear_snapshot_v1).state.wishes[0].pinned') == 0
    gate.set()
    wait('!document.querySelector(".pin-button").disabled')
    read_gate.set()
    time.sleep(.3)
    assert pinned() == "true"
    assert ev('JSON.parse(localStorage.thisyear_snapshot_v1).state.wishes[0].pinned') == 1
    assert control["state_reads"] == initial_reads + 1, "No full state reload after pin"
    print(f"PASS: immediate pin feedback ({elapsed*1000:.0f} ms), one PATCH, stale-read protection, committed snapshot")
    # Failure restores both the card and the detail button without persisting tentative state.
    ev('document.querySelector(".wish-content").click();true')
    wait('!!document.querySelector(".detail-pin button")')
    gate.clear()
    started.clear()
    control["fail"] = True
    ev('document.querySelector(".detail-pin button").click();true')
    wait('document.querySelector(".detail-pin button").getAttribute("aria-pressed")==="false"', 1)
    assert started.wait(3)
    gate.set()
    wait('!!document.querySelector(".inline-error")')
    assert ev('document.querySelector(".detail-pin button").getAttribute("aria-pressed")') == "true"
    assert ev('JSON.parse(localStorage.thisyear_snapshot_v1).state.wishes[0].pinned') == 1
    print("PASS: failed unpin rolls back card/detail state and retains last committed snapshot")
    control["fail"] = False
    ev('document.querySelector(".detail-pin button").click();true')
    wait('!document.querySelector(".detail-pin button").disabled')
    assert pinned() == "false"
    assert state["wishes"][0]["pinned"] == 0
    wait('JSON.parse(localStorage.thisyear_snapshot_v1).state.wishes[0].pinned===0')
    control["offline"] = True
    call("/navigate?target=" + target + "&url=" + base + "/master/this-year/")
    wait('!!document.querySelector(".offline-banner")')
    assert ev('JSON.parse(localStorage.thisyear_connection_v1).key') == config["key"]
    print("PASS: successful unpin, offline snapshot fallback, connection settings preserved")
finally:
    gate.set()
    read_gate.set()
    call("/close?target=" + target)
    server.shutdown()
