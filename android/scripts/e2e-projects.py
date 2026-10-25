#!/usr/bin/env python3
"""One Android Projects end-to-end run, with light/dark screenshots, against a local backend.

Create a project and its task on the phone without a server, switch List / Board, then pair.
The built CLI's `call list_projects --json` must see the project, and list_all the assignment.
(The dedicated `dayhand project list` command belongs to T5, not the Android change.)
Requires ANDROID_SERIAL naming the task's own emulator, DAYHAND_URL/API_KEY and the built CLI.
"""
import argparse
import importlib.util
import json
import os
from pathlib import Path
import sys
import time
import urllib.parse

_spec = importlib.util.spec_from_file_location("e2e_offline", Path(__file__).with_name("e2e-offline.py"))
base = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(base)


def project_list():
    return json.loads(base.dayhand_cli("call", "list_projects", "--json"))["result"]


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--apk", required=True)
    parser.add_argument("--shots", required=True)
    parser.add_argument("--server-url", required=True, help="Local HTTP actions URL as the emulator sees it")
    args = parser.parse_args()
    assert os.environ.get("ANDROID_SERIAL", "").startswith("emulator-"), "Set ANDROID_SERIAL to your own emulator"
    assert urllib.parse.urlsplit(base.env("URL")).hostname in {"localhost", "127.0.0.1"}, "Local backend only"
    Path(args.shots).mkdir(parents=True, exist_ok=True)
    project = "Bakery Site"
    title = "Photograph the bakery"
    assert not any(p["name"] == project for p in project_list()), "Use a fresh task-local backend user"
    base.adb("install", "-r", args.apk)
    base.shell("pm", "clear", base.PACKAGE)
    base.shell("cmd", "uimode", "night", "no")
    base.shell("am", "start", "-W", "-n", base.ACTIVITY)
    base.tap(base.find(text="Start with an empty plan", timeout=120))
    base.tap(base.find_button("Projects"))
    base.tap(base.find(desc="New project"))
    base.tap(base.find(text="Name"))
    base.type_text(project)
    base.shell("input", "keyevent", "KEYCODE_BACK")
    base.tap(base.find_button("Amber"))
    base.tap(base.find_button("Save"))
    base.tap(base.find(text=project))
    base.add_task(title)
    base.find(text=title)
    base.tap(base.find_button("Board"))
    base.find(text=title)
    base.tap(base.find_button("List"))
    base.find(text=title)
    base.screenshot(args.shots, "project-light.png")
    base.shell("cmd", "uimode", "night", "yes")
    time.sleep(2)
    base.screenshot(args.shots, "project-dark.png")
    base.tap(base.find(desc="Back"))
    base.find(text=project)
    base.screenshot(args.shots, "projects-dark.png")
    base.shell("cmd", "uimode", "night", "no")
    time.sleep(2)
    base.screenshot(args.shots, "projects-light.png")
    assert not any(p["name"] == project for p in project_list()), "Unpaired data must stay on the phone"
    base.configure(args.server_url)
    deadline = time.time() + 90
    while time.time() < deadline:
        projects = project_list()
        tasks = json.loads(base.dayhand_cli("list", "--json"))["result"]
        p = next((p for p in projects if p["name"] == project), None)
        t = next((t for t in tasks if t["title"] == title), None)
        if p and t and t.get("projectId") == p["id"]:
            assert p["color"] == "amber"
            assert p["counts"]["open"] == 1
            print(json.dumps({"project": p["name"], "projectId": p["id"], "task": t["title"],
                              "taskProjectId": t["projectId"], "open": p["counts"]["open"]}, ensure_ascii=False))
            print("E2E PROJECTS PASSED: phone offline creation -> ordered outbox -> real backend -> dayhand call list_projects --json")
            return
        time.sleep(2)
    raise RuntimeError("The phone's project and task assignment did not reach the local backend")


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print(f"E2E PROJECTS FAILED: {error}", file=sys.stderr)
        sys.exit(1)
