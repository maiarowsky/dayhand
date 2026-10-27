# Agent work

Since backend 0.10.0 (CLI 0.11.0, Android 0.9.1), Dayhand has four features for AI agents that
work on the plan next to the person who owns it: an activity log, acceptance criteria with proof
of completion, dependencies with a blocked reason, and time-boxed claims. Backend 0.11.0 (CLI
0.12.0, Android 0.10.0) adds four that keep the owner in charge of those agents: approval
requests decided on the phone, a switch that pauses every agent with a policy per tool, an inbox
for proposed work, and a plan health report. Backend 0.12.0 (CLI 0.14.0) adds guides for each
phase of a task, an agent brief for the start of a session, and Backlog.md import and export.
This page explains the problem each one solves, the
decisions behind it and the public designs it follows. The tool
reference is in [mcp.md](mcp.md), the REST routes in [api.md](api.md) and the commands in
[cli.md](cli.md).

## The problem

Dayhand started as one person's day plan with an agent as a helper: the agent read Today, moved a
task, left a resume note. Once several agents work on the same plan, for hours and with pauses,
four things go wrong:

1. **Catching up is expensive.** An agent that comes back after a pause has to read the whole plan
   again to see what changed, which costs time and context, and it still cannot tell who changed
   what.
2. **"Done" is a feeling.** An agent marks a task done when it believes it is done. The person
   cannot see what done meant or what shows that it happened.
3. **Order is invisible.** Some tasks can only start after others, and some are stuck on something
   outside the plan. Without that in the data, an agent picks work it cannot finish.
4. **Two agents take the same task.** Nothing says "someone is on this", so two agents start the
   same work, or one overwrites the other's changes.

One rule shaped every answer: **no new statuses.** The board has three columns, `todo`, `doing`
and `done`, and the Android app, the CLI, the calendar feed, the webhooks and integrations rely on
exactly these three. Everything below is fields next to the status, so a client that does not
know them keeps working, and every addition is a minor version of the API (new tools, new
fields, new error codes; see [mcp.md](mcp.md#versions)).

## 1. The activity log

`list_events` (and the resource `dayhand://activity`, `dayhand log` in the CLI, `GET /api/v1/events`)
returns the user's task changes in the order they happened, each with who made it (`by`: `app`,
`cli` or `agent: <name>`) and the changed fields before and after. Every result carries a
`nextCursor`. An agent keeps it and passes it back as `since` next time: it then gets only the
changes made in between, without reading the plan. `by` and `taskId` narrow the log; `hasMore`
says another page is already waiting.

Decisions:

- **The data was already there.** Every change has written a history row since 0.1.0
  (`taskEvents`, signed with the actor). The log is a read of that table, not a second copy.
- **A position, not a time.** Times are not enough as a cursor: two changes can share a
  millisecond, and a change whose transaction started earlier can commit after a later one, so a
  reader that resumes "after 12:00:00.123" can miss it. Each task change therefore gets a
  position (`seq`) from a per-user counter that every task change reads and writes in its own
  transaction. Convex runs such conflicting mutations one after the other, so positions follow
  the commit order and a cursor never skips a change. The position starts from the change's time
  in microseconds, so a time can still be turned into a starting point (`since` also takes Unix
  milliseconds or an ISO 8601 time) and history from before 0.10.0 can be numbered into the same
  order by a migration (`migrations:backfillEventSeqs`, [deploy.md](deploy.md#upgrading-to-0100)).
- **Without `since`, the newest changes.** A new agent wants to start following the log from now,
  not from the first change ever made; `since: "0"` reads from the start.
- **Only task changes.** History also records account changes (API keys, webhooks, devices); they
  stay out of the log, which a key with scope `read` may read.
- **Bounded work per call.** A call looks at no more than a few thousand changes; when filters
  skip most of them, the cursor continues from where it stopped.

Public counterparts: an MCP [resource](https://modelcontextprotocol.io/specification/2025-06-18/server/resources)
with a [URI template](https://www.rfc-editor.org/rfc/rfc6570) (`dayhand://activity{?since}`) for
clients that read context without a tool call; the cursor-and-`hasMore` shape of MCP's own
[pagination](https://modelcontextprotocol.io/specification/2025-06-18/server/utilities/pagination);
the same events as the [webhooks](webhooks.md) ([Standard Webhooks](https://www.standardwebhooks.com/))
for clients that would rather be told than ask.

## 2. Acceptance criteria, plan and proof

A task may carry `acceptance`, a list of criteria `{ id, text, met }`, and a `plan`, free text on
how the work will be done. `complete_task` takes an optional `proof`: `{ summary, links, checks }`,
where each check is `{ name, result: "pass" | "fail", url }` (a test run, a CI job, a review). The
proof is kept on the task.

The rule: **when a task has acceptance criteria and an agent completes it, every criterion must be
met and the proof must have a summary**; otherwise the call fails with `precondition_failed` and
nothing changes. A person completing a task in the app or with a CLI key does it as before:
the rule binds agents, not the owner.

Decisions:

- **Criteria are data, with ids.** Like the checklist, criteria keep their ids (`a1`, `a2`, …) across
  edits, so an agent ticks `a2` without rewriting the others' text. They are separate from the
  checklist because they mean something else: the checklist is steps, the criteria are the test.
- **Agents tick criteria themselves**, with `update_task`. Dayhand does not judge whether a
  criterion is really met; it makes the claim explicit and leaves a record of who made it and
  with what proof, in the history and on the task.
- **A failing check does not block completion.** The rule asks for met criteria and a summary; a
  `fail` check is recorded as it is, so the person sees it.
- **`precondition_failed`, not `invalid_argument`.** The arguments are fine; the task's state does
  not allow the change yet. The same code already meant "the state is not what this change
  needs" for `If-Match` (RFC 9110 [412](https://www.rfc-editor.org/rfc/rfc9110#name-412-precondition-failed)).
- **A repeating task's next occurrence** keeps the criteria (unticked) and the plan, but not the
  proof.

Public counterpart: [Backlog.md](backlog-md.md), a Markdown task
board for people and AI agents, gives its tasks acceptance criteria and an implementation plan in
the same spirit. Dayhand's criteria are structured fields behind its own tools; file-format
interchange is a separate [import/export operation](backlog-md.md).

## 3. Dependencies and a blocked reason

`dependsOn` lists the tasks (ids, or numbers as `"#42"`) that must be done first; `blockedReason`
says why a task cannot go on. `list_all` takes `ready: true`: tasks that are **not done, not
blocked, and whose every dependency is done** (`ready: false` gives the rest).

Decisions:

- **Blocked is a reason, not a status.** A blocked task stays in `todo` or `doing`; the reason is
  what a person needs to read anyway.
- **No cycles.** A task cannot depend on itself, directly or through others; such a change is an
  `invalid_argument`.
- **A dependency in the trash, or purged, no longer holds a task back**: it is not part of the plan
  any more. Restoring it makes it count again. Ready is worked out when asked, never stored.
- **Ready does not look at claims.** An agent picking work calls `list_all` with `ready: true` and
  then `claim_task`; a `conflict` tells it to take the next one.

For the Android 0.11.0 display of plans, dependencies and blocked reasons, including the limits
of the phone's dependency lookup, see [Android screens](../android/README.md#screens).

Public counterpart: Backlog.md's `dependencies` field, a list of task ids a task waits for. A plan
moved between the two keeps the same meaning: wait until those tasks are done.

## 4. Time-boxed claims

`claim_task` claims a task for a while (120 minutes unless `minutes` says 1 to 1440). The task then
shows `claimedBy` (the API key or agent connection, and its name) and `claimExpiresAt`. While the
claim lasts, **another agent's claim and changes of that task fail with the new error code
`conflict`** (HTTP 409 on the REST API, exit code 6 in the CLI). `renew_claim` extends the claim
from now; `release_task` ends it, optionally with a checkpoint note saved as the resume note (where
the work stopped, the next step). Completing the task ends the claim too. After `claimExpiresAt`
anyone may claim the task again, without waiting for the holder.

**The owner wins.** The person's own changes from the app and the CLI always go through, claim or
not, and the app can take a task over at once (`app.release`, the same operation with the owner as
the actor). The phone's claim display and confirmation flow are described in
[Android screens](../android/README.md#screens).

Decisions:

- **A lease, not a lock.** A lock held by a crashed agent blocks the task until someone notices.
  A lease ends by itself; the holder has to renew it while it works. The expired claim stays on
  the task until it is released or claimed again, so the history shows who last worked on it.
- **The holder is the credential.** A claim belongs to one API key or one agent connection, not to
  a name: two keys with the same name are two holders. Give each agent its own key.
- **Other agents are refused, not only told.** A claim that other agents could ignore would protect
  nothing; their changes of the task fail with `conflict` and the message says who holds it until
  when. Changes that only touch the task on the side (another task becoming the now task) are not
  refused.
- **Renewing a claim you no longer hold is `precondition_failed`**; renewing after it expired works
  as long as nobody else claimed the task meanwhile.
- **Claims do not change the status.** Claiming does not move a task to `doing`; an agent that
  starts the work says so with `set_status`, as a person would.
- **Renewals are not webhook events.** Claiming and releasing are `task.updated`; a renewal only
  moves the expiry and would flood the receivers of an agent that renews every few minutes.

Public counterparts: a Kubernetes [Lease](https://kubernetes.io/docs/concepts/architecture/leases/)
names its holder (`holderIdentity`), its length (`leaseDurationSeconds`) and when it was renewed,
and anyone may take it over once it has run out; Amazon SQS's
[visibility timeout](https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/sqs-visibility-timeout.html)
hides a message from other consumers while one works on it, can be extended
(`ChangeMessageVisibility`) and gives the message back when it runs out. Dayhand's claim is the
same contract for a task, with the owner allowed to step in. The status code follows RFC 9110
[409 Conflict](https://www.rfc-editor.org/rfc/rfc9110#name-409-conflict).

## The second problem: who is in charge

The first four features let agents work together. Once they do, for hours and while the owner is
away from the desk, the owner needs four more things:

5. **A say before something risky.** An agent about to deploy, delete or pay should be able to
   ask, and the owner should be able to answer from the phone, without a terminal.
6. **A brake.** When an agent misbehaves, or the owner just wants quiet, one control has to stop
   every agent at once, and finer rules have to say which agent may use which tool.
7. **A door for work nobody asked for.** Alerts, issues and agents' own ideas should not land in
   Today as if the owner had planned them, and the same alert must not make ten tasks.
8. **One look at the state of things.** What is late, what is stuck, who is working on what, and
   what was finished without anything to show for it.

The same rule holds: no new statuses. Everything below is new tables, new fields of a task and
new tools; a client that knows none of them keeps working.

## 5. Approval requests

`request_approval` stores a request: what it is about (optionally a task), what the agent wants
to do (`action`, with `detail`), 2 to 4 `options`, each with the `consequence` of picking it,
whether the step is `reversible`, and how long the owner has (`expiresInMinutes`, a day unless
set, a week at most). The phone shows it under Settings → Agents (waiting for you), on the health
card above Today, and as a notification; the owner picks an option and may add a note. The agent reads
the outcome with `get_approval` (`pending`, `decided` or `expired`), or is told by the webhook
`approval.decided`. `dayhand ask` and `dayhand approval` do the same from a terminal, and a `cli`
key can decide with `dayhand approvals decide`.

**Dayhand records the decision; it does not carry it out and cannot stop an agent from acting
without one.** The agent, or the tooling around it, has to ask and then respect the answer. What
Dayhand guarantees is the record: who asked, what they offered, what the owner chose, when, in the
task's history and the activity log. The one place Dayhand does enforce a decision is its own
tools, through the tool policy `ask` (next section).

Decisions:

- **Options, not yes or no.** Real decisions often have a third way ("wait until Monday"). The
  agent offers the choices it can actually carry out and says what follows from each, so the owner
  decides without asking back. Option ids default to `o1`, `o2`, …, so an agent can branch on them.
- **Requests expire.** A question that waits forever is a decision by default. After `expiresAt`
  the request is `expired` and can no longer be decided; the agent has to ask again. Expiry sends
  no webhook: the agent knows the time.
- **The owner decides, nobody else.** `decide_approval` is one of the owner's tools: agents do
  not see it, and an agent that calls it gets `forbidden`. Deciding again the same way changes
  nothing; deciding differently is `precondition_failed`.
- **A request about a task is part of that task's story**: asking and deciding enter its history
  and the activity log (`approvalRequest`, `approvalDecide`).
- **Closed app.** The phone looks for new requests in the background every 15 minutes (Android's
  shortest periodic work) and shows a notification for each. A request that needs an answer in
  less than that will often be seen only when the owner opens the app; the agent should give a
  realistic `expiresInMinutes`. There is no push service in between, on purpose: Dayhand has no
  server of its own that could reach the phone.

Public counterpart: MCP [elicitation](https://modelcontextprotocol.io/specification/2025-06-18/client/elicitation)
lets a server ask the user something through the client, during one request. Dayhand's requests
are the asynchronous form of the same idea: the agent asks, goes on with something else or waits,
and the answer comes from another device, maybe hours later. The webhook follows
[Standard Webhooks](https://www.standardwebhooks.com/), like every other Dayhand event.

## 6. Pausing agents and tool policies

**Pause agents** (Settings → Agents on the phone, `dayhand agents pause`, `pause_agents`) is one
switch. While it is on, every change by an `agent` key or an agent connection (OAuth) is refused
with `agents_paused`, including dry runs, approval requests, the account routes of the REST
API (keys, webhooks, import) and the account endpoints outside it (pairing codes, revoking devices
and connections, the calendar feed); reads keep working, so an agent can still see what is going on and
tell the user. Switching it off lets them change things again. The owner's own changes, from the
app and from `cli` keys, are never refused.

Each **agent key** can also have a **policy**: for a tool that changes the plan, or for `"*"`
(every such tool without its own rule), `allow` (the default), `ask` or `deny`
(`dayhand policy set <key> <tool> <rule>`, `set_tool_policy`; [phone controls](../android/README.md#screens)).
`deny` refuses the call with `forbidden`. `ask` refuses it with `approval_required` and the id of
an approval request Dayhand made for exactly that call; once the owner picks "Allow once", the
agent repeats the call with `approvalId` and it runs, once. Reading tools have no policy.

Decisions:

- **Checked where the change happens.** The pause and the policies are checked inside the same
  transaction as the change (`gateAgentWrite` in `convex/lib/agentControls.ts`), for MCP and the
  REST API alike. There is no way around them through another surface, and no window between the
  check and the write.
- **The pause is not a revocation.** Revoking keys would stop agents too, but they would need new
  keys afterwards and their history would split. A pause keeps every key and connection and only
  holds their changes back.
- **An agent cannot lift its own brake.** Pausing, resuming and setting policies are the owner's
  tools: hidden from agents, and `forbidden` (or, while paused, `agents_paused`) if called.
- **One approval, one call.** A policy request is bound to the key, the tool and the arguments
  (their SHA-256, without `clientId`, `dryRun` and `approvalId`), and is used up in the transaction
  that applies the change; if the change fails, the approval stays unused. Calling again while the
  request waits returns the same request, so a retrying agent does not flood the phone. A policy
  request waits an hour.
- **A dry run needs no approval** under `ask`: it changes nothing, and it is how an agent shows the
  owner what it is about to do. Under `deny` and while paused it is refused like the call.
- **Policies are per key.** An agent connection (OAuth) has its scopes (`tasks:read`,
  `tasks:write`) and obeys the pause, but has no per-tool rules; give an agent that needs finer
  rules its own API key.

Public counterparts: Claude Code's [permission rules](https://code.claude.com/docs/en/permissions)
sort tools into allow, ask and deny; Dayhand uses the same three words with the same meaning, per
agent key and per Dayhand tool, with the "ask" answered on the phone. The pause is the
[kill switch](https://martinfowler.com/articles/feature-toggles.html) of operations: one
long-lived toggle that turns a whole capability off without a deploy.

## 7. The proposal inbox

A task added with `proposal: true` is a **proposal**: it has `proposedAt` and waits in the
owner's inbox (Settings → Agents → Proposals, the health card, `dayhand proposals`). It is not
in Today, the board, `list_all` (unless asked for with `proposed: true`), the `ready` list, the
calendar feed or the phone's reminders until the owner decides:

- **Accept**: it joins the plan as it is.
- **Merge** into a task already in the plan: that task gets the proposal's note (after a line
  naming it), links, labels, source and return webhooks. Since backend 0.13.0, it also inherits
  the proposal's project if the target has none and that project still exists and is not archived;
  otherwise its project stays unchanged. The proposal goes to the trash with `mergedInto`.
- **Reject**: it goes to the trash, restorable for 30 days.

Work waits for the decision: a proposal cannot be claimed, made the now task, moved to `doing` or
completed. Only the owner decides.

Any new task can carry three more fields:

- `source` `{ kind, ref, url? }`: where it came from, e.g. `{ kind: "sentry", ref: "CHECKOUT-42" }`.
  **One source makes one task**: adding a task with a source that already made one returns that
  task instead, also when it was rejected (it is in the trash) or merged (the source then leads to
  the task it was merged into). Once the trash is purged, the source is free again.
- `requestedBy`: who asked for it, in words (a customer, a colleague). An agent's proposal without
  it says `agent: <name>`.
- `returnTo`: the id of one of the user's webhooks. When the task is completed, rejected or merged,
  that webhook gets `task.returned` with the outcome and the task's proof (section 2), whatever
  events it subscribes to. An integration that opened a task from an alert can close the alert with
  the proof the work left.

Decisions:

- **A field, not a status.** A proposal is a `todo` task with `proposedAt`; accepting removes the
  field. Clients that do not know proposals never see them, because every list they read leaves
  proposals out.
- **The creator chooses.** An agent or integration says `proposal: true` for work nobody asked
  for; work the owner asked for goes straight in as before.
- **Uniqueness by source, kept in its own table** (`taskSources`), so it holds across merges and
  the trash, and two calls with the same source at the same moment still make one task (Convex
  runs them one after the other).
- **Rejecting is not purging.** A rejected proposal sits in the trash for 30 days, so a mistaken
  rejection can be undone and the same alert does not come back as a new task the next minute.
- **The return target is a registered webhook**, not a free URL: its address was checked when it
  was added (public HTTPS only) and its messages are signed with its own secret.

Public counterpart: the [Idempotency-Key](https://datatracker.ietf.org/doc/draft-ietf-httpapi-idempotency-key-header/)
draft for HTTP makes a repeated request create one resource. A task's `source` is the same promise
keyed by the outside world's own id, so it also holds when the sender is not the one retrying, e.g.
an alert that fires again.

## 8. The plan health report

`plan_health` (also `GET /api/v1/health`, `dayhand health`, the MCP prompt `plan_health`) answers
"what needs a look?" in one read: overdue tasks, tasks due today, tasks in progress and who works
on them (`agent: <name>` while a claim lasts), claims that ran out, blocked tasks with every
reason (the blocked reason and each dependency not done yet), tasks waiting for an approval and
the pending requests in all, proposals in the inbox, tasks completed today with and without
proof, and the oldest open task with its age in days. Each section has its `count` and lists the
first 20 tasks. Whether agents are paused comes first.

On the phone, a card above Today says the same counts in one line, the most pressing first, and
its **Review** opens Settings → Agents when a request or a proposal waits. The phone reads the
report from the server (`app:planHealth`) when Today opens, when the app comes back to the front
and when the tasks change; offline it keeps the last report, and a phone without a server has no
card.

Decisions:

- **Counts and names, not judgements.** The report says what is there; the agent or the owner
  decides what to do about it. The `plan_health` prompt asks the agent to go through it with the
  owner, most urgent first, and to ask before changing anything.
- **Open means in the plan**: not done, not archived, not in the trash and not a proposal.
- **"Done without proof"** counts tasks completed today with no summary, link or check. It is a
  prompt to look, not an error: people complete tasks without proof all the time.

## The third problem: starting well, and plans kept elsewhere

With eight features an agent has a lot to remember, and two more gaps show:

9. **Where to begin.** An agent that starts a session reads Today, then its claims, then the
   approvals it asked for, then works out what to do next: several calls before any work. And
   the rules for one task are spread over one long guide.
10. **Plans in files.** Many people who work with coding agents keep tasks as Markdown files in
    the repository, in the format of [Backlog.md](https://github.com/MrLesk/Backlog.md). Moving
    such a plan into Dayhand, or out of it, should not mean retyping it.

## 9. Phase guides and the agent brief

Three MCP resources split the work on one task into phases, each a short page that names the
tools to use:

- `dayhand://workflow/intake`: before work. Is the task already there (search, `source`)? Asked for,
  or a proposal? Acceptance criteria that can be checked, a plan written just before starting,
  dependencies and a blocked reason, a dry run before many changes.
- `dayhand://workflow/execution`: during work. Choose ready work, `claim_task` and `renew_claim`,
  tick criteria as they become true, `request_approval` before a risky step, a checkpoint when
  stopping, what each refusal means.
- `dayhand://workflow/finalization`: at the end. Check the criteria again, `complete_task` with
  proof (a failed check recorded as failed), the owner's yes before a last step that needs it, or
  hand the task back with a note.

`agent_brief` (`dayhand prime --json`, `GET /api/v1/brief`) starts a session in one read,
with context from the caller's side and suggested next steps. The
[agent brief reference](mcp.md#agent-brief-agent_brief) defines its fields, including projects.
`dayhand prime` prints a text summary before the rules of the road.

Decisions:

- **Phases, not one longer guide.** `dayhand://guide` stays the reference; the phase guides are
  what an agent rereads at the point it needs them. They are static text, the same for every
  user, so they need no user data, count against no limit and may be cached publicly.
- **The brief is list_today with more fields.** `dayhand prime --json` printed `list_today`
  before; it now prints a superset, so a script that read it keeps working (fields may be
  added, [mcp.md](mcp.md#versions)). Against a backend before 0.12.0, `dayhand prime` falls back
  to `list_today`.
- **From the caller's side.** The same plan reads differently for two agents: each sees its own
  claims and requests as `mine`, and ready work leaves out tasks another agent holds. The owner's
  decisions are listed only to the agent that asked.
- **Next steps are sentences, not commands.** They name tools and resources but do not act; an
  agent still decides. While agents are paused there is one step: stop changing things.

Public counterparts: Backlog.md also offers its agent instructions as MCP resources, split into a
workflow overview and guides for creating, executing and finalizing a task; Dayhand's guides cover
the same three phases with Dayhand's own tools and texts. MCP
[resources](https://modelcontextprotocol.io/specification/2025-06-18/server/resources) are the
way to give a client context without a tool call.

## 10. Backlog.md import and export

`import_backlog` (`dayhand backlog import <dir>`) reads Backlog.md task files into ordinary
Dayhand tasks; `export_backlog` (`dayhand backlog export <dir>`) writes the plan as task files.
Import uses the [source identity](#7-the-proposal-inbox) shared by integrations, not a second
synchronization mechanism. Its report explains what was created, skipped or refused, and a dry
run previews that report without storing anything.

See [Backlog.md import and export](backlog-md.md) for the field mappings, source normalization,
call limits, approval handling, export safety and overflow warnings, and the format's license and
attribution.

## What an agent does

1. Start of a session: `agent_brief` (`dayhand prime`); back from a pause: `list_events` with the
   `nextCursor` it kept; `plan_health` for the whole plan.
2. Pick work: `list_all` with `ready: true`.
3. `claim_task`; on `conflict`, pick another task.
4. Write `acceptance` and `plan` if the task has none; `renew_claim` while working.
5. Before a risky step: `request_approval`, then act on what `get_approval` says.
6. Tick the criteria with `update_task`, then `complete_task` with `proof`.
7. Stopping early: `release_task` with a checkpoint `note`; stuck: `blockedReason`.
8. Work nobody asked for: `add_task` with `proposal: true` and a `source`.
9. `agents_paused`: stop changing things and wait. `forbidden`: do not retry.
   `approval_required`: wait for that request, then repeat the call with `approvalId`.

The same steps are in the `dayhand://guide` resource, one phase at a time in
`dayhand://workflow/intake`, `/execution` and `/finalization`, and in `dayhand prime` for agents.

## Not in this release

Backlog.md import and export are copies, not sync: a change made on one side afterwards stays
there, and importing a changed file again does not update its task. For the phone's tool-policy
controls and their limits, see [Android screens](../android/README.md#screens). The phone notifies
about approval requests at most every 15 minutes while the app is closed.
