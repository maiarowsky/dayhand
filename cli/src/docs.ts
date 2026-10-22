// Renders docs/cli.md from the registry (npm run docs); a test checks the
// committed file is current.
import { ENVIRONMENT, EXIT_CODES } from "./help.js";
import { GLOBAL_OPTIONS } from "./main.js";
import { flatten } from "./registry/index.js";
import type { CommandSpec, OptSpec } from "./registry/types.js";

const usage = (path: string, spec: CommandSpec) =>
  ["hlm", path, ...(spec.args ?? []).map((a) => `${a.required ? "<" : "["}${a.name}${a.variadic ? "..." : ""}${a.required ? ">" : "]"}`), spec.options?.length ? "[options]" : ""]
    .filter(Boolean)
    .join(" ");

const schemaLinks = (spec: CommandSpec) =>
  [spec.schema ?? []].flat().map((file) => `[${file.replace(".schema.json", "")}](schemas/${file})`).join(", ") ||
  (spec.name === "call" ? "the tool's" : "-");

const escape = (text: string) => text.replace(/\|/g, "\\|");
const optionRows = (options: OptSpec[]) =>
  options.map((o) => `| \`${o.flags}\` | ${escape(o.description)}${o.choices ? ` (${o.choices.join(", ")})` : ""} |`);

export function renderDocs(): string {
  const commands = flatten().filter(({ spec }) => spec.run);
  const lines = [
    "# hlm command reference",
    "",
    "<!-- Generated from cli/src/registry by `npm run docs` in cli/. Do not edit by hand. -->",
    "",
    "`hlm` is the Helm command line client. Every command is one or more MCP tool calls on the",
    "same `/mcp` endpoint the agent uses (see [mcp.md](mcp.md)); `hlm call` reaches any tool directly.",
    "",
    "Task references: `#42` or `42` (the task number), `now` (the now task) or the task id.",
    "Without a command, `hlm` shows Today.",
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
    "- `--json` (or `HLM_FORMAT=json`) prints the tool's `structuredContent` exactly as an MCP",
    "  client receives it; schemas are in [schemas/](schemas/). Indented on a terminal, one line in a pipe.",
    "- Fields may be added in a minor version; they are never removed or retyped within a major version.",
    "- A list tool returns `{\"result\": [...]}`. A command given several tasks returns `{\"results\": [...]}`,",
    "  one tool result per task. `--fields a,b` keeps only those fields of every task (or of the settings).",
    "- `hlm now` without a task prints `list_today`; `hlm note <ref>` without text prints `get_task`.",
    "- A Markdown export has no structured content; its JSON is `{\"format\":\"markdown\",\"content\":\"…\"}`.",
    "- Errors go to stderr as one line: `{\"error\":{\"code\",\"message\",\"exitCode\",\"retryable\",\"clientId\",…}}`",
    "  ([schema](schemas/error.schema.json)); stdout stays empty. Warnings are `{\"warning\":{…}}` lines.",
    "- `--plain` prints tab-separated rows without headers: `ref status dueDate dueTime title labels`",
    "  (or the `--fields`); views with sections (Today, board) start each row with the section name.",
    "",
    "## Exit codes",
    "",
    "| Code | Meaning |",
    "|---|---|",
    ...EXIT_CODES.map(([code, meaning]) => `| ${code} | ${escape(meaning)} |`),
    "",
    "Backend error codes map to exit codes: `invalid_argument` → 2, `unauthenticated` → 3,",
    "`not_found` → 4, `internal` and unknown codes → 1.",
    "",
    "## Retries",
    "",
    "Every change carries a `clientId`: `--client-id <id>`, or a generated one that is printed with",
    "any error. After exit code 5, run the same command line with that `--client-id`: the backend does",
    "not apply an operation twice. A command given several tasks uses `<id>:1`, `<id>:2`, … per task.",
    "",
    "## Prompts",
    "",
    `Changing ${3} or more tasks at once needs \`--yes\`. On a terminal hlm asks instead; without a`,
    "terminal (or with `--no-input` / `HLM_NO_INPUT=1`) it never waits for input and exits with 2.",
    "",
    "## Environment",
    "",
    "| Variable | Meaning |",
    "|---|---|",
    ...ENVIRONMENT.map(([name, meaning]) => `| \`${name}\` | ${escape(meaning)} |`),
    "",
    "## Command details",
    "",
  ];
  for (const { path, spec } of commands) {
    lines.push(`### hlm ${path}`, "", escape(spec.summary) + (spec.aliases?.length ? ` Aliases: ${spec.aliases.map((a) => `\`${a}\``).join(", ")}.` : ""), "");
    if (spec.description) lines.push(spec.description, "");
    lines.push("```", usage(path, spec), "```", "");
    if (spec.args?.length) lines.push(...spec.args.map((a) => `- \`${a.name}\`: ${a.description}`), "");
    if (spec.options?.length) lines.push("| Option | Meaning |", "|---|---|", ...optionRows(spec.options), "");
    if (spec.examples?.length) lines.push("```sh", ...spec.examples, "```", "");
  }
  return lines.join("\n");
}
