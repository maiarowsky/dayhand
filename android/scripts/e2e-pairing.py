#!/usr/bin/env python3
"""End-to-end pairing check on an emulator against a local Helm backend.

1. First start: Helm opens Connect by itself; "Not now" goes on offline and a task is added
   on the phone before any server is known.
2. The CLI adds a task and prints a one-time code (`hlm pair`). A wrong code is refused with a
   readable message; the right one, typed by hand in lower case without dashes, pairs the phone.
3. Sync both ways: the CLI's task appears on the phone, the phone's earlier task on the server.
4. Offline: with airplane mode a task added on the phone waits; when the network is back it
   reaches the server.
5. Disconnect in Settings forgets the sign-in; the tasks stay on the phone.

Requirements as for e2e-offline.py: a running emulator (adb), the debug APK, the local backend
(npm run backend:start), HELM_URL and HELM_API_KEY (or HLM_*) of the app user (`https://helm.local|me`)
and the built hlm CLI (cli/: npm ci --ignore-scripts && npm run build).

  python3 android/scripts/e2e-pairing.py --apk app-debug.apk --shots DIR
"""
import argparse
import importlib.util
import json
import os
import subprocess
import sys
import time

_spec = importlib.util.spec_from_file_location("e2e_offline", os.path.join(os.path.dirname(__file__), "e2e-offline.py"))
base = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(base)
adb, shell, log, find, tap, find_button, find_scrolling = (
    base.adb, base.shell, base.log, base.find, base.tap, base.find_button, base.find_scrolling,
)
PACKAGE = base.PACKAGE
ACTIVITY = base.ACTIVITY
HLM = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "cli", "dist", "bin", "hlm.js")


def hlm(*args):
    # hlm reads HLM_URL and HLM_API_KEY; the other scripts' HELM_* work too.
    env = {
        **os.environ,
        "HLM_URL": os.environ.get("HLM_URL", os.environ.get("HELM_URL", "")),
        "HLM_API_KEY": os.environ.get("HLM_API_KEY", os.environ.get("HELM_API_KEY", "")),
    }
    out = subprocess.run(["node", HLM, *args], check=True, capture_output=True, text=True, env=env)
    return out.stdout


def server_titles():
    return {t["title"] for t in json.loads(hlm("list", "--done", "--json"))["result"]}


def wait_on_server(titles, timeout):
    deadline = time.time() + timeout
    while time.time() < deadline:
        if titles <= server_titles():
            return True
        time.sleep(3)
    return False


def type_code(code):
    tap(find(text="Pairing code"))
    time.sleep(1)
    # Select what is in the field and replace it.
    shell("input", "keycombination", "113", "29")
    shell("input", "keyevent", "KEYCODE_DEL")
    base.type_text(code)
    shell("input", "keyevent", "KEYCODE_BACK")
    time.sleep(1)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--apk", required=True)
    parser.add_argument("--server-url", default="http://10.0.2.2:3211", help="HTTP actions URL as the emulator sees it")
    parser.add_argument("--shots", help="directory for screenshots")
    args = parser.parse_args()
    shot = lambda name: base.screenshot(args.shots, name)  # noqa: E731
    stamp = time.strftime("%H%M%S")
    before, from_cli, offline = f"E2E before pairing {stamp}", f"E2E from CLI {stamp}", f"E2E offline {stamp}"

    base.set_network(True)
    adb("install", "-r", args.apk)
    shell("pm", "clear", PACKAGE)
    shell("am", "start", "-n", ACTIVITY)

    # 1. First start: Connect comes first; a public build has no built-in server address.
    find(text="Pairing code", timeout=120)
    find(text="Server address")
    shot("01-first-start-connect.png")
    tap(find(text="Not now"))
    base.add_task(before)
    find(text="Not connected to a server")
    shot("02-offline-before-pairing.png")
    log("first start: Connect shown, skipped, task added without a server")

    # 2. A task from the CLI, a wrong code, then the right one.
    hlm("add", from_cli)
    log(f"CLI added: {from_cli}")
    base.open_connect(args.server_url)
    type_code("e6m8fe02xsnt")
    tap(find_button("Connect"))
    find(text="This code is wrong")
    shot("03-wrong-code.png")
    log("a wrong code is refused with a readable message")
    pairing = json.loads(hlm("pair", "--json"))
    log(f"hlm pair: {pairing['code']}, link {pairing['link']}")
    type_code(pairing["code"].lower().replace("-", ""))
    shot("04-code-typed.png")
    tap(find_button("Connect"))

    # 3. Both ways: the CLI's task on the phone, the phone's task on the server.
    find(text=from_cli, timeout=60)
    log("the CLI's task arrived on the phone")
    if not wait_on_server({before}, 60):
        raise RuntimeError("the task added before pairing did not reach the server")
    log("the task added before pairing reached the server")
    shot("05-synced-after-pairing.png")
    devices = json.loads(hlm("device", "list", "--json"))["devices"]
    log("hlm device list: " + ", ".join(f"{d['name']} ({d['id']})" for d in devices))

    # 4. Offline and back.
    base.set_network(False)
    # The status line is the first row of Today: scroll up, since a long list keeps its place when it appears.
    shell("input", "swipe", "540", "600", "540", "1600", "300")
    find(text="Offline")
    base.add_task(offline)
    shot("06-offline-queued.png")
    time.sleep(5)
    assert offline not in server_titles(), "offline task reached the server while offline"
    log("server does not have the offline task yet (as expected)")
    base.set_network(True)
    started = time.time()
    if not wait_on_server({offline}, 120):
        raise RuntimeError("the offline task did not reach the server after the network came back")
    log(f"server has the offline task {time.time() - started:.0f} s after the network came back")
    today = hlm("today")
    assert from_cli in today and before in today and offline in today, today
    log("hlm today lists all three tasks:\n" + today)

    # 5. Settings: connected, then disconnect.
    tap(find(desc="Settings"))
    find_scrolling(text="Connected to 10.0.2.2")
    shot("07-settings-connected.png")
    tap(find_scrolling(text="Disconnect"))
    find(text="hlm revoke")
    shot("08-disconnect-dialog.png")
    tap(find_button("Disconnect"))
    find_scrolling(text="This phone is not connected")
    tap(find(desc="Back"))
    find(text=offline)
    shot("09-after-disconnect.png")
    log("disconnected: sign-in forgotten, tasks kept")
    print("E2E PASSED")


if __name__ == "__main__":
    try:
        main()
    except Exception as error:  # report and fail the run
        print(f"E2E FAILED: {error}", file=sys.stderr)
        sys.exit(1)
