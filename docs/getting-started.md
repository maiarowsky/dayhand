# Quick start

This page takes you from nothing to a running Dayhand on one computer: your own server, your first
tasks from the command line, the plan full screen in the terminal, the phone connected, and an AI
agent working on the plan with a key of its own. It takes about ten minutes, most of it the first
download.

You need [Node.js](https://nodejs.org) 22.12 or newer. On macOS and Linux, steps 2–6 use the
same local server and plan. On Windows, use `dayhand server deploy` in step 2 and keep that Convex
server for the whole walkthrough; the local server is for macOS and Linux only. The shell examples
use a POSIX shell (for example, Git Bash on Windows).

## 1. Install the command line

```sh
npm i -g dayhand
```

This puts `dayhand` and its short name `dh` on your PATH; `npm rm -g dayhand` removes them. With
Homebrew, `brew install maiarowsky/tap/dayhand` does the same. `dayhand --version` prints the version.
Before the first release, build it from source instead; every way to install, and the state of each:
[Install](install.md).

The `dayhand` package carries the server (the `backend/` folder of the repository), so there is nothing
else to get: no clone, nothing to build. (A clone of the repository still works, and wins when you run
`dayhand` from it.)

## 2. Start your own server

```sh
dayhand server start
```

The first run copies the packaged backend to your user data folder (once per `dayhand` version),
installs its dependencies from the lockfile, downloads the Convex local backend once (a pinned version
whose checksum is checked), deploys Dayhand to it, creates a key for `dayhand`, signs this computer
in with it and prints a pairing code for the phone. Data and keys stay in a private folder on this
computer; no account is needed. The server listens on `127.0.0.1` only and runs until you press Ctrl+C.
The same command starts it again later, with its data.

Leave it running and open a second terminal for the next steps. In that second
terminal, select the local server explicitly:

```sh
export DAYHAND_URL=http://127.0.0.1:3211
```

**On Windows**, run this instead of `dayhand server start` (you can also choose this from the start
on macOS or Linux):

```sh
dayhand server deploy
export DAYHAND_URL=https://<deployment>.convex.site
```

Setup opens your browser to sign in to your own Convex account, creates the server and signs
`dayhand` in. Replace `<deployment>` with the name in the HTTPS address it prints. The command
finishes; there is no local server process to leave running. Use this URL throughout the next steps.

`DAYHAND_URL` selects the server in this terminal even if an existing profile points elsewhere;
`dayhand whoami` checks the URL and sign-in. Set it again in any new terminal you use for this plan.

To see every setup step first without changing anything, add `--dry-run` to `server start` (or
`server deploy` on Windows). More about either backend: [Your own server](deploy.md).

## 3. Plan your day

```sh
dayhand add "Call the accountant" --due "today 14:00" -l admin
dayhand add "Send the invoice to Anna" --due fri
dayhand
dayhand done 1
```

`dayhand` alone shows Today: the task you are working on now, what is overdue, what is due today and
what you finished today. Tasks are referred to by their number (`1` or `#1`). Dates are English phrases
read in your time zone: `fri 2pm`, `tomorrow 9am`, `in 3 days`, `23 oct`, `2026-11-02`. Try one without
changing anything:

```sh
dayhand when "next mon 9am"
```

The time zone comes from the server's settings, `Europe/London` until you change it:

```sh
dayhand settings set timezone=Europe/Warsaw
```

A few more things to try: `dayhand list` (every open task), `dayhand board`, `dayhand now 2 --note "waiting
for the bank statement"` (the task you are on, and where you stopped), `dayhand show 2` (a task with its
history), `dayhand rm 2` and `dayhand restore 2`. Every command and flag: [command reference](cli.md).

## 4. See it full screen

```sh
dayhand ui
```

Today, the board, the week, the trash and agents in the terminal, with keys like vim (`j`/`k`, `h`/`l`), `a` to
add a task with a date phrase, `?` for every key and `q` to quit: [Terminal](terminal.md).

## 5. Connect your phone

The Android app works without any server (**On this phone only**). To share the plan between the phone,
this computer and your agents, connect it to your server. No APK is published yet, so for now you
build the app yourself ([Install](install.md#android)).

A phone cannot reach a server that listens on `127.0.0.1`, and release builds of the app talk to their
server over HTTPS only.

**For the local server from step 2**, keep the same server and plan. First stop the running server
with **Ctrl+C** in its terminal. Follow the [Tailscale steps](deploy.md#phone-and-computer-tailscale)
to give both server ports HTTPS addresses inside your own [Tailscale](https://tailscale.com) network,
then restart it in that terminal:

```sh
dayhand server start --public-url https://<machine>.<tailnet>.ts.net
```

This reuses the same local data and keys; it does not create a new plan. In the second terminal,
select the HTTPS address for pairing and all the remaining commands:

```sh
export DAYHAND_URL=https://<machine>.<tailnet>.ts.net
dayhand whoami
```

The phone syncs while the computer is on and in the tailnet. **If you started on Convex in step 2**
(including on Windows), skip Tailscale and keep your `https://<deployment>.convex.site` URL: it is
already reachable from the phone.

**Optional: switch from local to Convex.** A new Convex deployment is a separate server with its own
empty plan, not a move of the local database. You can simply start there in step 2 instead. To carry
your local tasks over now, export while `DAYHAND_URL` still points at the local server, then deploy,
select the new address and import:

```sh
dayhand export --format json -o dayhand.json
dayhand server deploy
export DAYHAND_URL=https://<deployment>.convex.site
dayhand whoami
dayhand import dayhand.json
```

Replace `<deployment>` with the name setup prints. Deploy stores a key for that address but does not
overwrite an existing profile; setting `DAYHAND_URL` above is what points `dayhand` at the new server
for the import, pairing and agent setup below. The local plan is unchanged; no automatic migration
occurs. The exported file contains private plan data, so keep it out of shared folders. More:
[Convex setup](deploy.md#run-your-own-server-in-5-minutes).

Then, in the app: **Settings → Server → Connect to my server** (or **Connect to my server** on the first
start), and scan the QR code that this prints, or type the address and the code:

```sh
dayhand pair
```

The code works once, for 10 minutes. Tasks you added on the phone before are sent to the server.
`dayhand devices` lists paired phones and `dayhand revoke <deviceId>` signs one out. How pairing works:
[Phone pairing](pairing.md).

## 6. Let an agent work on the plan

Give every agent its own key. Its changes are then signed `agent: <name>`, and you can revoke it alone:

```sh
AGENT_KEY=$(dayhand key create claude --scope write --json | jq -r .key)
DAYHAND_API_KEY=$AGENT_KEY dayhand add "Draft the VAT reply" --due "today 16:00" --remind 30
dayhand log --by agent
```

The key is printed once; keep it where the agent reads it. `jq` extracts it from the JSON here. The
agent can use `dayhand` with that key, or the MCP endpoint of the same selected server. For Claude Code
in this terminal:

```sh
claude mcp add --transport http dayhand "$DAYHAND_URL/mcp" --header "Authorization: Bearer $AGENT_KEY"
```

The MCP address is `http://127.0.0.1:3211/mcp` before Tailscale, or
`https://<machine>.<tailnet>.ts.net/mcp` after it. On a Convex server (including the Windows route),
it is `https://<deployment>.convex.site/mcp`.

Then ask it what is on your list today. Acceptance criteria, claims, approvals on the phone, the switch
that pauses every agent and the rest: [Agents and you](agents.md).

## Next

- Keep the server: [backups, updates and costs](deploy.md).
- Use the apps: [Android](android.md), [macOS](macos-app.md), [Linux](linux.md).
- See your tasks in Google or Apple Calendar: [calendar feed](calendar.md).
- Something did not work: [FAQ and troubleshooting](faq.md).
