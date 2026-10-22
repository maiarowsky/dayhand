#!/usr/bin/env python3
"""End-to-end check of reminders, the morning summary and Settings on an emulator.

The agent (helm CLI) adds a task with a time and the server summary time is moved to the same
minute; the phone gets both through sync, and with the app in the background Android fires the
alarms: a reminder and a morning summary appear. Then, in Settings: a default reminder is added
(it reaches the server), the plan is exported as Markdown through the system save dialog, and
after a reboot the alarms are armed again.

Time is sped up by using the next whole minute (at least 90 s away) instead of a real 05:00.

Requirements as for e2e-offline.py: a running emulator (adb), the debug APK, the local backend,
HELM_URL and HELM_API_KEY for the CLI of the app user (the app is paired with a code), and
backend/.env.local from `npm run backend:start` for `npx convex run`.

  python3 android/scripts/e2e-reminders.py --apk app-debug.apk --shots DIR
"""
import argparse
import datetime
import importlib.util
import json
import os
import subprocess
import time
from zoneinfo import ZoneInfo

_spec = importlib.util.spec_from_file_location("e2e_offline", os.path.join(os.path.dirname(__file__), "e2e-offline.py"))
base = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(base)
adb, shell, log, find, tap, find_scrolling, configure = (
    base.adb, base.shell, base.log, base.find, base.tap, base.find_scrolling, base.configure,
)
PACKAGE = base.PACKAGE
USER = "https://helm.local|me"
_ui_nodes = base.ui_nodes


def _ui_nodes_without_anr():
    """On a loaded host system apps raise "isn't responding" dialogs over Helm: answer Wait."""
    nodes = _ui_nodes()
    if any("isn't responding" in n.get("text", "") for n in nodes):
        wait = next(n for n in nodes if n.get("text") == "Wait")
        tap(wait)
        log("dismissed a system 'isn't responding' dialog")
        time.sleep(1)
        nodes = _ui_nodes()
    return nodes


base.ui_nodes = _ui_nodes_without_anr


def _type_slowly(value):
    # A loaded emulator drops characters from `input text`; short chunks with pauses keep them.
    for start in range(0, len(value), 8):
        shell("input", "text", value[start:start + 8].replace(" ", "%s"))
        time.sleep(0.4)


base.type_text = _type_slowly


def convex_run(function, args):
    out = subprocess.run(
        ["npx", "convex", "run", function, json.dumps(args)],
        cwd=base.BACKEND_DIR, check=True, capture_output=True, text=True,
    )
    return json.loads(out.stdout)


def find_exact(text, timeout=30):
    deadline = time.time() + timeout
    while time.time() < deadline:
        for node in base.ui_nodes():
            if node.get("text") == text:
                return node
        time.sleep(1)
    raise RuntimeError(f"no node with text {text!r}")


def helm_notifications():
    """Titles of Helm's notifications, from the notification service."""
    titles = []
    for record in shell("dumpsys", "notification", "--noredact").split("NotificationRecord(")[1:]:
        if f"pkg={PACKAGE}" not in record.split("\n", 1)[0]:
            continue
        for line in record.splitlines():
            line = line.strip()
            if line.startswith("android.title="):
                # e.g. android.title=String (Call the accountant)
                titles.append(line.split("=", 1)[1])
    return titles


def wait_for_notifications(expected, until):
    while time.time() < until:
        titles = helm_notifications()
        if all(any(e in t for t in titles) for e in expected):
            return titles
        time.sleep(2)
    raise RuntimeError(f"notifications {expected} not shown; Helm has {helm_notifications()}")


def allow_notifications():
    # The first start after `pm clear` can take long on a loaded emulator.
    for _ in range(3):
        tap(find(desc="Settings", timeout=120))
        try:
            button = find(text="Allow notifications", timeout=45)
            break
        except RuntimeError:
            log("Settings did not open, tapping again")
    tap(button)
    tap(find_exact("Allow"))
    find(text="Notifications are on.")
    log("notifications allowed through the system dialog")
    try:
        tap(find(text="Allow exact alarms", timeout=3))
        tap(find(text="Allow setting alarms and reminders", timeout=15))
        adb("shell", "input", "keyevent", "KEYCODE_BACK")
        find(text="Reminders ring on the minute.")
        log("exact alarms allowed in the system screen")
    except RuntimeError:
        shell("appops", "set", PACKAGE, "SCHEDULE_EXACT_ALARM", "allow")
        log("exact alarms allowed with appops (system screen not found)")
    tap(find(desc="Back"))


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--apk", required=True)
    parser.add_argument("--server-url", default="http://10.0.2.2:3211", help="HTTP actions URL as the emulator sees it")
    parser.add_argument("--shots")
    args = parser.parse_args()

    adb("install", "-r", "-t", args.apk)
    shell("pm", "clear", PACKAGE)
    # Pairing first: at first start without a server Helm opens Connect, not Today.
    configure(args.server_url)
    allow_notifications()

    zone = ZoneInfo(convex_run("ops:getSettings", {"userId": USER, "actor": "agent"})["timezone"])
    due = (datetime.datetime.now(zone) + datetime.timedelta(seconds=90)).replace(second=0, microsecond=0)
    due += datetime.timedelta(minutes=1)
    hhmm = due.strftime("%H:%M")
    convex_run("ops:updateSettings", {"userId": USER, "actor": "agent", "summaryTime": hhmm, "defaultReminderMinutes": [0]})
    title = f"Call the accountant {int(time.time())}"
    base.helm_cli("add", title, "--date", due.date().isoformat(), "--time", hhmm)
    tomorrow = (due + datetime.timedelta(days=1)).date().isoformat()
    base.helm_cli("add", f"Plan the week {int(time.time())}", "--date", tomorrow, "--time", "09:00")
    log(f"agent added '{title}' at {hhmm} and set the summary to {hhmm}")
    find(text=title, timeout=60)
    log("the phone has the task")

    shell("input", "keyevent", "KEYCODE_HOME")
    log(f"app in the background, waiting for {hhmm}")
    titles = wait_for_notifications([title, "Today:"], until=due.timestamp() + 90)
    log(f"notifications at {datetime.datetime.now(zone):%H:%M:%S}: {titles}")
    shell("cmd", "statusbar", "expand-notifications")
    time.sleep(3)
    base.screenshot(args.shots, "notifications-reminder-summary.png")
    shell("cmd", "statusbar", "collapse")

    shell("am", "start", "-n", f"{PACKAGE}/.MainActivity")
    tap(find(desc="Settings"))
    find(text=hhmm)
    log(f"Settings shows the summary time {hhmm} from the server")
    tap(find_scrolling(text="10 min before"))
    deadline = time.time() + 60
    while convex_run("ops:getSettings", {"userId": USER, "actor": "agent"})["defaultReminderMinutes"] != [0, 10]:
        if time.time() > deadline:
            raise RuntimeError("the new default reminder did not reach the server")
        time.sleep(3)
    log("default reminders [0, 10] reached the server through the outbox")

    shell("rm", "-f", "/sdcard/Download/helm-plan-*.md")
    tap(find_scrolling(text="Export Markdown"))
    tap(find_exact("Save") if _has_text("Save") else find_exact("SAVE"))
    find_scrolling(text="Saved helm-plan-")
    exported = shell("cat", "/sdcard/Download/helm-plan-*.md")
    if title not in exported or not exported.startswith("# Helm plan"):
        raise RuntimeError("the exported Markdown does not contain the plan")
    log("Markdown export saved through the system dialog and contains the task")
    base.screenshot(args.shots, "settings-export-saved.png")

    boot_id = shell("cat", "/proc/sys/kernel/random/boot_id").strip()
    adb("reboot")
    # Wait for the new boot: right after `adb reboot` the old one still answers.
    deadline = time.time() + 600
    while True:
        if time.time() > deadline:
            raise RuntimeError("the emulator did not come back after the reboot")
        time.sleep(5)
        if subprocess.run(["adb", "get-state"], capture_output=True, text=True).stdout.strip() != "device":
            continue
        if shell("cat", "/proc/sys/kernel/random/boot_id", check=False).strip() in ("", boot_id):
            continue
        if shell("getprop", "sys.boot_completed", check=False).strip() == "1":
            break
    # BOOT_COMPLETED reaches apps late on a loaded emulator.
    armed = []
    deadline = time.time() + 180
    while time.time() < deadline:
        armed = sorted({line.strip() for line in shell("dumpsys", "alarm").splitlines() if "dev.helm.planner.action" in line})
        if any("REMINDER" in a for a in armed) and any("SUMMARY" in a for a in armed):
            break
        time.sleep(5)
    else:
        raise RuntimeError(f"alarms not armed after reboot: {armed}")
    log(f"after reboot: {armed}")
    log("PASS")


def _has_text(text):
    time.sleep(2)
    return any(node.get("text") == text for node in base.ui_nodes())


if __name__ == "__main__":
    main()
