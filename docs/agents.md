# Agents and you

Dayhand lets AI agents work on your plan next to you: read Today, add and plan tasks, claim one,
finish it with proof. You stay in charge: agents ask before risky steps, one switch stops all of
them, a policy per agent says which tools it may use, and work nobody asked for waits in an inbox.
This page shows how to set that up and use it. The reasons behind each feature are in
[how agent work is designed](agent-work.md), the exact tools in [MCP endpoint](mcp.md).

**What Dayhand can and cannot do.** Dayhand records every change an agent makes in your plan and
enforces your controls on its own tools. It cannot see or stop what an agent does outside Dayhand: an
approval you give is a record the agent is expected to respect, not a lock on its other tools.

## Give each agent its own key

Every change is signed with who made it: `app` (you in an app), `cli` (you with `dayhand`) or
`agent: <name>`. An agent gets a key of its own, so its changes show its name and you can revoke it
alone:

```sh
dayhand key create claude --scope write --json     # prints the key once, in "key"
dayhand key list
dayhand key revoke <keyId>
```

| Scope | The key may |
|---|---|
| `read` (the default of `dayhand key create`) | read the plan: Today, lists, tasks, history, the activity log |
| `write` | also change tasks and settings |
| `full` | also manage keys, webhooks, devices, connections and the calendar feed; `dayhand key create` never makes one |

A key made with `dayhand key create` expires after 90 days unless `--expires` says otherwise (`12w`, `1y`,
a date, `never`), never outlives the key that made it, and stops when that key is revoked. Each key may
make 120 reads and 60 changes a minute. More: [keys and actors](mcp.md#keys-and-actors).

## Connect the agent

**Claude Code and other MCP clients** that can send a header connect to your server's `/mcp` address
with the key:

```sh
claude mcp add --transport http dayhand http://127.0.0.1:3211/mcp --header "Authorization: Bearer $AGENT_KEY"
```

On a server on your Convex account, the address is `https://<deployment>.convex.site/mcp`. Any other
client works the same way: the address and an `Authorization: Bearer <key>` header.

**The Claude apps** (claude.ai, Claude Desktop, Claude for Android and iOS) add Dayhand as a custom
connector and sign in with OAuth instead of a key. You approve each connection on your phone, by the code
the sign-in page shows. This needs a server with a public HTTPS address (`dayhand server deploy`):
[Claude apps (OAuth)](oauth.md).

**Agents that run shell commands** can use `dayhand` with the key in `DAYHAND_API_KEY` (and the server in
`DAYHAND_URL`). With `--json` it prints exactly what the MCP tools return, and its exit codes say what to
do next ([for scripts](terminal.md#for-scripts)). Two helpers:

- A ready **Agent Skill** teaches an agent the commands and the rules:
  `mkdir -p ~/.claude/skills && cp -R docs/skills/dayhand ~/.claude/skills/` from the checkout.
- `dayhand prime` prints Today and a short guide as plain text, for a session-start hook. In Claude Code's
  settings: `{"hooks":{"SessionStart":[{"hooks":[{"type":"command","command":"dayhand prime"}]}]}}`.

## What the agent sees

Over MCP your server offers 32 tools, three resources with two resource templates, and four prompts
([the full list](mcp.md#tools)):

- **Tools** for everything the apps do: add, update, complete, reschedule, archive, delete and restore
  tasks; Today, search, the board and the trash; the activity log, claims, approval requests, proposals
  and the health report. Tools that only you may use (deciding approvals, pausing agents, policies,
  accepting proposals) are left out of an agent's list.
- **Resources**: `dayhand://today`, `dayhand://activity` and `dayhand://guide`, a short text on how an agent
  should work with Dayhand; the templates `dayhand://activity{?since}` and `dayhand://tasks/{ref}` read the
  log from a cursor and one task with its history.
- **Prompts**: `plan_day`, `weekly_review`, `triage_overdue` and `plan_health`, each of which asks the agent
  to go through the plan with you and ask before changing anything.

Every change takes `dryRun: true` to check it without saving, and a `clientId` so that a retry is never
applied twice ([dry runs](mcp.md#dry-runs)).

## One task, start to finish

Tasks can say what done means (acceptance criteria) and how the work will go (a plan). An agent claims a
task so other agents leave it alone, ticks the criteria and finishes with proof:

```sh
TASK_ID=$(dayhand add "Send the Q4 invoices" --due "today 17:00" --accept "One PDF per client" --plan "Export, then check the totals" --json | jq -er .id)
DAYHAND_API_KEY=$AGENT_KEY dayhand claim "$TASK_ID" --minutes 30
DAYHAND_API_KEY=$AGENT_KEY dayhand criteria "$TASK_ID" --met all
DAYHAND_API_KEY=$AGENT_KEY dayhand done "$TASK_ID" --summary "3 PDFs sent" --check totals=pass
dayhand log --by agent
```

- **Acceptance criteria and proof.** When a task has criteria, an agent can complete it only when every
  criterion is met and the proof has a summary; otherwise the call fails (`precondition_failed`, exit 6)
  and nothing changes. The proof (a summary, links, checks that passed or failed) stays on the task and
  shows in the phone's task details. You complete tasks as always: the rule binds agents, not you.
- **Claims are leases.** `dayhand claim` holds a task for a while (120 minutes unless `--minutes` says 1 to
  1440). While it lasts, another agent's changes to the task fail with `conflict` (exit 6), so it picks
  another. The holder extends it with `dayhand renew` and ends it with `dayhand release --note "<where I
  stopped>"`, which becomes the task's resume note. A claim that runs out ends by itself. Your own
  changes always go through, and the phone can take a task over at once.
- **Order.** `--depends-on` names tasks that must be done first and `--blocked` says why a task cannot go
  on. `dayhand list --ready` lists what can be worked on now.
- **Catching up.** `dayhand log` lists every change in order with who made it. An agent keeps the
  `nextCursor` and passes it as `--since` next time to read only what changed meanwhile.

## Approvals: agents ask, you decide on the phone

Before a risky or irreversible step, an agent asks with two to four options and what each one leads to:

```sh
dayhand ask Deploy 2.4 to production --option "Deploy now: live in 10 minutes" --option "Wait: nothing changes until Monday" --expires 2h
dayhand approval <id> --wait 600 --json
```

The request shows on your phone (Settings → Agents, the health card above Today, and a notification) and
in `dayhand approvals`. You pick an option, optionally with a note; from a terminal with a `cli` key:
`dayhand approvals decide <id> o2 --note "after the weekend"`. The agent reads the outcome with
`dayhand approval <id>` (or the MCP tool `get_approval`), or hears it through the webhook
`approval.decided`. A request expires after a day unless it says otherwise (a week at most); an expired
one cannot be decided, and the agent has to ask again.

With the app closed, the phone looks for new requests every 15 minutes, so give a realistic expiry.
Dayhand records who asked, what was offered and what you chose, in the task's history and the activity
log. Whether the agent then does what you chose is up to the agent.

## Pausing every agent

One switch stops every agent's changes at once, for every key and every OAuth connection, while they can
still read and tell you what they see:

```sh
dayhand agents pause --reason "on holiday"
dayhand agents
dayhand agents resume
```

The same switch is **Pause agents** under Settings → Agents on the phone. While it is on, every change by an
agent fails with `agents_paused` (exit 7), dry runs and approval requests included. Your own changes from
the apps and `cli` keys are never refused, and no key needs to be replaced afterwards. An agent cannot
lift the pause itself.

## Tool policies per agent key

A policy says, for one agent key, whether a tool that changes the plan is allowed (the default), needs your
approval each time, or is refused. `"*"` covers every such tool without a rule of its own:

```sh
dayhand policy set <keyId> delete_task deny
dayhand policy set <keyId> complete_task ask
dayhand policy set <keyId> "*" ask
dayhand policy
```

- `deny` refuses the call (`forbidden`, exit 7). Reading tools have no policy.
- `ask` refuses the call with `approval_required` and the id of an approval request Dayhand made for
  exactly that call (an hour to decide). Once you choose **Allow once**, the agent repeats the call with
  the approval (`--approval <id>` in `dayhand`, `approvalId` over MCP) and it runs, once.
- The key's id comes from `dayhand key list`. The phone shows the policies but does not change them yet.
- Policies apply to API keys. An OAuth connection, such as the Claude app, follows the pause and its
  scopes (read, or read and change), but has no per-tool rules: give an agent that needs them a key.

## The proposal inbox

Work an agent or an integration came up with, rather than work you asked for, can be added as a
**proposal**. It waits in your inbox, out of Today, the board, lists, the calendar and reminders, until
you decide:

```sh
dayhand add "Checkout times out" --propose --source "sentry:CHECKOUT-42 https://sentry.example.com/issues/42"
dayhand proposals
dayhand proposals accept 42
dayhand proposals merge 43 --into 12
dayhand proposals reject 44 --reason "not now"
```

- **Accept**: it joins the plan as it is. **Merge**: an open task gets its note, links and labels, and the
  proposal goes to the trash. **Reject**: it goes to the trash, restorable for 30 days.
- **One source, one task.** A task with a `--source` (a kind and a reference, such as an alert id) is made
  once: adding it again returns the same task, also after it was rejected or merged. A repeating alert
  does not fill your inbox.
- `--requested-by` says who asked for it; `--return-to <webhookId>` names a webhook that hears, with the
  task's proof, when it is completed, rejected or merged ([webhooks](webhooks.md#events)).

The phone shows proposals under Settings → Agents and on the health card.

## The health report

```sh
dayhand health
```

One read that says what needs a look: whether agents are paused, overdue tasks, tasks due today, tasks
in progress and who works on them, claims that ran out, blocked tasks with every reason, tasks waiting for
an approval, proposals, tasks done today with and without proof, and the oldest open task. The phone
shows the same in one line above Today; agents get it as the tool and prompt `plan_health`.

## What a well-behaved agent does

1. Back from a pause: read the activity log from its cursor, and the health report.
2. Pick work with `dayhand list --ready` (or `list_all` with `ready: true`).
3. Claim the task; on `conflict`, pick another.
4. Write criteria and a plan if the task has none; renew the claim while working.
5. Before a risky step: ask, and wait for the answer.
6. Tick the criteria, then complete with proof.
7. Stopping early: release with a note; stuck: set a blocked reason.
8. Work nobody asked for: add it as a proposal with a source.
9. On `agents_paused` stop changing things and wait; on `forbidden` do not retry; on `approval_required`
   wait for that request, then repeat the call with it.

The same steps are in the `dayhand://guide` resource, in `dayhand prime` and in the Agent Skill.

## Planned

- **Backlog.md import and export** are planned and not in `main` yet. Dayhand's criteria, plan and
  dependencies follow the same ideas as [Backlog.md](https://github.com/MrLesk/Backlog.md), a Markdown
  task board for people and agents, so a plan can later move between the two.
- Phase guides as MCP resources.
- Changing tool policies on the phone.
