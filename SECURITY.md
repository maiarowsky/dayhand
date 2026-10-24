# Security policy

## Reporting a vulnerability

Please report security problems **privately**, never in a public issue, pull request or discussion:
open the repository's **Security** tab and choose **Report a vulnerability** (GitHub private
vulnerability reporting). Only the maintainers see the report.

Include what is affected (backend, MCP endpoint, `dayhand` CLI, Android or iOS app), how to reproduce
it, and the impact you expect. Do not include real API keys or other people's data; a key you
used for testing should be revoked.

You can expect an acknowledgement within 7 days and an assessment within 30 days. We will
agree with you on a disclosure date once a fix is available and credit you unless you prefer
otherwise.

## Supported versions

Fixes go into the latest release of the `dayhand` CLI and the current `main` branch of the backend
and apps. The Android app has no built-in server: everyone runs their own deployment (typed on
the app's Connect screen, or `-Pdayhand.serverUrl=…` when building the app), so please update yours
after a security release.

## Scope

In scope: authentication and API keys, phone pairing and app tokens, access to another user's
tasks, the MCP endpoint, and the `dayhand` CLI's handling of keys (keychain, `credentials.json`,
output that could leak a key). Problems in a Convex deployment's own configuration or in
third-party services are out of scope, but tell us if Dayhand's documentation leads people into them.
