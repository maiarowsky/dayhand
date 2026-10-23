#!/usr/bin/env python3
"""End-to-end check of Helm on this phone only, and of moving that plan to a server later.

1. First start: "On this phone only" comes first. "Try with sample data" fills Today, the
   calendar and the board; the banner's "Remove them" takes the sample plan away again.
2. Again from a fresh install: the sample plan and a task of one's own. A backup made with
   "Share a backup" holds the own task and no sample task, and the server's import reads it
   (dry run, --import-check).
3. Pairing with the local backend: the own task reaches the server through the outbox, the
   sample tasks do not, and they leave the phone.
4. Another server: after Disconnect a task is added; a code for another address asks before
   replacing the plan. Cancel keeps everything; "Replace and connect" empties the phone first,
   so the task never reaches the server. Reconnecting to the same server needs no question.

The second address of the same backend is the emulator's own 127.0.0.1, forwarded with
`adb reverse` (the script sets it up), so one local backend plays both servers.

Requirements as for e2e-offline.py: a running emulator, the debug APK, the local backend
(npm run backend:start), HELM_URL and HELM_API_KEY of the app user, here with scope full for
the import check.

  python3 android/scripts/e2e-local.py --apk app-debug.apk --shots DIR
"""
import argparse
import importlib.util
import json
import os
import re
import sys
import time
import urllib.request

_spec = importlib.util.spec_from_file_location("e2e_offline", os.path.join(os.path.dirname(__file__), "e2e-offline.py"))
base = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(base)
adb, shell, log, find, tap, find_button, find_scrolling = (
    base.adb, base.shell, base.log, base.find, base.tap, base.find_button, base.find_scrolling,
)
PACKAGE = base.PACKAGE
SAMPLE_TITLES = {"Plan the week", "Call the dentist", "Buy groceries", "Team stand-up", "Water the plants"}


def absent(text, timeout=3):
    try:
        find(text=text, timeout=timeout)
    except RuntimeError:
        return True
    return False


def server_titles():
    return {t["title"] for t in json.loads(base.helm_cli("list", "--done", "--json"))}


def type_code(code):
    tap(find(text="Pairing code"))
    time.sleep(1)
    shell("input", "keycombination", "113", "29")
    shell("input", "keyevent", "KEYCODE_DEL")
    base.type_text(code.lower().replace("-", ""))
    shell("input", "keyevent", "KEYCODE_BACK")
    time.sleep(1)


def add_below_sample(title):
    """Adds a task while the sample plan fills Today: the new task is below the screen's edge."""
    tap(find(desc="Add task"))
    find(text="What needs doing?")
    base.type_text(title)
    tap(find_button("Add"))
    find_scrolling(text=title)
    for _ in range(4):
        shell("input", "swipe", "540", "900", "540", "1800", "300")
    log(f"added in the app: {title}")


def to_the_morning(hour=7, attempts=12):
    """Scrolls the calendar's hours until `hour` is near the top: the sample plan's timed tasks are in the morning."""
    for _ in range(attempts):
        hours = {int(n.get("text")[:2]): n for n in base.ui_nodes() if re.fullmatch(r"\d\d:00", n.get("text", ""))}
        if hour in hours:
            y = int(re.findall(r"\d+", hours[hour].get("bounds"))[1])
            if y < 1100:
                return
            shell("input", "swipe", "540", str(y), "540", "800", "800")
        elif hours and min(hours) > hour:
            shell("input", "swipe", "540", "900", "540", "1300", "800")
        else:
            shell("input", "swipe", "540", "1500", "540", "1000", "800")
        time.sleep(1)


def calendar_shots(shot):
    tap(find(text="Calendar"))
    time.sleep(2)
    to_the_morning()
    shot("03-calendar-sample.png")
    tap(find(text="Day"))
    time.sleep(2)
    to_the_morning()
    shot("03b-calendar-day-sample.png")


def first_start():
    # Updating a running app makes newer Android restart it, and `pm clear` would kill that start halfway.
    shell("am", "force-stop", PACKAGE)
    adb("install", "-r", ARGS.apk)
    shell("pm", "clear", PACKAGE)
    time.sleep(2)
    shell("am", "start", "-S", "-W", "-n", base.ACTIVITY)
    find(text="Welcome to Helm", timeout=120)


def open_settings_page(row):
    tap(find(desc="Settings"))
    tap(find_scrolling(text=row))


def back():
    tap(find(desc="Back"))
    time.sleep(1)


def pull_backup():
    names = shell("run-as", PACKAGE, "ls", "cache/backup").split()
    name = sorted(names)[-1]
    content = adb("exec-out", "run-as", PACKAGE, "cat", f"cache/backup/{name}")
    if ARGS.backup_out:
        with open(ARGS.backup_out, "w") as f:
            f.write(content)
    return name, json.loads(content), content


def import_dry_run(content):
    url = os.environ.get("HELM_URL", "").rstrip("/") + "/api/v1/import?dryRun=true"
    request = urllib.request.Request(
        url,
        data=json.dumps({"content": content}).encode(),
        headers={"Authorization": f"Bearer {os.environ.get('HELM_API_KEY', '')}", "Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(request, timeout=30) as response:
        return json.loads(response.read())


def connect_with_code(server_url):
    base.open_connect(server_url)
    type_code(base.pairing_code())
    tap(find_button("Connect"))


def main():
    shot = lambda name: base.screenshot(ARGS.shots, name)  # noqa: E731
    stamp = time.strftime("%H%M%S")
    mine, after, again = f"E2E local {stamp}", f"E2E after disconnect {stamp}", f"E2E same server {stamp}"
    base.set_network(True)

    # 1. First start, the sample plan and its one button.
    first_start()
    shot("01-connect-first-start.png")
    tap(find(text="Try with sample data"))
    find(text="These are sample tasks")
    find(text="Plan the week")
    shot("02-today-sample.png")
    calendar_shots(shot)
    tap(find(text="Board"))
    time.sleep(2)
    shot("04-board-sample.png")
    tap(find(text="Today"))
    tap(find(text="Remove them"))
    find(text="Nothing planned for today")
    assert absent("These are sample tasks"), "the sample banner stayed"
    log("sample plan shown on Today, calendar and board, removed with one tap")

    # 2. A fresh install: the sample plan, a task of one's own and a backup.
    first_start()
    tap(find(text="Try with sample data"))
    find(text="These are sample tasks")
    add_below_sample(mine)
    open_settings_page("Backup")
    find(text="No backup made on this phone yet")
    tap(find(text="Share a backup"))
    time.sleep(3)
    shell("input", "keyevent", "KEYCODE_BACK")
    find(text="Saved helm-backup-")
    shot("05-settings-backup.png")
    name, backup, content = pull_backup()
    titles = {t["title"] for t in backup["tasks"]}
    assert backup["version"] == 1 and mine in titles, titles
    assert not titles & SAMPLE_TITLES, f"sample tasks in the backup: {titles & SAMPLE_TITLES}"
    log(f"backup {name}: {len(backup['tasks'])} task(s), version 1, no sample tasks")
    if ARGS.import_check:
        result = import_dry_run(content)
        log("server import, dry run: " + json.dumps({k: result.get(k) for k in ("dryRun", "total", "created", "failed", "warnings")}))
        assert result.get("failed") in ([], None), result
    back()
    shot("06-settings-main-local.png")
    tap(find_scrolling(text="Server"))
    find(text="On this phone only")
    shot("07-settings-server-local.png")
    back()
    back()

    # 3. Pairing: the own task goes to the server, the sample plan stays behind and goes.
    before = server_titles()
    connect_with_code(ARGS.server_url)
    find(desc="Add task", timeout=60)
    deadline = time.time() + 90
    while mine not in server_titles():
        if time.time() > deadline:
            raise RuntimeError("the task made on this phone only did not reach the server")
        time.sleep(3)
    leaked = (server_titles() - before) & SAMPLE_TITLES
    assert not leaked, f"sample tasks reached the server: {leaked}"
    find(text=mine)
    assert absent("These are sample tasks") and absent("Plan the week"), "sample tasks stayed after pairing"
    shot("08-today-after-pairing.png")
    log("paired: the own task is on the server, no sample task is, and the phone has none left")

    # 4. Another server: asked first; Cancel keeps the plan; Replace empties the phone first.
    adb("reverse", "tcp:" + str(ARGS.convex_port), "tcp:" + str(ARGS.convex_port))
    adb("reverse", "tcp:" + str(ARGS.site_port), "tcp:" + str(ARGS.site_port))
    other = f"http://127.0.0.1:{ARGS.site_port}"
    open_settings_page("Server")
    tap(find_scrolling(text="Disconnect"))
    tap(find_button("Disconnect"))
    find_scrolling(text="On this phone only")
    back()
    back()
    base.add_task(after)
    connect_with_code(other)
    find(text="Replace the plan on this phone?")
    shot("09-replace-dialog.png")
    tap(find_button("Cancel"))
    back()
    find(text=after)
    log("another server: asked before replacing; Cancel kept the plan")
    connect_with_code(other)
    find(text="Replace the plan on this phone?")
    tap(find_button("Replace and connect"))
    find(desc="Add task", timeout=60)
    find(text=mine, timeout=60)
    time.sleep(15)
    assert after not in server_titles(), "a change for the old server reached the new one"
    assert absent(after), "the old plan stayed on the phone"
    log("replaced: the phone shows the new server's plan; the old server's waiting task was not sent")

    # Reconnecting to the server whose plan is on the phone needs no question and sends what waited.
    open_settings_page("Server")
    tap(find_scrolling(text="Disconnect"))
    tap(find_button("Disconnect"))
    back()
    back()
    base.add_task(again)
    connect_with_code(other)
    find(desc="Add task", timeout=60)
    deadline = time.time() + 90
    while again not in server_titles():
        if time.time() > deadline:
            raise RuntimeError("a change waiting for the same server did not reach it")
        time.sleep(3)
    log("same server again: no question, the waiting task reached it")
    print("E2E PASSED")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--apk", required=True)
    parser.add_argument("--server-url", default="http://10.0.2.2:3211", help="HTTP actions URL as the emulator sees it")
    parser.add_argument("--site-port", type=int, default=3211, help="the backend's HTTP actions port (HELM_SITE_PORT)")
    parser.add_argument("--convex-port", type=int, default=3210, help="the backend's Convex port (HELM_PORT)")
    parser.add_argument("--shots", help="directory for screenshots")
    parser.add_argument("--backup-out", help="where to save the backup pulled from the phone")
    parser.add_argument("--import-check", action="store_true", help="dry-run the backup through POST /api/v1/import")
    ARGS = parser.parse_args()
    try:
        main()
    except Exception as error:  # report and fail the run
        print(f"E2E FAILED: {error}", file=sys.stderr)
        sys.exit(1)
