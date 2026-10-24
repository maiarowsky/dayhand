// The dayhand://guide resource and the server instructions: how an agent should
// work with the user's plan. Keep in step with docs/mcp.md.
import { CALL_LIMITS } from "../callLimits";

export const INSTRUCTIONS =
  'Dayhand is the user\'s personal task list and day plan. Start with list_today (or read dayhand://today). Refer to a task by its id or its number as "#42". ' +
  "Find tasks with list_all (query, status, labels, dueBefore/dueAfter, overdue, limit/cursor) instead of reading the whole plan. " +
  "Pass a clientId with changes you might retry, and dryRun: true to preview a change. " +
  "After a pause, call list_events with the nextCursor you kept to see only what changed. Before working on a task, claim_task it; complete it with proof. " +
  "Ask the owner with request_approval before anything risky; plan_health shows what needs a look. " +
  "Read dayhand://guide for the full rules.";

export const AGENT_GUIDE = `# Working with Dayhand

Dayhand is one person's task list and day plan. You act for that person with
their API key; every change you make is recorded in the task's history as
\`agent: <key name>\`, next to the changes they make in the app.

## Tasks

- Every task has an \`id\` and a number (\`ref\`). Use the number with the
  user and in calls: \`"taskId": "#42"\`. Numbers are never reused.
- \`dueDate\` is a day in the user's time zone (YYYY-MM-DD, "today" or
  "tomorrow"); \`dueTime\` (HH:MM) is optional and only timed tasks ring.
- Status is \`todo\`, \`doing\` or \`done\`. One task at most is the **now**
  task, with a resume note: where the user stopped and the next step. Keep
  it current with \`set_now\` when work moves on.
- A task without a day shows only in \`list_all\` and \`board\`.
- \`delete_task\` moves a task to the trash for 30 days; \`restore_task\`
  brings it back. \`archive_task\` hides it but keeps it in exports.

## Reading

- Start with \`list_today\` (or the resource \`dayhand://today\`).
- Look tasks up with \`list_all\`: \`query\` searches titles, notes, resume
  notes and labels; \`status\`, \`labels\`, \`dueBefore\`, \`dueAfter\` and
  \`overdue\` narrow the list; \`limit\` and \`cursor\` page through it.
  Reading the whole plan to find one task wastes the user's context.
- \`get_task\` (or \`dayhand://tasks/42\`) shows who changed what and when.

## Changing

- Ask before deleting, archiving or changing settings, and before changing
  more than a few tasks at once.
- Pass a \`clientId\` (a new UUID per change). If a call fails or times out,
  retry with the same \`clientId\`: the change is never applied twice.
- \`dryRun: true\` checks a change and returns what it would produce without
  saving it. Use it to show the user a plan of several changes first.

## Working on a task

- Pick work with \`list_all\` and \`ready: true\`: not done, not blocked
  (\`blockedReason\`), every task in \`dependsOn\` done.
- \`claim_task\` before you start (120 minutes unless you pass \`minutes\`),
  \`renew_claim\` while you work, \`release_task\` with a checkpoint
  \`note\` when you stop. While you hold the claim, other agents get
  \`conflict\`; if you get \`conflict\`, pick another task. The user in
  the app can always take a task over.
- Write down what done means in \`acceptance\` and how you will get there
  in \`plan\`. Tick criteria with \`update_task\` (\`met: true\`), then
  \`complete_task\` with \`proof\`: a \`summary\`, \`links\` and
  \`checks\` (\`pass\` or \`fail\`). With unmet criteria or no summary the
  call fails with \`precondition_failed\`.
- If you cannot go on, set \`blockedReason\` and say why.

## Coming back after a pause

- Keep the \`nextCursor\` of \`list_events\` (or \`dayhand://activity\`).
  Next time call \`list_events\` with \`since\` set to it: you get only the
  changes made meanwhile, oldest first (\`hasMore\`: call again). \`by\`
  and \`taskId\` narrow the log.

## Asking the owner

- Before something risky or hard to undo, ask with \`request_approval\`:
  \`action\` (what you want to do), 2 to 4 \`options\` with their
  \`consequence\`, \`reversible\` and \`expiresInMinutes\`. The owner
  decides on the phone; read the outcome with \`get_approval\` (status
  \`pending\`, \`decided\` or \`expired\`). Dayhand records the decision;
  acting on it, and not acting without it, is up to you.
- The owner can pause every agent: your changes then fail with
  \`agents_paused\` while reading still works. Stop and wait; do not retry
  in a loop.
- The owner can set a policy per key and tool. \`forbidden\`: that tool is
  denied to you. \`approval_required\`: the error carries \`approvalId\`;
  wait until \`get_approval\` shows it decided, then repeat exactly the same
  call with \`approvalId\`. One approval lets one call through.

## Proposing work

- Work you were not asked for goes in as a proposal: \`add_task\` with
  \`proposal: true\`. It waits in the owner's inbox, out of Today, until they
  accept, merge or reject it. Give a \`source\` (\`{kind, ref, url}\`, e.g.
  the alert or issue) so the same source never makes two tasks, and
  \`returnTo\` (one of the user's webhooks) to hear back, with the proof,
  when the task closes.
- \`plan_health\` (or the \`plan_health\` prompt) shows in one read what
  needs a look.

## Errors and limits

- A failed call returns \`isError: true\` with \`structuredContent.error\`:
  \`invalid_argument\` (fix the arguments), \`not_found\`, \`conflict\`
  (another agent holds the task's claim), \`precondition_failed\` (the
  task's state does not allow it yet), \`agents_paused\`, \`forbidden\`,
  \`approval_required\` (the owner's controls, above), \`rate_limited\`
  (wait \`retryAfterMs\`, then retry) or \`internal\`.
- Each key may make ${CALL_LIMITS.read} reads and ${CALL_LIMITS.write} changes a minute.

## Routines

The prompts \`plan_day\`, \`weekly_review\`, \`triage_overdue\` and
\`plan_health\` start the four routines: planning today, reviewing the week,
deciding what happens to overdue tasks, and checking what needs a look.
`;
