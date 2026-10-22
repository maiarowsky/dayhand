// Renders docs/skills/hlm/SKILL.md, an Agent Skill for using hlm, from the
// registry (npm run docs); a test checks the committed file is current.
import { AGENT_COMMANDS, AGENT_RULES } from "./guide.js";
import { EXIT_CODES } from "./help.js";
import { flatten } from "./registry/index.js";
import type { CommandSpec } from "./registry/types.js";

const usage = (path: string, spec: CommandSpec) =>
  ["hlm", path, ...(spec.args ?? []).map((a) => `${a.required ? "<" : "["}${a.name}${a.variadic ? "..." : ""}${a.required ? ">" : "]"}`)].join(" ");

const escape = (text: string) => text.replace(/\|/g, "\\|");

/** Commands an agent has no use for: they change the local setup or the user's phones. */
const PEOPLE_ONLY = new Set(["login", "logout", "completion", "pair", "device revoke", "revoke"]);

export function renderSkill(): string {
  const commands = flatten().filter(({ path, spec }) => spec.run && !PEOPLE_ONLY.has(path));
  return [
    "---",
    "name: hlm",
    "description: Read and change the user's Helm task list with the hlm CLI (Today, add, find, reschedule, complete, resume notes). Use when the user mentions Helm, their tasks or plan for the day, or asks to track work as tasks.",
    "---",
    "",
    "<!-- Generated from cli/src/registry by `npm run docs` in cli/. Do not edit by hand. -->",
    "",
    "# hlm",
    "",
    "`hlm` is the command line client of Helm, the user's personal task manager. Each command is a",
    "call of a Helm MCP tool, so the user sees your changes in the app at once, recorded as yours.",
    "",
    "## Setup",
    "",
    "- Check with `hlm whoami --json`. Exit 3 means no key: ask the user for one; never search for keys.",
    "- Give each agent its own key of kind `agent` in `HLM_API_KEY` (and `HLM_URL`); history then names",
    "  the agent. `hlm prime` prints Today and these rules for a session-start hook.",
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
    'ref=$(hlm list --json --search "accountant" --fields ref | jq -r \'.result[0].ref\')',
    'hlm now "$ref" --note "waiting for the invoice" --json',
    "",
    "# Check a date before using it, or preview the whole change",
    'hlm when "next fri 9am" --json',
    'hlm add "Send the report" --due "next fri 9am" --dry-run --json',
    "",
    "# Retry after exit 5 without creating a duplicate",
    'hlm add "Book the dentist" --client-id dentist-2026-10-22 --json',
    "",
    "# Anything else the tools can do",
    "hlm tools update_task --json",
    'hlm call update_task \'{"taskId":"#42","note":null}\'',
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
    "`--json` prints the tool's `structuredContent`: a task object, `{\"task\",\"next\"}` from `done`,",
    "`{\"result\":[...]}` from list commands, `{\"results\":[...]}` when a command is given several tasks.",
    "Dates are `YYYY-MM-DD` and `HH:MM` in the user's time zone, timestamps Unix milliseconds. Fields may",
    "be added, never removed or retyped within a major version. `--fields ref,title,dueDate` narrows tasks.",
    "",
    "## All commands",
    "",
    "| Command | Summary |",
    "|---|---|",
    ...commands.map(({ path, spec }) => `| \`${usage(path, spec)}\` | ${escape(spec.summary)} |`),
    "",
    "Details: `hlm <command> --help`, `hlm help dates`, or docs/cli.md in the Helm repository.",
    "",
  ].join("\n");
}
