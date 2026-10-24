# Quick start

This page takes you from nothing to a running Dayhand on one computer: your own server, your first
tasks from the command line, the plan full screen in the terminal, the phone connected, and an AI
agent working on the plan with a key of its own. It takes about ten minutes, most of it the first
download.

You need macOS or Linux, [Node.js](https://nodejs.org) 22.12 or newer and git. On Windows, follow the
same steps but start the server with `dayhand server deploy` instead (step 2): the server that runs on
your computer is for macOS and Linux only.

## 1. Build the command line

No package is published yet, so build `dayhand` from the repository:

```sh
git clone https://github.com/maiarowsky/helm.git dayhand
cd dayhand/cli && npm ci --ignore-scripts && npm run build && npm link && cd ..
```

`npm link` puts `dayhand` and its short name `dh` on your PATH; `npm unlink -g dayhand` removes them.
`dayhand --version` prints the version. Other ways to install, and the state of each: [Install](install.md).

## 2. Start your own server

```sh
dayhand server start
```

The first run downloads the Convex local backend once (a pinned version whose checksum is checked),
deploys Dayhand to it, creates a key for `dayhand` and signs this computer in with it, and prints a
pairing code for the phone. Data and keys stay in a private folder on this computer; no account is
needed. The server listens on `127.0.0.1` only and runs until you press Ctrl+C. The same command starts
it again later, with its data.

Leave it running and open a second terminal in the same folder for the next steps.

To see every step first without changing anything, run `dayhand server start --dry-run`. Running the
server on your own Convex account instead, which gives it a public HTTPS address: [Your own server](deploy.md).

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

Today, the board, the week and the trash in the terminal, with keys like vim (`j`/`k`, `h`/`l`), `a` to
add a task with a date phrase, `?` for every key and `q` to quit: [Terminal](terminal.md).

## 5. Connect your phone

The Android app works without any server (**On this phone only**). To share the plan between the phone,
this computer and your agents, connect it to your server. No APK is published yet, so for now you
build the app yourself ([Install](install.md#android)).

A phone cannot reach a server that listens on `127.0.0.1`, and release builds of the app talk to their
server over HTTPS only. Pick one:

- **Keep the server on this computer** and give it an HTTPS address inside your own
  [Tailscale](https://tailscale.com) network: `tailscale serve`, then
  `dayhand server start --public-url https://<machine>.<tailnet>.ts.net`
  ([the steps](deploy.md#phone-and-computer-tailscale)). The phone syncs while the computer is on.
- **Move the server to your own free Convex account** with `dayhand server deploy`. It gets a public
  HTTPS address that the phone reaches from anywhere, and the Claude apps can connect to it too
  ([the steps](deploy.md#run-your-own-server-in-5-minutes)).

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
agent can use `dayhand` with that key, or the MCP endpoint of your server. For Claude Code:

```sh
claude mcp add --transport http dayhand http://127.0.0.1:3211/mcp --header "Authorization: Bearer $AGENT_KEY"
```

Then ask it what is on your list today. Acceptance criteria, claims, approvals on the phone, the switch
that pauses every agent and the rest: [Agents and you](agents.md).

## Next

- Keep the server: [backups, updates and costs](deploy.md).
- Use the apps: [Android](android.md), [macOS](macos-app.md), [Linux](linux.md).
- See your tasks in Google or Apple Calendar: [calendar feed](calendar.md).
- Something did not work: [FAQ and troubleshooting](faq.md).
