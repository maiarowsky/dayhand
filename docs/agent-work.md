# Agent work

Since backend 0.10.0 (CLI 0.11.0, Android 0.9.1), Dayhand has four features for AI agents that
work on the plan next to the person who owns it: an activity log, acceptance criteria with proof
of completion, dependencies with a blocked reason, and time-boxed claims. This page explains the
problem each one solves, the decisions behind it and the public designs it follows. The tool
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

Public counterpart: [Backlog.md](https://github.com/MrLesk/Backlog.md) (MIT), a Markdown task
board for people and AI agents, gives its tasks acceptance criteria and an implementation plan in
the same spirit. Dayhand takes the idea, not the format or code: its criteria are structured
fields behind its own tools.

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
the actor). The phone shows "agent: \<name\> works until \<time\>" in the task's details while a
claim lasts.

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

## What an agent does

1. Back from a pause: `list_events` with the `nextCursor` it kept.
2. Pick work: `list_all` with `ready: true`.
3. `claim_task`; on `conflict`, pick another task.
4. Write `acceptance` and `plan` if the task has none; `renew_claim` while working.
5. Tick the criteria with `update_task`, then `complete_task` with `proof`.
6. Stopping early: `release_task` with a checkpoint `note`; stuck: `blockedReason`.

The same steps are in the `dayhand://guide` resource and in `dayhand prime` for agents.

## Not in this release

Approval requests, an agent off switch, a proposals inbox, a health report, guides and Backlog.md
import or export are planned separately.
