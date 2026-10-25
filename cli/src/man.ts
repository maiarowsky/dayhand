// Renders man/dayhand.1 (roff) from the registry (npm run docs); a test checks the
// committed file is current. No version or date in it, so a release bump does
// not make it stale.
import { ENVIRONMENT, EXIT_CODES } from "./help.js";
import { GLOBAL_OPTIONS } from "./globals.js";
import { flatten } from "./registry/index.js";
import { TOPICS } from "./topics.js";
import type { CommandSpec, OptSpec } from "./registry/types.js";

/** Escapes text for roff: backslashes, dashes, and a leading dot or quote that would start a request. */
const roff = (text: string) =>
  text
    .replace(/\\/g, "\\e")
    .replace(/-/g, "\\-")
    .replace(/^([.'])/gm, "\\&$1");

const args = (spec: CommandSpec) =>
  (spec.args ?? []).map((a) => `${a.required ? "<" : "["}${a.name}${a.variadic ? "..." : ""}${a.required ? ">" : "]"}`).join(" ");

const option = (o: OptSpec) => [".TP", `.B ${roff(o.flags)}`, roff(o.description + (o.choices ? ` (${o.choices.join(", ")})` : ""))];

const block = (text: string) => [".nf", ".RS 4", ...text.trimEnd().split("\n").map(roff), ".RE", ".fi"];

export function renderMan(): string {
  const commands = flatten().filter(({ spec }) => spec.run);
  const lines = [
    ".\\\" Generated from cli/src/registry by `npm run docs` in cli/. Do not edit by hand.",
    '.TH DAYHAND 1 "" "dayhand" "User Commands"',
    ".SH NAME",
    "dayhand \\- the Dayhand command line client for people and agents",
    ".SH SYNOPSIS",
    ".B dayhand",
    "[\\fIcommand\\fR] [\\fIarguments\\fR] [\\fIoptions\\fR]",
    ".SH DESCRIPTION",
    roff("dayhand reads and changes a Dayhand task list. Every command is one or more calls of the MCP tools the agent uses on the same /mcp endpoint; dayhand call reaches any tool directly. Without a command, dayhand shows Today."),
    ".PP",
    roff("dh is a shorter name for the same command. On Debian and Ubuntu, debhelper has a dh command of its own; type dayhand there. hlm, the old name, still works until 1.0 and warns on every run."),
    ".PP",
    roff("Task references: #42 or 42 (the task number), now (the now task) or the task id."),
    ".SH COMMANDS",
  ];
  for (const { path, spec } of commands) {
    lines.push(".TP", `.B dayhand ${roff(path)}${spec.args?.length ? ` ${roff(args(spec))}` : ""}`, roff(spec.summary));
    if (spec.aliases?.length) lines.push(".br", roff(`Aliases: ${spec.aliases.join(", ")}.`));
    if (spec.description) lines.push(".br", roff(spec.description));
    if (spec.options?.length) lines.push(".RS", ...spec.options.flatMap(option), ".RE");
  }
  lines.push(
    ".SH GLOBAL OPTIONS",
    roff("Valid before or after the command. Command-specific options take precedence; see the command's description."),
    ...GLOBAL_OPTIONS.flatMap(option),
    ".TP",
    ".B \\-V, \\-\\-version",
    "Print the CLI version.",
    ".TP",
    ".B \\-h, \\-\\-help",
    roff("Help for dayhand or for a command; dayhand help <topic> for a topic."),
    ".SH JSON OUTPUT",
    roff("--json (or DAYHAND_FORMAT=json) prints the MCP tool's structuredContent exactly as an MCP client receives it. Fields may be added in a minor version; they are never removed or retyped within a major version. Errors go to standard error as one line: {\"error\":{\"code\",\"message\",\"exitCode\",\"retryable\",\"clientId\",...}}; standard output then stays empty. --plain prints tab-separated rows without headers."),
    ".PP",
    roff("Project fields and human name resolution: see docs/cli.md, JSON output and Human output."),
    ".SH EXIT STATUS",
    ...EXIT_CODES.flatMap(([code, meaning]) => [".TP", `.B ${code}`, roff(meaning)]),
    ".SH ENVIRONMENT",
    ...ENVIRONMENT.flatMap(([name, meaning]) => [".TP", `.B ${roff(name)}`, roff(meaning)]),
  );
  for (const [name, text] of Object.entries(TOPICS)) {
    lines.push(`.SH ${name.toUpperCase()}`, roff(`dayhand help ${name}`), ".PP", ...block(text));
  }
  lines.push(
    ".SH EXAMPLES",
    ...block(
      [
        "dayhand login --url https://<deployment>.convex.site",
        'dayhand add Call the accountant --due "fri 2pm" -l home',
        "dayhand list --due-before eow --json",
        "dayhand done 42",
        "dayhand pair",
        "source <(dayhand completion bash)",
      ].join("\n"),
    ),
    ".SH SEE ALSO",
    roff("docs/cli.md and docs/schemas/ in the Dayhand repository; dayhand help dates | config | login | completion."),
    "",
  );
  return lines.join("\n");
}
