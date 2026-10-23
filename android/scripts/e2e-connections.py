#!/usr/bin/env python3
"""End-to-end check of agent connections (OAuth, docs/oauth.md) on an emulator against a local backend.

A simulated Claude app (this script, over HTTP from the computer) asks for access; the owner
approves it in the Helm app on the emulator by typing the code from the sign-in page:

1. The app is paired (hlm pair) and Settings → Agent connections is empty.
2. Claude registers itself (DCR) and opens the authorization page; the page shows a code.
3. In the app: Approve a connection → the code → the consent screen (who, where it returns, what
   it may do) → Approve. The page continues with an authorization code for claude.ai.
4. Claude exchanges the code (PKCE) and adds a task through /mcp with its access token; the task
   shows on the phone and its history says "agent: <client name>".
5. A second request is refused in the app: the page sends Claude back with access_denied.
6. Disconnecting in the app stops the token at once (401 on /mcp).

Requirements as for e2e-pairing.py: a running emulator (adb), the debug APK, the local backend
(npm run backend:start), HELM_URL and HELM_API_KEY of the app user (`https://helm.local|me`).

  python3 android/scripts/e2e-connections.py --apk app-debug.apk --shots DIR
"""
import argparse
import base64
import hashlib
import importlib.util
import json
import os
import re
import secrets
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

_spec = importlib.util.spec_from_file_location("e2e_offline", os.path.join(os.path.dirname(__file__), "e2e-offline.py"))
base = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(base)
adb, shell, log, find, tap, find_button, find_scrolling = (
    base.adb, base.shell, base.log, base.find, base.tap, base.find_button, base.find_scrolling,
)
PACKAGE = base.PACKAGE
CALLBACK = "https://claude.ai/api/mcp/auth_callback"


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        return None


OPENER = urllib.request.build_opener(NoRedirect)


def http(method, url, body=None, headers=None):
    """(status, headers, text) without following redirects."""
    request = urllib.request.Request(url, data=body, method=method, headers=headers or {})
    try:
        with OPENER.open(request, timeout=20) as response:
            return response.status, response.headers, response.read().decode()
    except urllib.error.HTTPError as error:
        return error.code, error.headers, error.read().decode()


def form(url, fields):
    return http("POST", url, urllib.parse.urlencode(fields).encode(), {"Content-Type": "application/x-www-form-urlencoded"})


class ClaudeSimulator:
    """The steps the hosted Claude app takes, with the browser part done here."""

    def __init__(self, site, name):
        self.site = site
        status, _, text = http("POST", f"{site}/oauth/register",
                               json.dumps({"client_name": name, "redirect_uris": [CALLBACK]}).encode(),
                               {"Content-Type": "application/json"})
        assert status == 201, text
        self.client_id = json.loads(text)["client_id"]

    def open_page(self):
        self.verifier = base64.urlsafe_b64encode(secrets.token_bytes(32)).rstrip(b"=").decode()
        challenge = base64.urlsafe_b64encode(hashlib.sha256(self.verifier.encode()).digest()).rstrip(b"=").decode()
        query = urllib.parse.urlencode({
            "response_type": "code", "client_id": self.client_id, "redirect_uri": CALLBACK,
            "code_challenge": challenge, "code_challenge_method": "S256",
            "scope": "tasks:read tasks:write", "state": "e2e", "resource": f"{self.site}/mcp",
        })
        status, _, html = http("GET", f"{self.site}/oauth/authorize?{query}")
        assert status == 200, html
        self.handle = re.search(r'name="request" value="([^"]+)"', html).group(1)
        return re.search(r'<div class="code"[^>]*>([0-9A-Z-]+)</div>', html).group(1), html

    def come_back(self):
        status, headers, text = form(f"{self.site}/oauth/authorize/continue", {"request": self.handle})
        assert status == 303, f"{status} {text}"
        return dict(urllib.parse.parse_qsl(urllib.parse.urlparse(headers["Location"]).query))

    def exchange(self, code):
        status, _, text = form(f"{self.site}/oauth/token", {
            "grant_type": "authorization_code", "code": code, "code_verifier": self.verifier,
            "client_id": self.client_id, "redirect_uri": CALLBACK, "resource": f"{self.site}/mcp",
        })
        assert status == 200, text
        self.tokens = json.loads(text)
        return self.tokens

    def mcp(self, method, params=None):
        body = json.dumps({"jsonrpc": "2.0", "id": 1, "method": method, "params": params or {}}).encode()
        return http("POST", f"{self.site}/mcp", body, {
            "Content-Type": "application/json", "Accept": "application/json, text/event-stream",
            "Authorization": f"Bearer {self.tokens['access_token']}",
        })

    def tool(self, name, arguments=None):
        status, _, text = self.mcp("tools/call", {"name": name, "arguments": arguments or {}})
        assert status == 200, f"{status} {text}"
        return json.loads(text)["result"]["structuredContent"]


def open_connections():
    tap(find(desc="Settings"))
    tap(find_scrolling(text="Agent connections"))
    find(text="Approve a connection")


def type_approval_code(code):
    tap(find(text="Approve a connection"))
    tap(find(text="Code from the sign-in page"))
    time.sleep(1)
    base.type_text(code.lower().replace("-", " "))
    shell("input", "keyevent", "KEYCODE_BACK")
    time.sleep(1)
    tap(find_button("Continue"))


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--apk", required=True)
    parser.add_argument("--server-url", default="http://10.0.2.2:3211", help="HTTP actions URL as the emulator sees it")
    parser.add_argument("--site-url", default=os.environ.get("HELM_URL", "http://127.0.0.1:3211"), help="the same URL as this computer sees it")
    parser.add_argument("--shots", help="directory for screenshots")
    args = parser.parse_args()
    shot = lambda name: base.screenshot(args.shots, name)  # noqa: E731
    stamp = time.strftime("%H%M%S")
    client_name = f"Claude e2e {stamp}"
    title = f"E2E from Claude {stamp}"

    base.set_network(True)
    adb("install", "-r", args.apk)
    shell("pm", "clear", PACKAGE)
    shell("am", "start", "-n", f"{PACKAGE}/.MainActivity")
    find(text="Pairing code", timeout=120)
    base.configure(args.server_url, args.shots)

    # 1. Nothing connected yet.
    open_connections()
    find(text="No agent is connected")
    shot("01-connections-empty.png")
    log("Settings → Agent connections: empty")

    # 2. Claude asks; the page shows a code.
    claude = ClaudeSimulator(args.site_url, client_name)
    code, html = claude.open_page()
    if args.shots:
        with open(os.path.join(args.shots, "02-authorize-page.html"), "w") as f:
            f.write(html)
    log(f"Claude registered ({claude.client_id[:10]}…); the page shows code {code}")

    # 3. Approve on the phone.
    type_approval_code(code)
    find(text=f"{client_name} asks for access")
    find(text="Registered itself")
    find(text="Answer goes to claude.ai")
    shot("03-consent.png")
    tap(find_scrolling(text="Approve"))
    find(text="Approved.")
    shot("04-approved.png")
    log("approved on the phone")
    back = claude.come_back()
    assert back.get("state") == "e2e" and "code" in back and back.get("iss") == args.site_url, back
    tokens = claude.exchange(back["code"])
    assert tokens["scope"] == "tasks:read tasks:write", tokens
    log("the page continued to claude.ai with a code; Claude has its tokens")

    # 4. Claude works with the plan; the phone sees it.
    today = claude.tool("list_today")
    log(f"list_today through OAuth: {len(today['today'])} task(s) today")
    added = claude.tool("add_task", {"title": title, "dueDate": "today"})
    detail = claude.tool("get_task", {"taskId": added["id"]})
    assert detail["history"][0]["by"] == f"agent: {client_name}", detail["history"][0]
    tap(find(text="Agent connections"))  # the row under "Approved." goes back to the list
    find(text=client_name)
    shot("05-connected.png")
    for _ in range(2):  # the list → Settings → Today
        shell("input", "keyevent", "KEYCODE_BACK")
        time.sleep(1)
    find(text=title, timeout=60)
    shot("06-task-from-claude-on-phone.png")
    log(f"Claude's task is on the phone; history says {detail['history'][0]['by']!r}")

    # 5. A refusal.
    second = ClaudeSimulator(args.site_url, f"{client_name} (second)")
    code, _ = second.open_page()
    open_connections()
    type_approval_code(code)
    find(text="asks for access")
    tap(find_scrolling(text="Refuse"))
    find(text="Refused.")
    shot("07-refused.png")
    refused = second.come_back()
    assert refused.get("error") == "access_denied" and "code" not in refused, refused
    log("a refused request goes back with access_denied")

    # 6. Disconnect on the phone.
    tap(find(text="Agent connections"))
    tap(find(text=client_name))
    find(text=f"Disconnect {client_name}?")
    shot("08-disconnect-dialog.png")
    tap(find_button("Disconnect"))
    find(text="No agent is connected", timeout=30)
    status, headers, _ = claude.mcp("tools/list")
    assert status == 401, status
    log(f"disconnected on the phone: /mcp answers {status} ({headers.get('WWW-Authenticate')})")
    print("E2E PASSED")


if __name__ == "__main__":
    try:
        main()
    except Exception as error:  # report and fail the run
        print(f"E2E FAILED: {error}", file=sys.stderr)
        sys.exit(1)
