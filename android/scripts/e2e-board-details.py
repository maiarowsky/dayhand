#!/usr/bin/env python3
"""End-to-end check of the board and task details on an emulator against a local Helm backend.

The agent adds a task through MCP; in the app it is dragged to "In progress" on the board and
moved to "Done" from the card's menu (no dragging). In the details screen the title, a label,
a link and a time are changed. Offline, the task goes to the trash; the app is killed and the
change must reach the server once the network is back. The task is then restored from the
Trash screen. Finally an agent edit must show up in the task's history marked "Agent". Every
step is checked on the server through MCP, as the agent sees it.

Requirements as for e2e-offline.py: a running emulator (adb), the debug APK, the local backend,
an app token in a file and HELM_URL / HELM_API_KEY of the same user in the environment.

  python3 android/scripts/e2e-board-details.py --apk app-debug.apk --token-file token.txt --shots DIR
"""
import argparse
import importlib.util
import json
import os
import re
import sys
import time
import urllib.request

sys.dont_write_bytecode = True
HERE = os.path.dirname(os.path.abspath(__file__))
_spec = importlib.util.spec_from_file_location("e2e_offline", os.path.join(HERE, "e2e-offline.py"))
base = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(base)
adb, shell, log, find, tap, screenshot, set_network = (
    base.adb, base.shell, base.log, base.find, base.tap, base.screenshot, base.set_network,
)


def type_text(value):
    # A loaded emulator drops characters from `input text`; short chunks keep up.
    for start in range(0, len(value), 10):
        shell("input", "text", value[start:start + 10].replace(" ", "%s"))
PACKAGE = base.PACKAGE
SYNC_TIMEOUT = 150


def mcp(tool, **arguments):
    """Calls one MCP tool as the agent and returns its JSON result."""
    url = os.environ["HELM_URL"].rstrip("/") + "/mcp"
    body = json.dumps({"jsonrpc": "2.0", "id": 1, "method": "tools/call", "params": {"name": tool, "arguments": arguments}})
    request = urllib.request.Request(url, data=body.encode(), method="POST", headers={
        "Content-Type": "application/json",
        "Accept": "application/json, text/event-stream",
        "Authorization": f"Bearer {os.environ['HELM_API_KEY']}",
    })
    with urllib.request.urlopen(request, timeout=15) as response:
        message = json.loads(response.read())
    result = message["result"]
    if result.get("isError"):
        raise RuntimeError(f"{tool} failed: {result['content'][0]['text']}")
    return json.loads(result["content"][0]["text"])


def server_task(task_id):
    return mcp("get_task", taskId=task_id)["task"]


def wait_server(task_id, check, what, timeout=90):
    deadline = time.time() + timeout
    while time.time() < deadline:
        task = server_task(task_id)
        if check(task):
            log(f"server: {what}")
            return task
        time.sleep(2)
    raise RuntimeError(f"server never got: {what} (last: {task})")


def in_trash(task_id):
    return any(t["id"] == task_id for t in mcp("list_trash"))


def center(node):
    x1, y1, x2, y2 = map(int, re.findall(r"\d+", node.get("bounds")))
    return (x1 + x2) // 2, (y1 + y2) // 2


def edit_text():
    for node in base.ui_nodes():
        if node.get("class") == "android.widget.EditText":
            return node
    raise RuntimeError("no text field on screen")


def button(label):
    """A clickable node whose own text is exactly [label] (dialog buttons)."""
    deadline = time.time() + 10
    while time.time() < deadline:
        for node in base.ui_nodes():
            if node.get("text") == label:
                return node
        time.sleep(1)
    raise RuntimeError(f"button {label!r} not found")


def find_scrolling(text=None, desc=None, up=True):
    """Scrolls the screen until a node with [text] or [desc] is visible."""
    for _ in range(8):
        try:
            return find(text=text, desc=desc, timeout=2)
        except RuntimeError:
            if up:
                shell("input", "swipe", "540", "1700", "540", "900", "400")
            else:
                shell("input", "swipe", "540", "900", "540", "1700", "400")
    raise RuntimeError(f"not found after scrolling: text={text!r} desc={desc!r}")


def configure(url, token):
    """As in e2e-offline.py, but retries the first tap, which a slow emulator can drop right after start."""
    for _ in range(8):
        tap(find(desc="Settings", timeout=60))
        try:
            base.find_scrolling(text="Backend address")
            break
        except RuntimeError:
            continue
    tap(base.find_scrolling(text="Backend address"))
    time.sleep(1)
    type_text(url)
    # Close the keyboard first: it moves the long Settings screen under the next tap.
    shell("input", "keyevent", "KEYCODE_BACK")
    time.sleep(1)
    tap(base.find_scrolling(text="App token"))
    time.sleep(1)
    type_text(token)
    shell("input", "keyevent", "KEYCODE_BACK")
    time.sleep(1)
    tap(base.find_scrolling(text="Save"))
    find(text="Saved")
    tap(find(desc="Back"))
    log("backend address and token saved in Settings")
    time.sleep(10)
    if any("refused the token" in n.get("text", "") for n in base.ui_nodes()):
        raise RuntimeError("the server refused the token (typed wrong?)")


def fully_visible(text):
    """The card with [text], scrolled clear of the bottom bar and the add button."""
    for _ in range(6):
        node = find(text=text)
        x1, y1, x2, y2 = map(int, re.findall(r"\d+", node.get("bounds")))
        if y2 - y1 >= 40 and y2 < 1700:
            return node
        shell("input", "swipe", "540", "1500", "540", "1000", "400")
        time.sleep(1)
    raise RuntimeError(f"cannot scroll {text!r} into view")


def drag(source, target):
    (x1, y1), (x2, y2) = center(source), center(target)
    # Long-press first, then move: what a finger does on the board.
    shell("input", "draganddrop", str(x1), str(y1), str(x2), str(y2), "1500")
    time.sleep(2)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--apk", required=True)
    parser.add_argument("--token-file", required=True)
    parser.add_argument("--url", default="http://10.0.2.2:3210")
    parser.add_argument("--shots", help="directory for screenshots")
    args = parser.parse_args()
    token = open(args.token_file).read().strip()
    stamp = time.strftime("%H%M%S")
    title = f"E2E board {stamp}"
    renamed = f"E2E renamed {stamp}"

    set_network(True)
    adb("install", "-r", args.apk)
    shell("pm", "clear", PACKAGE)
    # A start racing the clear can be dropped; start again until the app is on screen.
    for attempt in range(3):
        shell("am", "start", "-n", f"{PACKAGE}/.MainActivity")
        try:
            find(desc="Settings", timeout=40)
            break
        except RuntimeError:
            if attempt == 2:
                raise
    # A first start (keystore key, database) on a loaded emulator drops taps for a while.
    time.sleep(20)
    configure(args.url, token)

    task = mcp("add_task", title=title, dueDate="today", labels=["Helm"])
    task_id = task["id"]
    log(f"agent added {title} ({task_id})")
    # Without the native Convex client the app polls every 30 s, so allow for one round.
    find(text=title, timeout=SYNC_TIMEOUT)

    # Board: drag to In progress, then Done from the menu.
    tap(find(text="Board"))
    for attempt in (1, 2):
        drag(fully_visible(title), find(text="In progress"))
        try:
            wait_server(task_id, lambda t: t["status"] == "doing", f"dragged to In progress (attempt {attempt})", timeout=40)
            break
        except RuntimeError:
            if attempt == 2:
                raise
            log("drag not registered (slow emulator?), dragging once more")
    tap(find(text="In progress"))
    screenshot(args.shots, "e2e-board-doing.png")
    tap(find(desc=f"More actions: {title}"))
    tap(find(text="Move to Done"))
    wait_server(task_id, lambda t: t["status"] == "done", "moved to Done from the menu")
    tap(find(text="Done ("))

    # Details: rename, label, link, time.
    tap(find(text=title))
    find(text="Labels and projects")
    tap(find(text=title))
    edit_text()
    # The dialog opens focused with the cursor after the title.
    for _ in range(len(title)):
        shell("input", "keyevent", "KEYCODE_DEL")
    type_text(renamed)
    tap(button("Save"))
    wait_server(task_id, lambda t: t["title"] == renamed, f"title is {renamed!r}")

    tap(find(text="Add label"))
    tap(edit_text())
    type_text("Family")
    tap(button("Add"))
    wait_server(task_id, lambda t: t["labels"] == ["Helm", "Family"], "labels Helm, Family")

    tap(find(text="Add a time"))
    tap(button("OK"))
    wait_server(task_id, lambda t: t.get("dueTime") == "09:00", "time 09:00")
    # The first task with a time asks for the notification permission (Android 13+).
    find(text="Allow Helm to send you notifications?")
    tap(button("Allow"))
    log("notification permission asked for the first timed task, allowed")

    tap(find_scrolling(text="Add link"))
    tap(edit_text())
    type_text("https://example.com/plan")
    tap(button("Add"))
    wait_server(task_id, lambda t: [l["url"] for l in t["links"]] == ["https://example.com/plan"], "link added")
    screenshot(args.shots, "e2e-details.png")

    # Offline: trash, kill the app, network back; the server must get it without the app open.
    set_network(False)
    tap(find_scrolling(text="Move to trash"))
    find_scrolling(text="In the trash", up=False)
    time.sleep(3)
    assert not in_trash(task_id), "trashed on the server while offline"
    log("offline: task shows as trashed in the app, not on the server yet")
    screenshot(args.shots, "e2e-trash-offline.png")
    shell("input", "keyevent", "KEYCODE_HOME")
    shell("am", "kill", PACKAGE)
    set_network(True)
    deadline = time.time() + 180
    while not in_trash(task_id):
        if time.time() > deadline:
            raise RuntimeError("the trash change did not reach the server")
        time.sleep(3)
    log("server: task is in the trash (sent by WorkManager after the network came back)")

    # Restore from the Trash screen. Android brings back the screens open before the kill.
    shell("am", "start", "-n", f"{PACKAGE}/.MainActivity")
    find(text=renamed, timeout=60)
    log("after the kill the app reopened on the same task's details")
    shell("input", "keyevent", "KEYCODE_BACK")
    tap(find(text="Board"))
    tap(find(desc="Trash"))
    find(text=renamed)
    screenshot(args.shots, "e2e-trash-list.png")
    tap(find(desc=f"Restore: {renamed}"))
    deadline = time.time() + 90
    while in_trash(task_id):
        if time.time() > deadline:
            raise RuntimeError("the restore did not reach the server")
        time.sleep(2)
    log("server: task restored")

    # An agent edit shows in the history as the agent's.
    mcp("update_task", taskId=task_id, note="Written by the agent")
    shell("input", "keyevent", "KEYCODE_BACK")
    tap(find(text="Done ("))
    tap(find(text=renamed))
    # The note sits above the fold; it arrives with the next poll.
    find(text="Written by the agent", timeout=SYNC_TIMEOUT)
    find_scrolling(text="Note: none → Written by the agent")
    find(text="Agent")
    find(text="Restored")
    screenshot(args.shots, "e2e-history.png")
    history = mcp("get_task", taskId=task_id)["history"]
    actors = {(h["actor"], h["action"]) for h in history}
    assert ("app", "setStatus") in actors and ("app", "delete") in actors and ("agent", "update") in actors, actors
    log(f"history on the server: {sorted(actors)}")
    print("E2E PASSED")


if __name__ == "__main__":
    try:
        main()
    except Exception as error:  # report and fail the run
        print(f"E2E FAILED: {error}", file=sys.stderr)
        sys.exit(1)
