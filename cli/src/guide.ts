// How an agent should use dayhand, in one place: `dayhand prime` prints it after the
// Today context and the generated SKILL.md (skill.ts) builds on it.

export const AGENT_RULES: string[] = [
  "Pass --json and read stdout; on failure stdout is empty and stderr has one line {\"error\":{\"code\",\"message\",\"exitCode\",\"retryable\",\"clientId\"}}.",
  "Refer to tasks by number: #42 or 42 (stable, never reused), or now for the now task.",
  "Exit codes: 0 ok (also a no-op), 2 usage or bad date (fix the command), 3 key missing or revoked (ask the user), 4 not found, 5 server unavailable or rate_limited (too many calls: wait as the message says, then rerun), 6 refused by the task's state (conflict: another agent holds it, pick another task; precondition_failed: meet the acceptance criteria and give --summary), 7 refused by the owner (agents_paused: stop changing things and wait; forbidden: do not retry; approval_required: wait for dayhand approval <approvalId>, then rerun with --approval <approvalId>).",
  "After exit 5 the change may have been applied: rerun the same command line with --client-id <the clientId from the error>; it is never applied twice.",
  "dayhand never prompts without a terminal; changing 3 or more tasks at once needs --yes.",
  "Dates are English phrases in the user's time zone: today, tomorrow, fri 14:00, in 3 days, 2026-10-23. Check one with dayhand when \"<phrase>\" or add --dry-run.",
  "Before stopping work on a task, record where you are: dayhand now <ref> --note \"<next step>\".",
  "Working on a task alongside other agents: dayhand claim <ref> first (exit 6 conflict: pick another task), dayhand renew <ref> while you work, dayhand release <ref> --note \"<checkpoint>\" when you stop.",
  "Start of a session: dayhand prime --json gives Today, your claims, approvals waiting, ready work and nextSteps. Back after a pause: dayhand log --since <the nextCursor you kept> --json shows only what changed meanwhile; dayhand health --json shows what needs a look.",
  "Before anything risky or hard to undo, ask the owner: dayhand ask \"<what you want to do>\" --option \"<label>: <what happens>\" --option … --json, then dayhand approval <id> --wait 600 --json, and do only what they chose.",
  "Work nobody asked you for goes in as a proposal: dayhand add \"<title>\" --propose --source \"<kind>:<ref>\" --json; the owner accepts it.",
  "Anything the commands do not cover: dayhand tools (schemas), then dayhand call <tool> '<json>'.",
];

export const AGENT_COMMANDS: [string, string][] = [
  ["dayhand prime --json", "Session start: Today plus your claims, approvals waiting, ready tasks and next steps"],
  ["dayhand today --json", "Today: now task with its resume note, overdue, today, done today"],
  ["dayhand list --json --status todo,doing --search <text>", "Find tasks on the server (also --overdue, --due-before eow, -l <label>, --limit, --cursor)"],
  ["dayhand show <ref> --json", "One task with its history"],
  ['dayhand add "<title>" --due "fri 14:00" -l <label> --json', "Add a task (due today unless --due or --no-due)"],
  ["dayhand now <ref> --note \"<next step>\" --json", "Make a task the now task and leave a resume note"],
  ["dayhand note <ref> \"<text>\" --json", "Append to a task's note"],
  ["dayhand move <ref> <when> --json", "Reschedule (none removes the date)"],
  ["dayhand done <ref>... --json", "Complete; a repeating task returns its next occurrence"],
  ["dayhand list --ready --json", "Tasks ready to work on: not done, not blocked, every dependency done"],
  ["dayhand claim <ref> --json", "Claim a task for 120 minutes (--minutes); others get conflict (exit 6)"],
  ["dayhand criteria <ref> --met 1,2 --json", "Mark acceptance criteria met (--add adds one)"],
  ['dayhand done <ref> --summary "<what was done>" --check "tests=pass <url>" --json', "Complete with proof; needed for a task with acceptance criteria"],
  ["dayhand log --since <cursor> --json", "The changes since your last cursor (nextCursor)"],
  ['dayhand ask "<action>" --option "<label>: <consequence>" --option … --json', "Ask the owner before a risky step; they decide on the phone"],
  ["dayhand approval <id> --wait 600 --json", "The owner's decision (status pending, decided or expired)"],
  ["dayhand health --json", "What needs a look: overdue, blocked, stale claims, approvals, proposals"],
  ["dayhand backlog import <dir> --dry-run --json", "What importing a Backlog.md folder would create and skip; without --dry-run it imports"],
];
