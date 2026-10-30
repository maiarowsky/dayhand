# Dayhand for Herdr

A [Herdr](https://herdr.dev) plugin that connects the agents in your Herdr panes to your Dayhand plan:

- **Give an agent a task.** The action `dayhand.assign` opens a popup with Today; type a task number
  and the plugin remembers that task for the focused agent pane. The task gets a note saying which
  agent and pane have it.
- **Keep the task in step with the agent.** When Herdr reports that the agent's state changed
  (`pane.agent_status_changed`), the plugin writes it into the task:

  | Agent state | What the task gets |
  |---|---|
  | working | status doing (`dayhand start`) |
  | blocked | a note: the agent is waiting for you in pane … ; optionally an approval request |
  | done | a note: the agent finished, check its work |
  | idle, unknown | nothing |

  Only a change is written, not the same state twice. A note is added only when it differs from
  the last note for the task, so an agent that asks you again and again adds one "waiting" note;
  a new approval request goes out only when the last one is no longer pending. The task is never
  marked done: that needs proof or your decision. When the pane closes, or the task is done,
  archived or in the trash, the plugin forgets the pane's task and writes nothing more to it.
- **Today in Herdr.** The action `dayhand.today` opens `dayhand ui` over the current pane; `q`
  closes it.

## Needs

- Herdr 0.9.1 or newer, on macOS or Linux.
- `dayhand` on the `PATH` of the Herdr server, signed in (`dayhand login`), and Node.js, which
  `dayhand` needs anyway.

## Install

```sh
herdr plugin install maiarowsky/dayhand/herdr
```

`herdr plugin install` shows the manifest and the commands before it installs. To try a local
checkout, link it instead: `herdr plugin link "$PWD/herdr"`.

## Keys

Bind the actions in Herdr's `config.toml`, then run `herdr server reload-config`:

```toml
[[keys.command]]
key = "prefix+t"
type = "plugin_action"
command = "dayhand.assign"
description = "give this agent a Dayhand task"

[[keys.command]]
key = "prefix+d"
type = "plugin_action"
command = "dayhand.today"
description = "Dayhand Today"
```

Pick keys that are free in your setup. Without keys, `herdr plugin action invoke dayhand.assign`
runs an action from a shell inside Herdr.

## Settings

By default the plugin runs `dayhand` with the key from `dayhand login`, so history shows its
changes as `cli`. To see them as `agent: herdr` instead, and to have approval requests, put a file
`.env` in the folder that `herdr plugin config-dir dayhand` prints:

```sh
dayhand key create herdr --scope write   # a key of kind agent, printed once
```

```sh
# <config dir>/.env
DAYHAND_API_KEY=<the key>
DAYHAND_HERDR_ASK=1
```

Keep the file readable only by you: `chmod 600 "$(herdr plugin config-dir dayhand)/.env"`.

| Line | Meaning |
|---|---|
| `DAYHAND_API_KEY`, `DAYHAND_URL`, `DAYHAND_PROFILE` | Passed to `dayhand`, as in [the command reference](../docs/cli.md#environment); `dayhand ui` gets only `DAYHAND_URL` and `DAYHAND_PROFILE` |
| `DAYHAND_HERDR_ASK=1` | When an agent with a task becomes blocked, also send an approval request (`dayhand ask`) so the phone tells you; it expires after 2 hours |

Only lines that start with `DAYHAND_` are read. Today in Herdr (`dayhand ui`) never uses
`DAYHAND_API_KEY`: it runs as you, with the key from `dayhand login`, so your changes there are
yours in the history and no agent policy holds them back. The approval request only tells you;
answering it does not answer the agent, which still waits in its pane.

## Files

The plugin keeps which pane has which task in `assignments.json` in its Herdr state folder. Errors
go to Herdr's plugin log: `herdr plugin log list --plugin dayhand`.

## Tests

`node --test herdr/dayhand-herdr.test.mjs` runs the plugin's script against a stand-in `dayhand`
and checks the commands it runs.
