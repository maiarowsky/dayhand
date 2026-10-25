// Renders docs/cli.md from the registry (npm run docs); a test checks the
// committed file is current.
import { ENVIRONMENT, EXIT_CODES } from "./help.js";
import { GLOBAL_OPTIONS } from "./globals.js";
import { flatten } from "./registry/index.js";
import { TOPICS } from "./topics.js";
import type { CommandSpec, OptSpec } from "./registry/types.js";

const usage = (path: string, spec: CommandSpec) =>
  ["dayhand", path, ...(spec.args ?? []).map((a) => `${a.required ? "<" : "["}${a.name}${a.variadic ? "..." : ""}${a.required ? ">" : "]"}`), spec.options?.length ? "[options]" : ""]
    .filter(Boolean)
    .join(" ");

const schemaLinks = (spec: CommandSpec) =>
  [spec.schema ?? []].flat().map((file) => `[${file.replace(".schema.json", "")}](schemas/${file})`).join(", ") ||
  (spec.name === "call" ? "the tool's" : "-");

const escape = (text: string) => text.replace(/\|/g, "\\|");
const optionRows = (options: OptSpec[]) =>
  options.map((o) => `| \`${escape(o.flags)}\` | ${escape(o.description)}${o.choices ? ` (${o.choices.join(", ")})` : ""} |`);

export function renderDocs(): string {
  const commands = flatten().filter(({ spec }) => spec.run);
  const lines = [
    "# dayhand command reference",
    "",
    "<!-- Generated from cli/src/registry by `npm run docs` in cli/. Do not edit by hand. -->",
    "",
    "`dayhand` is the Dayhand command line client. Every command is one or more MCP tool calls on the",
    "same `/mcp` endpoint the agent uses (see [mcp.md](mcp.md)); `dayhand call` reaches any tool directly.",
    "",
    "`dh` is a shorter name for the same command. On Debian and Ubuntu, debhelper has a `dh` command of",
    "its own; type `dayhand` there. `hlm`, the old name, still works until 1.0 and warns on every run.",
    "",
    "Task references: `#42` or `42` (the task number), `now` (the now task) or the task id.",
    "Without a command, `dayhand` shows Today.",
    "",
    "## Commands",
    "",
    "| Command | Calls | `--json` schema | Summary |",
    "|---|---|---|---|",
    ...commands.map(
      ({ path, spec }) =>
        `| \`${usage(path, spec)}\` | ${spec.tools.map((t) => `\`${t}\``).join(", ") || "-"} | ${schemaLinks(spec)} | ${escape(spec.summary)} |`,
    ),
    "",
    "## Global options",
    "",
    "| Option | Meaning |",
    "|---|---|",
    ...optionRows(GLOBAL_OPTIONS),
    "",
    "## JSON output",
    "",
    "- `--json` (or `DAYHAND_FORMAT=json`) prints the tool's `structuredContent` exactly as an MCP",
    "  client receives it; schemas are in [schemas/](schemas/). Indented on a terminal, one line in a pipe.",
    "- Fields may be added in a minor version; they are never removed or retyped within a major version.",
    "- A list tool returns `{\"result\": [...]}`. Bulk commands follow the [results schema](schemas/results.schema.json).",
    "  `--fields a,b` keeps only those fields of every task (or of the settings).",
    "- `dayhand now` without a task prints `list_today`; `dayhand note <ref>` without text prints `get_task`.",
    "- A Markdown export's JSON is `{\"format\":\"markdown\",\"content\":\"…\"}`.",
    "- Errors go to stderr as one line: `{\"error\":{\"code\",\"message\",\"exitCode\",\"retryable\",\"clientId\",…}}`",
    "  ([schema](schemas/error.schema.json)); stdout stays empty. Warnings are `{\"warning\":{…}}` lines.",
    "- `--plain` prints tab-separated rows without headers: `ref status dueDate dueTime title labels`",
    "  (or the `--fields`); views with sections (Today, board) start each row with the section name.",
    "- `--fields project,projectId` selects the resolved project name and id; see [name resolution](#human-output).",
    "- `dayhand list` filters (`--project`, `--status`, `--overdue`, `--due-before`, `--due-after`, `--search`, `--limit`, `--cursor`)",
    "  run on the backend and keep list_all's shape: `{\"result\": [...], \"total\", \"nextCursor\"}`. With `--limit`, pass",
    "  `nextCursor` as `--cursor` for the next page. A backend older than 0.4.0 has no `total` and `nextCursor`;",
    "  dayhand then applies non-project filters to its full list itself.",
    "- `--dry-run` on a command that changes something prints `{\"dryRun\":true,\"calls\":[{\"tool\",\"arguments\",\"result\"}]}`",
    "  ([schema](schemas/dry-run.schema.json)) with dates resolved. The backend checks each change and returns",
    "  what it would give (`result`) without saving anything; reads still happen. A backend older than 0.4.0",
    "  and the device endpoints get nothing: their calls are only listed.",
    "",
    "## Human output",
    "",
    "Tables are aligned by display width; due days read as `today`, `tomorrow`, `yesterday` or",
    "`Fri 23 Oct` in your time zone. A terminal gets colors (`--color auto|always|never`, `--no-color`,",
    "`[ui] color`, `NO_COLOR`) and long titles cut to its width; a pipe gets the same text without",
    "colors or cutting. `dayhand board` shows its columns side by side on terminals 90 columns or wider.",
    "Task views show projects as `+Strona-piekarni` after the title, before `#labels`. Resolving task project",
    "names uses one `list_projects` read when needed, not for default JSON or plain output; explicit",
    "`--fields project` also resolves names.",
    "On a terminal, `dayhand note <ref>` and `dayhand edit <ref>` without options open `$VISUAL`/`$EDITOR`.",
    "",
    "## Exit codes",
    "",
    "| Code | Meaning |",
    "|---|---|",
    ...EXIT_CODES.map(([code, meaning]) => `| ${code} | ${escape(meaning)} |`),
    "",
    "Backend error codes map to exit codes: `invalid_argument` → 2, `unauthenticated` → 3,",
    "`not_found` → 4, `rate_limited` → 5, `conflict` and `precondition_failed` → 6, `agents_paused`, `forbidden` and",
    "`approval_required` → 7, `internal` and unknown codes → 1.",
    "",
    "## Retries",
    "",
    "Every change carries a `clientId`: `--client-id <id>`, or a generated one that is printed with",
    "any error. After exit code 5, run the same command line with that `--client-id`: the backend does",
    "not apply an operation twice. A command given several tasks uses `<id>:1`, `<id>:2`, … per task.",
    "",
    "## Prompts",
    "",
    `Changing ${3} or more tasks at once needs \`--yes\`. On a terminal dayhand asks instead; without a`,
    "terminal (or with `--no-input` / `DAYHAND_NO_INPUT=1`) it never waits for input and exits with 2.",
    "`project assign` requires confirmation already for two tasks.",
    "",
    "## Environment",
    "",
    "| Variable | Meaning |",
    "|---|---|",
    ...ENVIRONMENT.map(([name, meaning]) => `| \`${name}\` | ${escape(meaning)} |`),
    "",
    ...Object.entries(TOPICS).flatMap(([name, text]) => [`## Topic: ${name}`, "", `\`dayhand help ${name}\``, "", "```text", text.trimEnd(), "```", ""]),
    "## Command details",
    "",
  ];
  for (const { path, spec } of commands) {
    lines.push(`### dayhand ${path}`, "", escape(spec.summary) + (spec.aliases?.length ? ` Aliases: ${spec.aliases.map((a) => `\`${a}\``).join(", ")}.` : ""), "");
    if (spec.description) lines.push(spec.description, "");
    lines.push("```", usage(path, spec), "```", "");
    if (spec.args?.length) lines.push(...spec.args.map((a) => `- \`${a.name}\`: ${a.description}`), "");
    if (spec.options?.length) lines.push("| Option | Meaning |", "|---|---|", ...optionRows(spec.options), "");
    if (spec.examples?.length) lines.push("```sh", ...spec.examples, "```", "");
  }
  return lines.join("\n");
}
