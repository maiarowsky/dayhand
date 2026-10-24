#!/usr/bin/env python3
"""End-to-end check of editing tool policies in Settings → Agents on an emulator against a local Dayhand backend.

`dayhand` creates two agent keys and gives each "ask" for complete_task. On the phone the row
"Key <name>: complete_task" says Ask; its page offers Allow, Ask and Deny with what each does, and
Deny is chosen: `dayhand policy` must then print deny for that key. The second key is revoked in
the terminal while the phone still lists it; choosing a rule for it must be refused in words.

Requirements as for e2e-local.py: a running emulator (adb), the debug APK, the local backend,
DAYHAND_URL / DAYHAND_API_KEY of the app user for the CLI (a cli key, so it may set policies).

  python3 android/scripts/e2e-tool-policy.py --apk app-debug.apk --shots DIR
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
adb, shell, log, find, find_scrolling, tap, screenshot, set_network = (
    base.adb, base.shell, base.log, base.find, base.find_scrolling, base.tap, base.screenshot, base.set_network,
)
PACKAGE = base.PACKAGE
TOOL = "complete_task"


def cli_json(*args):
    return json.loads(base.dayhand_cli(*args, "--json"))


def rule_on_server(key_id):
    """The rule `dayhand policy` prints for the key and TOOL, or None."""
    for policy in cli_json("policy")["policies"]:
        if policy["keyId"] == key_id and policy["tool"] == TOOL:
            return policy["rule"]
    return None


def new_agent_key(name):
    key = cli_json("key", "create", name, "--scope", "write", "--expires", "1y")
    base.dayhand_cli("policy", "set", key["id"], TOOL, "ask")
    log(f"agent key {name} ({key['id']}): {TOOL} → ask")
    return key


def open_agents():
    tap(find(desc="Settings"))
    tap(find_scrolling(text="Agents"))
    find(text="Pause agents", timeout=30)


def open_rule(key_name):
    """Opens the page of the key's rule for TOOL, still "ask"."""
    tap(find_scrolling(text=f"Key {key_name}: {TOOL}"))
    find(text="Tool policy")
    find(text=f"{key_name} asks first: you allow or deny each call of {TOOL} here.")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--apk", required=True)
    parser.add_argument("--server-url", default="http://10.0.2.2:3211", help="HTTP actions URL as the emulator sees it")
    parser.add_argument("--shots", help="directory for screenshots")
    args = parser.parse_args()
    stamp = time.strftime("%H%M%S")
    kept, revoked = new_agent_key(f"policy-{stamp}"), new_agent_key(f"gone-{stamp}")

    set_network(True)
    adb("install", "-r", args.apk)
    shell("pm", "clear", PACKAGE)
    base.configure(args.server_url)
    # A first start (keystore key, database) on a loaded emulator drops taps for a while.
    time.sleep(10)

    open_agents()
    find_scrolling(text=f"Key {kept['name']}: {TOOL}")
    log("Settings → Agents lists the rule")
    screenshot(args.shots, "e2e-policy-list.png")

    # Deny for the first key: the server has it, and `dayhand policy` says so.
    open_rule(kept["name"])
    find(text=f"The server refuses {TOOL} to {kept['name']}; reading stays allowed.")
    screenshot(args.shots, "e2e-policy-page.png")
    tap(find(text="Deny"))
    find(text="Rule saved. The agent meets it with its next call.", timeout=30)
    screenshot(args.shots, "e2e-policy-saved.png")
    deadline = time.time() + 30
    while rule_on_server(kept["id"]) != "deny":
        if time.time() > deadline:
            raise RuntimeError(f"dayhand policy never showed deny for {kept['name']}")
        time.sleep(2)
    log(f"dayhand policy: {kept['name']} {TOOL} → deny")
    print(base.dayhand_cli("policy"), flush=True)

    # The second key is revoked while the phone still lists it: the refusal is said in words.
    base.dayhand_cli("key", "revoke", revoked["id"], "--yes")
    log(f"revoked {revoked['name']} in the terminal")
    open_rule(revoked["name"])
    tap(find(text="Deny"))
    find(text="The server did not change the rule: this agent key was revoked or removed.", timeout=30)
    screenshot(args.shots, "e2e-policy-refused.png")
    log("the refusal is shown in words")
    log("E2E tool policy OK")


if __name__ == "__main__":
    try:
        main()
    except Exception as error:  # report and fail the run
        print(f"E2E FAILED: {error}", file=sys.stderr)
        sys.exit(1)
