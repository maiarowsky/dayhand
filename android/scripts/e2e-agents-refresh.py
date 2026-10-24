#!/usr/bin/env python3
"""Drive the real paired Android app against a local backend with reordered HTTP responses.

Use ONLY a disposable emulator/backend. Requires built debug and androidTest APKs,
DAYHAND_URL / DAYHAND_API_KEY for that backend, and adb on PATH. No fake app/API is used:
the proxy forwards real requests, holding selected responses or injecting one HTTP 503.

  python3 scripts/e2e-agents-refresh.py --apk app-debug.apk --test-apk app-debug-androidTest.apk \
      --api-url http://127.0.0.1:13210 --site-url http://127.0.0.1:13211 --shots DIR
"""
import argparse
import http.client
import importlib.util
import json
import os
from pathlib import Path
import select
import socket
import subprocess
import sys
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlsplit

sys.dont_write_bytecode = True
HERE = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location("dayhand_e2e", HERE / "e2e-offline.py")
base = importlib.util.module_from_spec(spec)
spec.loader.exec_module(base)
CLASS = "dev.helm.planner.ui.AgentsLiveRefreshTest"
TOOL = "complete_task"


class DelayProxy:
    def __init__(self, api_url, site_url, api_port, site_port, key):
        self.api_url, self.site_url = api_url, site_url
        self.api_port, self.site_port, self.key = api_port, site_port, key
        self.lock = threading.Lock()
        self.holds = {}
        self.calls = []
        self.servers = []

    def cli_json(self, *args):
        return json.loads(base.dayhand_cli(*args, "--json"))

    def controls(self):
        controls = self.cli_json("agents")
        print("VERIFIED VIA CLI " + json.dumps(controls), flush=True)
        return controls

    def control(self, path, data):
        if path == "/_test/reset":
            with self.lock:
                for hold in self.holds.values():
                    hold["event"].set()
                self.holds = {}
                self.calls = []
            base.dayhand_cli("policy", "set", self.key["id"], "*", "ask")
            base.dayhand_cli("policy", "set", self.key["id"], TOOL, "ask")
            base.dayhand_cli("agents", "resume")
            return {"keyName": self.key["name"]}
        if path == "/_test/arm":
            with self.lock:
                self.holds[data["id"]] = {**data, "event": threading.Event(), "claimed": False, "waiting": False}
            return {"armed": data["id"]}
        if path == "/_test/release":
            with self.lock:
                hold = self.holds[data["id"]]
                if hold.get("timedOut"):
                    raise RuntimeError(f"Hold {data['id']} timed out before explicit release")
                hold["event"].set()
            print(f"RELEASE {data['id']}", flush=True)
            return {"released": data["id"]}
        if path == "/_test/state":
            with self.lock:
                return {"holds": {name: {k: v for k, v in hold.items() if k != "event"}
                                  for name, hold in self.holds.items()}, "calls": list(self.calls)}
        if path == "/_test/controls":
            return self.controls()
        raise ValueError("Unknown control endpoint")

    def claim(self, path):
        with self.lock:
            for hold in self.holds.values():
                if hold["path"] == path and not hold["claimed"]:
                    hold["claimed"] = True
                    return hold
        return None

    def hold(self, hold):
        with self.lock:
            hold["waiting"] = True
        print(f"HOLD {hold['id']} {hold['path']} ({hold.get('phase', 'response')})", flush=True)
        if not hold["event"].wait(12):
            with self.lock:
                hold["timedOut"] = True
            print(f"TIMEOUT {hold['id']} (app HTTP timeout is 15s)", flush=True)
        with self.lock:
            hold["waiting"] = False
            hold["finished"] = True

    def start(self):
        owner = self

        class Handler(BaseHTTPRequestHandler):
            protocol_version = "HTTP/1.1"

            def log_message(self, *_):
                pass

            def send(self, status, body, headers=()):
                self.send_response(status)
                for key, value in headers:
                    if key.lower() not in ("content-length", "connection", "transfer-encoding"):
                        self.send_header(key, value)
                self.send_header("Content-Length", str(len(body)))
                self.send_header("Connection", "close")
                self.end_headers()
                self.wfile.write(body)
                self.close_connection = True

            def do_GET(self):
                self.handle_request()

            def do_POST(self):
                self.handle_request()

            def handle_request(self):
                body = self.rfile.read(int(self.headers.get("Content-Length", "0")))
                data = json.loads(body) if body else {}
                if self.path.startswith("/_test/"):
                    try:
                        result = owner.control(self.path, data)
                        self.send(200, json.dumps(result).encode(), [("Content-Type", "application/json")])
                    except Exception as error:
                        self.send(500, json.dumps({"error": str(error)}).encode())
                    return
                target = urlsplit(owner.api_url if self.server.server_port == owner.api_port else owner.site_url)
                if self.headers.get("Upgrade", "").lower() == "websocket":
                    self.relay_websocket(target)
                    return
                path = data.get("path", self.path)
                hold = owner.claim(path)
                if hold and hold.get("status"):
                    print(f"INJECT HTTP {hold['status']} {path}", flush=True)
                    self.send(hold["status"], b'{"error":"disposable transport failure"}')
                    return
                if hold and hold.get("phase") == "request":
                    owner.hold(hold)
                connection = http.client.HTTPConnection(target.hostname, target.port, timeout=20)
                headers = {k: v for k, v in self.headers.items() if k.lower() not in ("host", "connection")}
                connection.request(self.command, self.path, body, headers)
                response = connection.getresponse()
                result = response.read()
                result_headers = response.getheaders()
                status = response.status
                connection.close()
                if self.path == "/auth/pair" and status == 200:
                    value = json.loads(result)
                    value["convexUrl"] = f"http://127.0.0.1:{owner.api_port}"
                    result = json.dumps(value).encode()
                if path.startswith("app:") and path in (
                    "app:getAgentControls", "app:listApprovals", "app:listProposals", "app:setToolPolicy", "app:pauseAgents"
                ):
                    entry = {"path": path, "status": status}
                    if path in ("app:setToolPolicy", "app:pauseAgents"):
                        entry["args"] = data.get("args")
                    if path == "app:getAgentControls":
                        entry["controls"] = json.loads(result).get("value")
                    with owner.lock:
                        owner.calls.append(entry)
                    print("REAL BACKEND " + json.dumps(entry), flush=True)
                if hold and hold.get("phase", "response") == "response":
                    owner.hold(hold)
                self.send(status, result, result_headers)

            def relay_websocket(self, target):
                with socket.create_connection((target.hostname, target.port), timeout=20) as upstream:
                    request = f"{self.command} {self.path} HTTP/1.1\r\n"
                    request += "".join(f"{key}: {value}\r\n" for key, value in self.headers.items()) + "\r\n"
                    upstream.sendall(request.encode())
                    while True:
                        ready, _, _ = select.select([self.connection, upstream], [], [], 2)
                        for source in ready:
                            chunk = source.recv(65536)
                            if not chunk:
                                self.close_connection = True
                                return
                            (upstream if source is self.connection else self.connection).sendall(chunk)

        for port in (self.api_port, self.site_port):
            server = ThreadingHTTPServer(("127.0.0.1", port), Handler)
            server.daemon_threads = True
            self.servers.append(server)
            threading.Thread(target=server.serve_forever, daemon=True).start()

    def stop(self):
        with self.lock:
            for hold in self.holds.values():
                hold["event"].set()
        for server in self.servers:
            server.shutdown()
            server.server_close()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--apk", required=True)
    parser.add_argument("--test-apk", required=True)
    parser.add_argument("--api-url", required=True)
    parser.add_argument("--site-url", required=True)
    parser.add_argument("--api-port", type=int, default=14210)
    parser.add_argument("--site-port", type=int, default=14211)
    parser.add_argument("--shots", required=True)
    parser.add_argument("--method", help="Run only this instrumentation test method")
    args = parser.parse_args()
    # The caller owns isolation. Refuse accidentally pointing at a shared/cloud backend.
    for url in (args.api_url, args.site_url):
        if urlsplit(url).hostname not in ("127.0.0.1", "localhost"):
            parser.error("This race driver only accepts a disposable loopback backend")
    shots = Path(args.shots)
    shots.mkdir(parents=True, exist_ok=True)
    key = json.loads(base.dayhand_cli("key", "create", "race-worker-" + str(int(time.time())), "--scope", "write", "--expires", "1d", "--json"))
    proxy = DelayProxy(args.api_url, args.site_url, args.api_port, args.site_port, key)
    proxy.start()
    try:
        proxy.control("/_test/reset", {})
        base.adb("install", "-r", args.apk)
        base.adb("install", "-r", args.test_apk)
        base.shell("pm", "clear", base.PACKAGE)
        base.configure(f"http://10.0.2.2:{args.site_port}")
        base.shell("am", "force-stop", base.PACKAGE)
        base.adb("logcat", "-c")
        selector = CLASS + ("#" + args.method if args.method else "")
        output = base.shell("am", "instrument", "-w", "-r", "-e", "class", selector,
                            "-e", "liveProxyUrl", f"http://10.0.2.2:{args.api_port}",
                            base.PACKAGE + ".test/androidx.test.runner.AndroidJUnitRunner")
        print(output, flush=True)
        print(base.adb("logcat", "-d", "-s", "System.out:I", "TestRunner:I", "*:S"), flush=True)
        names = base.shell("run-as", base.PACKAGE, "ls", "files/live-evidence", check=False).splitlines()
        for name in names:
            if name.endswith(".png"):
                result = subprocess.run(["adb", "exec-out", "run-as", base.PACKAGE, "cat", "files/live-evidence/" + name],
                                        check=True, capture_output=True)
                (shots / name).write_bytes(result.stdout)
        if ("FAILURES!!!" in output or "INSTRUMENTATION_FAILED" in output or "OK (" not in output
                or "INSTRUMENTATION_STATUS_CODE: -" in output):
            raise RuntimeError("Live instrumentation failed; see the product transcript above")
    finally:
        proxy.stop()
        base.dayhand_cli("key", "revoke", key["id"], "--yes")


if __name__ == "__main__":
    main()
