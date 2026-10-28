// Renders docs/skills/dayhand/SKILL.md, an Agent Skill for using dayhand, from the
// registry (npm run docs); a test checks the committed file is current.
import { AGENT_COMMANDS, AGENT_RULES } from "./guide.js";
import { EXIT_CODES } from "./help.js";
import { flatten } from "./registry/index.js";
import type { CommandSpec } from "./registry/types.js";

const usage = (path: string, spec: CommandSpec) =>
  ["dayhand", path, ...(spec.args ?? []).map((a) => `${a.required ? "<" : "["}${a.name}${a.variadic ? "..." : ""}${a.required ? ">" : "]"}`)].join(" ");

const escape = (text: string) => text.replace(/\|/g, "\\|");

/** Commands an agent has no use for: they change the local setup or the user's phones, or need a person at the keys. */
const PEOPLE_ONLY = new Set(["login", "logout", "completion", "pair", "device revoke", "revoke", "ui"]);

export function renderSkill(): string {
  const commands = flatten().filter(({ path, spec }) => spec.run && !PEOPLE_ONLY.has(path));
  return [
    "---",
    "name: dayhand",
    "description: Read and change the user's Dayhand task list with the dayhand CLI (Today, add, find, reschedule, complete, resume notes). Use when the user mentions Dayhand, their tasks or plan for the day, or asks to track work as tasks.",
    "---",
    "",
    "<!-- Generated from cli/src/registry by `npm run docs` in cli/. Do not edit by hand. -->",
    "",
    "# dayhand",
    "",
    "`dayhand` is the command line client of Dayhand, the user's personal task manager. Each command is a",
    "call of a Dayhand MCP tool, so the user sees your changes in the app at once, recorded as yours.",
    "",
    "## Setup",
    "",
    "- Check with `dayhand whoami --json`. Exit 3 means no key: ask the user for one; never search for keys.",
    "- Give each agent its own key of kind `agent` in `DAYHAND_API_KEY` (and `DAYHAND_URL`); history then names",
    "  the agent. `dayhand prime` prints Today, your claims, approvals waiting, next steps and these",
    "  rules for a session-start hook.",
    "",
    "## Rules",
    "",
    ...AGENT_RULES.map((rule) => `- ${rule}`),
    "",
    "## Common commands",
    "",
    "| Command | What it does |",
    "|---|---|",
    ...AGENT_COMMANDS.map(([command, meaning]) => `| \`${escape(command)}\` | ${escape(meaning)} |`),
    "",
    "## Patterns",
    "",
    "```sh",
    "# Find a task, then act on its number",
    'ref=$(dayhand list --json --search "accountant" --fields ref | jq -r \'.result[0].ref\')',
    'dayhand now "$ref" --note "waiting for the invoice" --json',
    "",
    "# Check a date before using it, or preview the whole change",
    'dayhand when "next fri 9am" --json',
    'dayhand add "Send the report" --due "next fri 9am" --dry-run --json',
    "",
    "# Retry after exit 5 without creating a duplicate",
    'dayhand add "Book the dentist" --client-id dentist-2026-10-22 --json',
    "",
    "# A task is in at most one project; names or ids work as references",
    "dayhand project list --json",
    'dayhand add "Write the menu" -p "Strona piekarni" --json',
    "dayhand list -p none --json",
    "dayhand project assign Home 41 42 --yes --json",
    "",
    "# Anything else the tools can do",
    "dayhand tools update_task --json",
    'dayhand call update_task \'{"taskId":"#42","note":null}\'',
    "```",
    "",
    "## Exit codes",
    "",
    "| Code | Meaning |",
    "|---|---|",
    ...EXIT_CODES.map(([code, meaning]) => `| ${code} | ${escape(meaning)} |`),
    "",
    "## JSON",
    "",
    "`--json` prints the tool's `structuredContent`; result shapes are documented in docs/cli.md (JSON output).",
    "Dates are `YYYY-MM-DD` and `HH:MM` in the user's time zone, timestamps Unix milliseconds. Fields may",
    "be added, never removed or retyped within a major version. `--fields ref,title,dueDate` narrows tasks.",
    "",
    "## All commands",
    "",
    "| Command | Summary |",
    "|---|---|",
    ...commands.map(({ path, spec }) => `| \`${usage(path, spec)}\` | ${escape(spec.summary)} |`),
    "",
    "Details: `dayhand <command> --help`, `dayhand help dates`, or docs/cli.md in the Dayhand repository.",
    "",
  ].join("\n");
}
