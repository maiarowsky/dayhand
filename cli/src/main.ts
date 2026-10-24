// Builds the commander program from the registry, runs one command and turns
// every outcome into output plus an exit code. Never prompts without a TTY.
import { Command, CommanderError, InvalidArgumentError, Option } from "commander";
import { expandAlias } from "./config/aliases.js";
import { envFormat, normalizeEnv, type Format, type Warning } from "./config/env.js";
import { EXIT, toCliError, usageError } from "./core/exit.js";
import { processIo, type Io } from "./core/io.js";
import { Output } from "./core/output.js";
import { CLI_VERSION } from "./core/version.js";
import { ROOT_HELP, commandHelp } from "./help.js";
import { COMMANDS } from "./registry/index.js";
import { parseInt0 } from "./registry/parse.js";
import type { Args, CommandSpec, OptSpec } from "./registry/types.js";
import { execute, type GlobalOpts } from "./run.js";
import { loadSetup, type Setup } from "./setup.js";
import { GLOBAL_OPTIONS, VALUE_OPTIONS } from "./globals.js";
import { TOPICS } from "./topics.js";

export { GLOBAL_OPTIONS };

/** The old name of the command, still installed for a while (bin/hlm.ts). */
export const OLD_COMMAND: Warning = { code: "deprecated_command", message: "hlm is now called dayhand (short: dh); the hlm command goes away in 1.0" };

export async function main(argv: string[], given: Io = processIo(), warnings: Warning[] = []): Promise<number> {
  const normalized = normalizeEnv(given.env);
  const io: Io = { ...given, env: normalized.env };
  if (argv[0] === "__complete") {
    const { completeCommand } = await import("./completion/engine.js");
    return completeCommand(argv.slice(1), io);
  }
  const setup = loadSetup(io);
  const early = new Output(io, earlyFormat(argv, io));
  for (const warning of [...warnings, ...normalized.warnings, ...(setup.paths.warning ? [setup.paths.warning] : [])]) early.warn(warning);
  let run: Promise<number> | undefined;
  const program = buildProgram(io, setup, (promise) => (run = promise));
  try {
    const expanded = expandAlias(argv, setup.aliases, VALUE_OPTIONS);
    await program.parseAsync(withDefaultCommand(expanded), { from: "user" });
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

/** `dayhand` alone (or with only global options) shows Today. */
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

function buildProgram(io: Io, setup: Setup, started: (run: Promise<number>) => void): Command {
  const program = new Command("dayhand")
    .description("Dayhand from the terminal: the same operations the app and the agent use")
    .version(CLI_VERSION, "-V, --version", "Print the CLI version")
    .helpOption("-h, --help", "Show help")
    .helpCommand(false)
    .addHelpText("after", ROOT_HELP);
  for (const spec of GLOBAL_OPTIONS) program.addOption(toOption(spec));
  configure(program, io, []);
  for (const spec of COMMANDS) program.addCommand(toCommand(spec, io, setup, started, []));
  program.addCommand(helpCommand(program, io));
  return program;
}

/** `dayhand help [command…]` prints a command's help; `dayhand help <topic>` a topic (dates, config, …). */
function helpCommand(program: Command, io: Io): Command {
  const topics = Object.keys(TOPICS);
  const command = new Command("help")
    .description(`Help for a command, or a topic: ${topics.join(", ")}`)
    .argument("[words...]", "Command or topic")
    .action((words: string[]) => {
      if (words.length === 1 && Object.hasOwn(TOPICS, words[0]!)) {
        io.stdout.write(TOPICS[words[0]!]!.trimEnd() + "\n");
        return;
      }
      let target: Command = program;
      for (const word of words) {
        const sub = target.commands.find((c) => c.name() === word || c.aliases().includes(word));
        if (!sub) throw usageError("No such command or help topic", { valid: [...new Set([...topics, ...program.commands.map((c) => c.name())])] });
        target = sub;
      }
      target.outputHelp();
    });
  configure(command, io, []);
  return command;
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

function toCommand(spec: CommandSpec, io: Io, setup: Setup, started: (run: Promise<number>) => void, parents: string[]): Command {
  const path = [...parents, spec.name];
  const command = new Command(spec.name).description(spec.summary).aliases(spec.aliases ?? []);
  for (const arg of spec.args ?? []) {
    const name = `${arg.name}${arg.variadic ? "..." : ""}`;
    command.argument(arg.required ? `<${name}>` : `[${name}]`, arg.description);
  }
  for (const option of spec.options ?? []) command.addOption(toOption(option));
  command.addHelpText("after", commandHelp(spec));
  configure(command, io, spec.options ?? []);
  for (const sub of spec.subcommands ?? []) command.addCommand(toCommand(sub, io, setup, started, path));
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
      started(execute(io, setup, spec, path.join(" "), args, opts, self.optsWithGlobals<GlobalOpts>()));
    });
  }
  return command;
}
