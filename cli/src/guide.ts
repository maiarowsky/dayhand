// How an agent should use hlm, in one place: `hlm prime` prints it after the
// Today context and the generated SKILL.md (skill.ts) builds on it.

export const AGENT_RULES: string[] = [
  "Pass --json and read stdout; on failure stdout is empty and stderr has one line {\"error\":{\"code\",\"message\",\"exitCode\",\"retryable\",\"clientId\"}}.",
  "Refer to tasks by number: #42 or 42 (stable, never reused), or now for the now task.",
  "Exit codes: 0 ok (also a no-op), 2 usage or bad date (fix the command), 3 key missing or revoked (ask the user), 4 not found, 5 server unavailable.",
  "After exit 5 the change may have been applied: rerun the same command line with --client-id <the clientId from the error>; it is never applied twice.",
  "hlm never prompts without a terminal; changing 3 or more tasks at once needs --yes.",
  "Dates are English phrases in the user's time zone: today, tomorrow, fri 14:00, in 3 days, 2026-10-23. Check one with hlm when \"<phrase>\" or add --dry-run.",
  "Before stopping work on a task, record where you are: hlm now <ref> --note \"<next step>\".",
  "Anything the commands do not cover: hlm tools (schemas), then hlm call <tool> '<json>'.",
];

export const AGENT_COMMANDS: [string, string][] = [
  ["hlm today --json", "Today: now task with its resume note, overdue, today, done today"],
  ["hlm list --json --status todo,doing --search <text>", "Find tasks (also --overdue, --due-before eow, -l <label>, --limit)"],
  ["hlm show <ref> --json", "One task with its history"],
  ['hlm add "<title>" --due "fri 14:00" -l <label> --json', "Add a task (due today unless --due or --no-due)"],
  ["hlm now <ref> --note \"<next step>\" --json", "Make a task the now task and leave a resume note"],
  ["hlm note <ref> \"<text>\" --json", "Append to a task's note"],
  ["hlm move <ref> <when> --json", "Reschedule (none removes the date)"],
  ["hlm done <ref>... --json", "Complete; a repeating task returns its next occurrence"],
];
