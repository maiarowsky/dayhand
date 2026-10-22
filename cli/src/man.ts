// Renders man/hlm.1 (roff) from the registry (npm run docs); a test checks the
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
    '.TH HLM 1 "" "hlm" "User Commands"',
    ".SH NAME",
    "hlm \\- the Helm command line client for people and agents",
    ".SH SYNOPSIS",
    ".B hlm",
    "[\\fIcommand\\fR] [\\fIarguments\\fR] [\\fIoptions\\fR]",
    ".SH DESCRIPTION",
    roff("hlm reads and changes a Helm task list. Every command is one or more calls of the MCP tools the agent uses on the same /mcp endpoint; hlm call reaches any tool directly. Without a command, hlm shows Today."),
    ".PP",
    roff("Task references: #42 or 42 (the task number), now (the now task) or the task id."),
    ".SH COMMANDS",
  ];
  for (const { path, spec } of commands) {
    lines.push(".TP", `.B hlm ${roff(path)}${spec.args?.length ? ` ${roff(args(spec))}` : ""}`, roff(spec.summary));
    if (spec.aliases?.length) lines.push(".br", roff(`Aliases: ${spec.aliases.join(", ")}.`));
    if (spec.description) lines.push(".br", roff(spec.description));
    if (spec.options?.length) lines.push(".RS", ...spec.options.flatMap(option), ".RE");
  }
  lines.push(
    ".SH GLOBAL OPTIONS",
    roff("Valid before or after the command."),
    ...GLOBAL_OPTIONS.flatMap(option),
    ".TP",
    ".B \\-V, \\-\\-version",
    "Print the CLI version.",
    ".TP",
    ".B \\-h, \\-\\-help",
    roff("Help for hlm or for a command; hlm help <topic> for a topic."),
    ".SH JSON OUTPUT",
    roff("--json (or HLM_FORMAT=json) prints the MCP tool's structuredContent exactly as an MCP client receives it. Fields may be added in a minor version; they are never removed or retyped within a major version. Errors go to standard error as one line: {\"error\":{\"code\",\"message\",\"exitCode\",\"retryable\",\"clientId\",...}}; standard output then stays empty. --plain prints tab-separated rows without headers."),
    ".SH EXIT STATUS",
    ...EXIT_CODES.flatMap(([code, meaning]) => [".TP", `.B ${code}`, roff(meaning)]),
    ".SH ENVIRONMENT",
    ...ENVIRONMENT.flatMap(([name, meaning]) => [".TP", `.B ${roff(name)}`, roff(meaning)]),
  );
  for (const [name, text] of Object.entries(TOPICS)) {
    lines.push(`.SH ${name.toUpperCase()}`, roff(`hlm help ${name}`), ".PP", ...block(text));
  }
  lines.push(
    ".SH EXAMPLES",
    ...block(
      [
        "hlm login --url https://<deployment>.convex.site",
        'hlm add Call the accountant --due "fri 2pm" -l home',
        "hlm list --due-before eow --json",
        "hlm done 42",
        "hlm pair",
        "source <(hlm completion bash)",
      ].join("\n"),
    ),
    ".SH SEE ALSO",
    roff("docs/cli.md and docs/schemas/ in the Helm repository; hlm help dates | config | login | completion."),
    "",
  );
  return lines.join("\n");
}
