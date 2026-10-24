// The dayhand://guide resource, the phase guides dayhand://workflow/* and the
// server instructions: how an agent should work with the user's plan. Keep in
// step with docs/mcp.md and docs/agent-work.md.
import { CALL_LIMITS } from "../callLimits";

export const INSTRUCTIONS =
  'Dayhand is the user\'s personal task list and day plan. Start with agent_brief (or list_today, dayhand://today). Refer to a task by its id or its number as "#42". ' +
  "Find tasks with list_all (query, status, labels, dueBefore/dueAfter, overdue, limit/cursor) instead of reading the whole plan. " +
  "Pass a clientId with changes you might retry, and dryRun: true to preview a change. " +
  "After a pause, call list_events with the nextCursor you kept to see only what changed. Before working on a task, claim_task it; complete it with proof. " +
  "Ask the owner with request_approval before anything risky; plan_health shows what needs a look. " +
  "Read dayhand://guide for the full rules and dayhand://workflow/intake, /execution and /finalization for each phase of a task.";

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

- Start a session with \`agent_brief\`: Today plus the claims in force,
  approvals waiting, the tasks ready to work on and your next steps. Or
  \`list_today\` (the resource \`dayhand://today\`) for Today alone.
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

## Phases of a task

Three resources walk through one task from start to end:
\`dayhand://workflow/intake\` (writing a task down so that done can be
checked), \`dayhand://workflow/execution\` (working on it under a claim)
and \`dayhand://workflow/finalization\` (closing it with proof, or handing
it back).

## Moving plans

\`import_backlog\` reads task files in the Backlog.md format (Markdown with a
YAML header) and \`export_backlog\` writes the plan as such files. A file
imported before is skipped, so importing a folder again brings only what is
new.

## Routines

The prompts \`plan_day\`, \`weekly_review\`, \`triage_overdue\` and
\`plan_health\` start the four routines: planning today, reviewing the week,
deciding what happens to overdue tasks, and checking what needs a look.
`;

export const WORKFLOW_INTAKE = `# Intake: writing a task down

Use this when you add a task, or pick up one that is only a title. The goal is
a task another agent could finish without asking you, and whose end the owner
can check.

## 1. Is it already there?

- Search before adding: \`list_all\` with \`query\` (a few words of the
  title).
- Give external work a \`source\` in \`add_task\`. One \`source\`
  (\`{kind, ref, url}\`) makes one task: adding it again
  returns the task it made the first time, even if the owner rejected it.

## 2. Asked for, or your idea?

- Work the owner asked for: \`add_task\`.
- Work nobody asked for (an alert, an issue you noticed, a follow-up you
  think is needed): \`add_task\` with \`proposal: true\` and a
  \`source\`. It waits in the owner's inbox until they accept, merge or
  reject it; you cannot claim or complete it before that.

## 3. Write down what done means

- \`acceptance\`: two to five criteria, each one a statement someone can
  check by looking (a test passes, a page shows X, a file exists), not a
  step. They get ids \`a1\`, \`a2\`, … that stay put when you edit them.
- \`plan\`: how you will get there, in a few lines; write it right before
  you start, so it reflects what is true then.
- \`checklist\`: the steps, if they help; criteria are the test, the
  checklist is the way.
- \`dependsOn\`: the tasks that must be done first (\`"#42"\`). A cycle
  is refused. \`blockedReason\`: why it cannot start, in words.
- A due day only if the owner gave one. Do not invent deadlines.

## 4. Check before you save

- \`dryRun: true\` shows the task as it would be stored. Pass a
  \`clientId\` so a retry never adds it twice.
- Adding many tasks at once (more than three): show the owner the list
  first and wait for a yes.
- Moving a whole Backlog.md folder in: \`import_backlog\` with
  \`dryRun: true\` first; it reports what it would skip and why.

Next: \`dayhand://workflow/execution\`.
`;

export const WORKFLOW_EXECUTION = `# Execution: working on a task

Use this from the moment you choose a task until you stop working on it.

## 1. Choose

- \`agent_brief\` shows your claims, approvals waiting for the owner and
  the first tasks ready to work on. \`list_all\` with \`ready: true\`
  gives all of them: not done, not blocked, every dependency done.
- Take one task at a time. A task without acceptance criteria goes back to
  \`dayhand://workflow/intake\` first.

## 2. Claim

- \`claim_task\` before you change anything (120 minutes unless you pass
  \`minutes\`, at most 1440). While you hold it, other agents get
  \`conflict\`. If you get \`conflict\`, choose another task; do not wait
  for the claim to run out.
- Claiming does not change the status: \`set_status\` to \`doing\` when
  you really start.
- \`renew_claim\` before \`claimExpiresAt\`, for as long as you work. A
  claim that ran out can be renewed while nobody else has taken the task.
- The owner can take the task over at any time. If your changes start
  failing, read the task again with \`get_task\`.

## 3. Work

- Tick each criterion when it is true, not before: \`update_task\` with
  the whole \`acceptance\` list, keeping the ids, and \`met: true\` on
  the ones done.
- Keep the \`plan\` honest: if the approach changes, change it.
- Leave the owner a trail: \`set_now\` with a resume note for the task
  they follow on Today, or \`release_task\` with a \`note\` when you stop.
- Before anything risky or hard to undo (deleting, deploying, paying,
  writing outside the plan): \`request_approval\` with 2 to 4 options and
  their consequences, then \`get_approval\` until it is \`decided\`.
  Do only what the chosen option says; \`expired\` means ask again.

## 4. Stuck or interrupted

- Waiting on something outside the plan: \`blockedReason\` in words, then
  \`release_task\` with a checkpoint \`note\`.
- Waiting on another task: add it to \`dependsOn\`.
- \`agents_paused\`: stop changing things and wait. \`forbidden\`: the
  owner denied this tool to you; do not retry. \`approval_required\`: wait
  for the request in \`approvalId\`, then repeat exactly the same call with
  it.
- Back after a pause: \`list_events\` with the \`nextCursor\` you kept
  shows what changed meanwhile.

Next: \`dayhand://workflow/finalization\`.
`;

export const WORKFLOW_FINALIZATION = `# Finalization: closing a task

Use this when you believe the task is done, or when you hand it back.

## 1. Check the criteria yourself

- \`get_task\` and read every criterion again. Run what proves it (the
  tests, the page, the command) now, not from memory.
- Every criterion must be \`met\` before an agent can complete a task that
  has criteria. If one cannot be met, do not tick it: say why in the task
  and ask the owner (step 3).

## 2. Complete with proof

- \`complete_task\` with \`proof\`: a \`summary\` of what changed and
  how you know, \`links\` (a pull request, a deploy, a document) and
  \`checks\` (\`{name, result: "pass" | "fail", url}\`). Record a failed
  check as \`fail\`; do not leave it out.
- For an agent completing a task with criteria, any unmet criterion or
  missing proof summary makes the call fail with \`precondition_failed\`
  and nothing changes. A task without criteria may be completed without
  a proof summary.
- Completing ends your claim. A repeating task returns its next occurrence
  as \`next\`, with the criteria unticked.
- If the task came with \`returnTo\`, that webhook hears about it with
  your proof.

## 3. When the owner has to decide

- The last step needs a yes (merging, releasing, sending, spending):
  \`request_approval\` before it, with what happens under each option and
  whether it can be undone. Complete the task only after you did what the
  owner chose.
- Done differently than the criteria say: ask before changing the criteria;
  do not rewrite them to fit the result.

## 4. Handing back instead

- Not finished: \`release_task\` with a \`note\` that says what is done,
  what is left and the next step. Leave the criteria as they are.
- Found more work on the way: a proposal (\`add_task\` with
  \`proposal: true\`), not a change of this task's scope.
- Afterwards \`agent_brief\` (or \`plan_health\`) shows what needs a look
  next.
`;

/** The phase guides by their resource URI. */
export const WORKFLOWS: Record<string, string> = {
  "dayhand://workflow/intake": WORKFLOW_INTAKE,
  "dayhand://workflow/execution": WORKFLOW_EXECUTION,
  "dayhand://workflow/finalization": WORKFLOW_FINALIZATION,
};
