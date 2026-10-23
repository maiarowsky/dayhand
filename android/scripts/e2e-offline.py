#!/usr/bin/env python3
"""End-to-end offline check on an emulator against a local Helm backend.

Add a task, turn the network off, add another, kill the app, turn the network on, and check
on the server (through the helm CLI) that both tasks arrived without opening the app again.
A second round does the same with a force-stopped app, which Android lets run again only
after it is opened.

Requirements: a running emulator (adb), the debug APK, the local backend
(npm run backend:start) and, in the environment, HELM_URL and HELM_API_KEY for the CLI of the
app user (`https://helm.local|me`). The app is paired with a code from `helm pair`.

  python3 android/scripts/e2e-offline.py --apk app-debug.apk --shots DIR
"""
import argparse
import json
import os
import re
import subprocess
import sys
import time
import urllib.parse
import xml.etree.ElementTree as ET

PACKAGE = "io.github.maiarowsky.dayhand"
# The code's namespace, which differs from the application id.
ACTIVITY = f"{PACKAGE}/dev.helm.planner.MainActivity"
BACKEND_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "backend")


def adb(*args, check=True):
    return subprocess.run(["adb", *args], check=check, capture_output=True, text=True).stdout


def shell(*args, check=True):
    return adb("shell", *args, check=check)


def log(message):
    print(f"[{time.strftime('%H:%M:%S')}] {message}", flush=True)


def ui_nodes():
    shell("uiautomator", "dump", "/sdcard/helm-ui.xml")
    root = ET.fromstring(adb("exec-out", "cat", "/sdcard/helm-ui.xml"))
    return list(root.iter("node"))


def find(text=None, desc=None, timeout=15):
    """The first node whose text or content description contains the given string."""
    deadline = time.time() + timeout
    while time.time() < deadline:
        for node in ui_nodes():
            if text and text in node.get("text", ""):
                return node
            if desc and desc in node.get("content-desc", ""):
                return node
        time.sleep(1)
    raise RuntimeError(f"not on screen: text={text!r} desc={desc!r}")


def find_scrolling(text=None, desc=None, attempts=8):
    """Scrolls a long screen (Settings) down until the node is on screen."""
    for _ in range(attempts):
        try:
            return find(text=text, desc=desc, timeout=2)
        except RuntimeError:
            shell("input", "swipe", "540", "1800", "540", "900", "300")
    raise RuntimeError(f"not found after scrolling: text={text!r} desc={desc!r}")


def tap(node):
    x1, y1, x2, y2 = map(int, re.findall(r"\d+", node.get("bounds")))
    shell("input", "tap", str((x1 + x2) // 2), str((y1 + y2) // 2))


def type_text(value):
    # `input text` drops characters from long strings, so type in short chunks.
    for start in range(0, len(value), 40):
        shell("input", "text", value[start:start + 40].replace(" ", "%s"))


def helm_cli(*args):
    out = subprocess.run(["npx", "helm", *args], cwd=BACKEND_DIR, check=True, capture_output=True, text=True)
    return out.stdout


def server_titles():
    return {t["title"] for t in json.loads(helm_cli("list", "--done", "--json"))}


def wait_on_server(titles, timeout):
    deadline = time.time() + timeout
    while time.time() < deadline:
        if titles <= server_titles():
            return True
        time.sleep(3)
    return False


def set_network(on):
    shell("cmd", "connectivity", "airplane-mode", "disable" if on else "enable")
    log(f"network {'on' if on else 'off (airplane mode)'}")
    time.sleep(3)


def screenshot(directory, name):
    if not directory:
        return
    with open(os.path.join(directory, name), "wb") as f:
        f.write(subprocess.run(["adb", "exec-out", "screencap", "-p"], check=True, capture_output=True).stdout)


def add_task(title):
    tap(find(desc="Add task"))
    find(text="What needs doing?")
    type_text(title)
    tap(find_button("Add"))
    find(text=title)
    log(f"added in the app: {title}")


def find_button(label):
    for node in ui_nodes():
        if node.get("text") == label:
            return node
    raise RuntimeError(f"button {label!r} not found")


def app_pid():
    return shell("pidof", PACKAGE, check=False).strip()


def pairing_code():
    """A fresh one-time code from the CLI (POST /devices/pairing-code)."""
    return json.loads(helm_cli("pair", "--json"))["code"]


def open_connect(server_url):
    """Opens Connect through a pairing link that carries only the server address."""
    link = "helm://pair?url=" + urllib.parse.quote(server_url, safe="")
    shell("am", "start", "-a", "android.intent.action.VIEW", "-d", f"'{link}'", PACKAGE)
    # A cold start right after installing can take a while on a loaded emulator.
    find(text="Pairing code", timeout=60)


def configure(server_url, shots=None):
    """Pairs the app: the address from a link, the code typed by hand, then Connect."""
    open_connect(server_url)
    tap(find(text="Pairing code"))
    time.sleep(1)
    type_text(pairing_code().lower().replace("-", ""))
    shell("input", "keyevent", "KEYCODE_BACK")
    time.sleep(1)
    screenshot(shots, "connect-filled.png")
    tap(find_button("Connect"))
    find(desc="Add task", timeout=30)
    log(f"paired with {server_url}")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--apk", required=True)
    parser.add_argument("--server-url", default="http://10.0.2.2:3211", help="HTTP actions URL as the emulator sees it")
    parser.add_argument("--shots", help="directory for screenshots")
    args = parser.parse_args()
    stamp = time.strftime("%H%M%S")
    online, offline, stopped = f"E2E online {stamp}", f"E2E offline {stamp}", f"E2E force-stopped {stamp}"

    set_network(True)
    adb("install", "-r", args.apk)
    shell("pm", "clear", PACKAGE)
    configure(args.server_url)

    add_task(online)
    if not wait_on_server({online}, 60):
        raise RuntimeError("the online task did not reach the server")
    log("server has the online task")

    set_network(False)
    find(text="Offline")
    add_task(offline)
    screenshot(args.shots, "e2e-offline-queued.png")
    time.sleep(5)
    assert offline not in server_titles(), "offline task reached the server while offline"
    log("server does not have the offline task yet (as expected)")

    shell("input", "keyevent", "KEYCODE_HOME")
    time.sleep(2)
    shell("am", "kill", PACKAGE)
    time.sleep(2)
    assert app_pid() == "", "app process is still alive"
    log("app process killed")

    set_network(True)
    started = time.time()
    if not wait_on_server({online, offline}, 180):
        raise RuntimeError("the offline task did not reach the server after the network came back")
    log(f"server has both tasks {time.time() - started:.0f} s after the network came back, app not opened (pid now: {app_pid() or 'none'})")
    today = helm_cli("today")
    assert online in today and offline in today, today
    log("helm today lists both tasks:\n" + today)

    # Round 2: force-stop. Android cancels the app's jobs until it is opened again.
    shell("am", "start", "-n", ACTIVITY)
    find(text=online)
    set_network(False)
    add_task(stopped)
    shell("am", "force-stop", PACKAGE)
    log("app force-stopped with one change queued")
    set_network(True)
    time.sleep(20)
    log(f"after 20 s with network, force-stopped task on server: {stopped in server_titles()}")
    shell("am", "start", "-n", ACTIVITY)
    if not wait_on_server({stopped}, 120):
        raise RuntimeError("the force-stopped task did not reach the server after opening the app")
    log("server has the force-stopped task after the app was opened")
    screenshot(args.shots, "e2e-synced.png")
    print("E2E PASSED")


if __name__ == "__main__":
    try:
        main()
    except Exception as error:  # report and fail the run
        print(f"E2E FAILED: {error}", file=sys.stderr)
        sys.exit(1)
