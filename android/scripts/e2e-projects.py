#!/usr/bin/env python3
"""One Projects feature run against a real local backend, with light/dark screenshots.

Unpaired/offline project management must be refused. Pair, create a project online, add its
task offline, then check the confirmed assignment through the existing CLI. No distribution.
Requires ANDROID_SERIAL for the task-owned emulator, DAYHAND_URL/API_KEY and the built CLI.
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


def create_project(name):
    base.tap(base.find(desc="New project"))
    base.tap(base.find(text="Name"))
    base.type_text(name)
    base.shell("input", "keyevent", "KEYCODE_BACK")
    base.tap(base.find_button("Amber"))
    base.tap(base.find_button("Save"))


def dismiss_project_form():
    # OK can restore the field's IME. One Back can hide only that keyboard, not the sheet.
    # Confirm the project-list header is the active window instead of assuming dismissal.
    for _ in range(4):
        if any(node.get("content-desc") == "Set order" for node in base.ui_nodes()):
            return
        base.shell("input", "keyevent", "KEYCODE_BACK")
        time.sleep(0.3)
    raise RuntimeError("Project form/IME did not close after refusing the command")


def refused_project(name):
    create_project(name)
    base.find(text="Requires a connection to the server")
    base.tap(base.find_button("OK"))
    dismiss_project_form()
    assert not any(p["name"] == name for p in project_list()), "A refused project reached the server"
    base.log(f"project management refused and form closed: {name}")


def record_result(args, confirmed, title):
    deadline = time.time() + 90
    while time.time() < deadline:
        tasks = json.loads(base.dayhand_cli("list", "--json"))["result"]
        task = next((t for t in tasks if t["title"] == title), None)
        if task and task.get("projectId") == confirmed["id"]:
            projects = project_list()
            assert not any(p["name"] in {"Unpaired project", "Offline project"} for p in projects)
            saved = next(p for p in projects if p["id"] == confirmed["id"])
            assert saved["color"] == "amber" and saved["counts"]["open"] == 1
            base.screenshot(args.shots, "project-light.png")
            base.shell("cmd", "uimode", "night", "yes")
            time.sleep(2)
            base.screenshot(args.shots, "project-dark.png")
            base.tap(base.find(desc="Back"))
            base.find(text=saved["name"])
            base.screenshot(args.shots, "projects-dark.png")
            base.shell("cmd", "uimode", "night", "no")
            time.sleep(2)
            base.screenshot(args.shots, "projects-light.png")
            print(json.dumps({"project": saved["name"], "projectId": saved["id"], "task": task["title"],
                              "taskProjectId": task["projectId"], "open": saved["counts"]["open"]}, ensure_ascii=False))
            print("E2E PROJECTS PASSED: unpaired/offline management refused; online project -> offline task -> confirmed CLI assignment")
            return
        time.sleep(2)
    raise RuntimeError("The offline task did not reach its confirmed server project")


def run(args):
    assert os.environ.get("ANDROID_SERIAL", "").startswith("emulator-"), "Use your own emulator"
    assert urllib.parse.urlsplit(base.env("URL")).hostname in {"localhost", "127.0.0.1"}, "Local backend only"
    Path(args.shots).mkdir(parents=True, exist_ok=True)
    project, title = "Bakery Site", "Photograph the bakery"
    assert not any(p["name"] == project for p in project_list()), "Use a fresh task-local backend user"
    base.adb("install", "-r", args.apk)
    base.shell("pm", "clear", base.PACKAGE)
    base.shell("cmd", "uimode", "night", "no")
    base.shell("am", "start", "-W", "-n", base.ACTIVITY)
    base.tap(base.find(text="Start with an empty plan", timeout=120))
    base.tap(base.find_button("Projects"))
    refused_project("Unpaired project")
    base.configure(args.server_url)
    assert not any(p["name"] == "Unpaired project" for p in project_list()), "Unpaired creation was queued"
    base.tap(base.find_button("Projects"))
    create_project(project)
    base.tap(base.find(text=project))
    confirmed = next(p for p in project_list() if p["name"] == project)
    base.tap(base.find(desc="Back"))
    base.set_network(False)
    try:
        refused_project("Offline project")
        base.tap(base.find(text=project))
        base.add_task(title)
        assert title not in base.server_titles(), "Offline task reached the server"
        base.tap(base.find_button("Board"))
        base.find(text=title)
        base.tap(base.find_button("List"))
        base.find(text=title)
    finally:
        base.set_network(True)
    record_result(args, confirmed, title)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--apk", required=True)
    parser.add_argument("--shots", required=True)
    parser.add_argument("--server-url", required=True, help="Local HTTP actions URL as the emulator sees it")
    args = parser.parse_args()
    try:
        run(args)
    except Exception:
        try:
            base.screenshot(args.shots, "project-e2e-failure.png")
        except Exception as capture_error:
            print(f"Diagnostic PNG unavailable: {capture_error}", file=sys.stderr)
        raise


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print(f"E2E PROJECTS FAILED: {error}", file=sys.stderr)
        sys.exit(1)
