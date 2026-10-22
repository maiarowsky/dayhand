// Builds the commander program from the registry, runs one command and turns
// every outcome into output plus an exit code. Never prompts without a TTY.
import { randomUUID } from "node:crypto";
import { createInterface } from "node:readline/promises";
import { Command, CommanderError, InvalidArgumentError, Option } from "commander";
import { envFlag, envFormat, type Format } from "./config/env.js";
import { resolveConnection } from "./config/resolve.js";
import { CliError, EXIT, usageError } from "./core/exit.js";
import { processIo, type Io } from "./core/io.js";
import { Output } from "./core/output.js";
import { CLI_VERSION } from "./core/version.js";
import { parseFields, projectFields } from "./fields.js";
import { ROOT_HELP, commandHelp } from "./help.js";
import { COMMANDS } from "./registry/index.js";
import { parseInt0 } from "./registry/parse.js";
import type { Args, CommandSpec, OptSpec, RunContext } from "./registry/types.js";
import { renderHuman, renderPlain } from "./render/views.js";
import { HelmClient } from "./transport/client.js";

/** Global options: valid before or after the command. Value-taking ones are listed for argv scanning. */
export const GLOBAL_OPTIONS: OptSpec[] = [
  { flags: "--json", description: "Print the tool's structuredContent as JSON; errors as JSON on stderr" },
  { flags: "--plain", description: "Tab-separated text without headers (for scripts)" },
  { flags: "--fields <names>", description: "Comma-separated task (or settings) fields for JSON and columns" },
  { flags: "--client-id <id>", description: "Operation id for safe retries (default: generated, shown on errors)" },
  { flags: "-y, --yes", description: `Confirm changing many tasks at once` },
  { flags: "--no-input", description: "Never prompt (also HLM_NO_INPUT=1); prompts need a terminal anyway" },
  { flags: "--url <url>", description: "Deployment HTTP actions URL (default: HLM_URL)" },
];
const VALUE_OPTIONS = new Set(["--fields", "--client-id", "--url"]);
const CLIENT_ID = /^[\x21-\x7e]{1,120}$/;

type GlobalOpts = { json?: boolean; plain?: boolean; fields?: string; clientId?: string; yes?: boolean; input?: boolean; url?: string };

export async function main(argv: string[], io: Io = processIo()): Promise<number> {
  const early = new Output(io, earlyFormat(argv, io));
  let run: Promise<number> | undefined;
  const program = buildProgram(io, (promise) => (run = promise));
  try {
    await program.parseAsync(withDefaultCommand(argv), { from: "user" });
    return run ? await run : EXIT.ok;
  } catch (error) {
    if (error instanceof CommanderError) {
      if (error.exitCode === 0) return EXIT.ok; // --help, --version
      if (error.code === "commander.help") {
        early.error(usageError("Missing command (help printed above)"));
        return EXIT.usage;
      }
      const valid = (error as { valid?: string[] }).valid;
      early.error(usageError(error.message.replace(/^error: /, ""), valid ? { valid } : {}));
      return EXIT.usage;
    }
    const failure = toCliError(error);
    early.error(failure);
    return failure.exitCode;
  }
}

/** `hlm` alone (or with only global options) shows Today. */
function withDefaultCommand(argv: string[]): string[] {
  if (argv.some((a) => a === "-h" || a === "--help" || a === "-V" || a === "--version")) return argv;
  for (let i = 0; i < argv.length; i++) {
    if (VALUE_OPTIONS.has(argv[i]!)) i++;
    else if (!argv[i]!.startsWith("-")) return argv;
  }
  return [...argv, "today"];
}

/** The format for errors found before a command runs (bad flags). */
function earlyFormat(argv: string[], io: Io): Format {
  if (argv.includes("--json")) return "json";
  try {
    return envFormat(io.env) ?? "human";
  } catch {
    return "human";
  }
}

function toCliError(error: unknown): CliError {
  if (error instanceof CliError) return error;
  return new CliError("internal", `Unexpected error: ${error instanceof Error ? error.message : String(error)}`);
}

function buildProgram(io: Io, started: (run: Promise<number>) => void): Command {
  const program = new Command("hlm")
    .description("Helm from the terminal: the same operations the app and the agent use")
    .version(CLI_VERSION, "-V, --version", "Print the CLI version")
    .helpOption("-h, --help", "Show help")
    .addHelpText("after", ROOT_HELP);
  for (const spec of GLOBAL_OPTIONS) program.addOption(toOption(spec));
  configure(program, io, []);
  for (const spec of COMMANDS) program.addCommand(toCommand(spec, io, started, []));
  return program;
}

function configure(command: Command, io: Io, specOptions: OptSpec[]) {
  command
    .configureOutput({
      writeOut: (s) => io.stdout.write(s),
      writeErr: (s) => io.stderr.write(s),
      outputError: () => {}, // printed by main(), as text or JSON
    })
    .configureHelp({ showGlobalOptions: true })
    .exitOverride((error) => {
      if (error.code === "commander.unknownOption") {
        const valid = [...specOptions, ...GLOBAL_OPTIONS, { flags: "-h, --help" }].map((o) => longFlag(o.flags));
        throw Object.assign(error, { valid });
      }
      throw error;
    });
}

const longFlag = (flags: string) => flags.split(/[ ,]+/).find((f) => f.startsWith("--")) ?? flags;

function toOption(spec: OptSpec): Option {
  const option = new Option(spec.flags, spec.description);
  if (spec.choices) option.choices(spec.choices);
  if (spec.kind === "list") option.argParser((value: string, previous: string[] | undefined) => [...(previous ?? []), value]);
  if (spec.kind === "int") {
    option.argParser((value: string) => {
      try {
        return parseInt0(value);
      } catch (error) {
        throw new InvalidArgumentError((error as Error).message);
      }
    });
  }
  return option;
}

function toCommand(spec: CommandSpec, io: Io, started: (run: Promise<number>) => void, parents: string[]): Command {
  const path = [...parents, spec.name];
  const command = new Command(spec.name).description(spec.summary).aliases(spec.aliases ?? []);
  for (const arg of spec.args ?? []) {
    const name = `${arg.name}${arg.variadic ? "..." : ""}`;
    command.argument(arg.required ? `<${name}>` : `[${name}]`, arg.description);
  }
  for (const option of spec.options ?? []) command.addOption(toOption(option));
  command.addHelpText("after", commandHelp(spec));
  configure(command, io, spec.options ?? []);
  for (const sub of spec.subcommands ?? []) command.addCommand(toCommand(sub, io, started, path));
  const run = spec.run;
  if (run) {
    command.action((...actionArgs: unknown[]) => {
      const self = actionArgs.at(-1) as Command;
      const args: Args = {};
      (spec.args ?? []).forEach((arg, i) => (args[arg.name] = actionArgs[i] as string | string[] | undefined));
      const opts = self.opts();
      for (const option of spec.options ?? []) {
        const key = self.options.find((o) => o.flags === option.flags)!.attributeName();
        if (option.kind === "list" && opts[key] === undefined) opts[key] = [];
      }
      started(execute(io, spec, path.join(" "), args, opts, self.optsWithGlobals<GlobalOpts>()));
    });
  }
  return command;
}

async function execute(io: Io, spec: CommandSpec, name: string, args: Args, opts: Record<string, unknown>, global: GlobalOpts): Promise<number> {
  let out = new Output(io, global.json ? "json" : "human");
  let usedClientId: string | undefined;
  try {
    const format = resolveFormat(global, io);
    out = new Output(io, format);
    const fields = parseFields(global.fields, spec.fields, name);
    if (global.clientId !== undefined && !CLIENT_ID.test(global.clientId)) {
      throw usageError("--client-id must be 1 to 120 printable characters without spaces");
    }
    let client: Promise<HelmClient> | undefined;
    const ctx: RunContext = {
      io,
      env: io.env,
      out,
      format,
      fields,
      yes: Boolean(global.yes),
      interactive: Boolean(io.stdin.isTTY && io.stdout.isTTY) && global.input !== false && !envFlag(io.env, "HLM_NO_INPUT"),
      client: () =>
        (client ??= resolveConnection({ url: global.url }, io.env, (w) => out.warn(w)).then((c) => new HelmClient(c, io.fetch))),
      clientId: () => (usedClientId ??= global.clientId ?? randomUUID()),
      confirm: (question) => confirm(io, question),
    };
    const outcome = await spec.run!(ctx, args, opts);
    const value = fields && spec.fields ? projectFields(outcome.value, spec.fields, fields) : outcome.value;
    if (format === "json") out.json(value);
    else out.text(format === "plain" ? renderPlain(outcome.view, value, fields) : renderHuman(outcome.view, value, fields));
    return EXIT.ok;
  } catch (error) {
    let failure = toCliError(error);
    if (usedClientId && failure.details.clientId === undefined) failure = failure.with({ clientId: usedClientId });
    out.error(failure);
    return failure.exitCode;
  }
}

function resolveFormat(global: GlobalOpts, io: Io): Format {
  if (global.json && global.plain) throw usageError("Use either --json or --plain");
  if (global.json) return "json";
  if (global.plain) return "plain";
  return envFormat(io.env) ?? "human";
}

async function confirm(io: Io, question: string): Promise<boolean> {
  const rl = createInterface({ input: io.stdin, output: io.stderr as NodeJS.WritableStream });
  try {
    return /^y(es)?$/i.test((await rl.question(`${question} [y/N] `)).trim());
  } finally {
    rl.close();
  }
}
