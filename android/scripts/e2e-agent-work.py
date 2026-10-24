#!/usr/bin/env python3
"""End-to-end check of the agent work in the task details on an emulator against a local Dayhand backend.

`dayhand` adds two tasks and a third that waits for both (`--depends-on`), with a blocked reason
and a plan, and completes the first; the agent claims the third through MCP. On the phone the
third task has the blocked mark on Today and on the board, and its details show the claim, the
blocked reason, what it waits for ("#12 ... (done)") and the plan. **End the claim** is
confirmed on the phone, and `dayhand show` must then print no claim.

Requirements as for e2e-board-details.py: a running emulator (adb), the debug APK, the local
backend, DAYHAND_URL / DAYHAND_API_KEY of the app user for the CLI and DAYHAND_AGENT_KEY, an agent
key of the same user (`"kind":"agent"`).

  python3 android/scripts/e2e-agent-work.py --apk app-debug.apk --shots DIR
"""
import argparse
import importlib.util
import json
import os
import sys
import time

sys.dont_write_bytecode = True
HERE = os.path.dirname(os.path.abspath(__file__))


def load(name, file):
    spec = importlib.util.spec_from_file_location(name, os.path.join(HERE, file))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


base = load("e2e_offline", "e2e-offline.py")
board = load("e2e_board_details", "e2e-board-details.py")
adb, shell, log, find, find_scrolling, tap, screenshot, set_network = (
    base.adb, base.shell, base.log, base.find, base.find_scrolling, base.tap, base.screenshot, base.set_network,
)
PACKAGE = base.PACKAGE
SYNC_TIMEOUT = 150
REASON = "the client has not answered"
PLAN = "Draft the report, then send it"


def cli_json(*args):
    return json.loads(base.dayhand_cli(*args, "--json"))


def cli_task(ref):
    return cli_json("show", str(ref))["task"]


def wait_cli(ref, check, what, timeout=90):
    deadline = time.time() + timeout
    while time.time() < deadline:
        task = cli_task(ref)
        if check(task):
            log(f"dayhand show {ref}: {what}")
            return task
        time.sleep(2)
    raise RuntimeError(f"dayhand show {ref} never showed: {what} (last: {task})")


def confirm(label, title):
    """Taps [label] in the dialog titled [title]: the last node with that exact text is the dialog's."""
    find(text=title)
    nodes = [n for n in base.ui_nodes() if n.get("text") == label]
    if not nodes:
        raise RuntimeError(f"no {label!r} in the dialog")
    tap(nodes[-1])


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--apk", required=True)
    parser.add_argument("--server-url", default="http://10.0.2.2:3211", help="HTTP actions URL as the emulator sees it")
    parser.add_argument("--shots", help="directory for screenshots")
    args = parser.parse_args()
    stamp = time.strftime("%H%M%S")
    invoice, vat, report = f"Invoice {stamp}", f"VAT {stamp}", f"Report {stamp}"

    set_network(True)
    adb("install", "-r", args.apk)
    shell("pm", "clear", PACKAGE)
    base.configure(args.server_url)
    # A first start (keystore key, database) on a loaded emulator drops taps for a while.
    time.sleep(10)

    first = cli_json("add", invoice, "--due", "today")
    second = cli_json("add", vat, "--due", "today")
    third = cli_json(
        "add", report, "--due", "today", "--depends-on", str(first["ref"]), "--depends-on", str(second["ref"]),
        "--blocked", REASON, "--plan", PLAN,
    )
    base.dayhand_cli("done", str(first["ref"]))
    board.mcp("claim_task", taskId=third["id"], minutes=60)
    log(f"#{third['ref']} {report} waits for #{first['ref']} (done) and #{second['ref']}, blocked, claimed by the agent")

    # Today and the board: the mark says why for screen readers.
    find(text=report, timeout=SYNC_TIMEOUT)
    mark = find(desc=f"Blocked: {REASON}", timeout=30)
    assert "Waiting for 1 task" in mark.get("content-desc", ""), mark.get("content-desc")
    log(f"Today: mark {mark.get('content-desc')!r}")
    screenshot(args.shots, "e2e-agent-today.png")
    tap(find(text="Board"))
    find(desc=f"Blocked: {REASON}")
    log("board: the card has the mark")
    screenshot(args.shots, "e2e-agent-board.png")
    tap(find(text="Today"))

    # Details: claim, blocked reason, what it waits for, plan.
    tap(find(text=report))
    find(text="agent: claude-code works until")
    find(text=f"Blocked: {REASON}")
    find_scrolling(text=f"#{first['ref']} {invoice} (done)")
    find_scrolling(text=f"#{second['ref']} {vat}")
    find_scrolling(text=PLAN)
    log("details: claim, blocked reason, both dependencies and the plan")
    screenshot(args.shots, "e2e-agent-details.png")

    # End the claim, after the confirmation.
    for _ in range(8):
        shell("input", "swipe", "540", "900", "540", "1800", "300")
    tap(find(text="End the claim"))
    confirm("End the claim", "End the claim of claude-code?")
    screenshot(args.shots, "e2e-agent-released.png")
    task = wait_cli(third["ref"], lambda t: "claimedBy" not in t and "claimExpiresAt" not in t, "no claim")
    assert task.get("blockedReason") == REASON and task.get("plan") == PLAN, task
    try:
        find(text="agent: claude-code works until", timeout=3)
        raise RuntimeError("the claim is still shown on the phone")
    except RuntimeError as error:
        if "still shown" in str(error):
            raise
    print(base.dayhand_cli("show", str(third["ref"])), flush=True)
    log("E2E agent work OK")


if __name__ == "__main__":
    try:
        main()
    except Exception as error:  # report and fail the run
        print(f"E2E FAILED: {error}", file=sys.stderr)
        sys.exit(1)
