// The command registry is the single source of truth for the commander
// program, `--help`, docs/cli.md and the coverage tests (and, in batch 2,
// shell completion). A command is data plus a run function.
import type { Env, Format } from "../config/env.js";
import type { Io } from "../core/io.js";
import type { Output } from "../core/output.js";
import type { View } from "../render/views.js";
import type { HelmClient } from "../transport/client.js";

export type ArgSpec = { name: string; description: string; required?: boolean; variadic?: boolean };

export type OptSpec = {
  /** Commander flags, e.g. "-l, --label <label>". */
  flags: string;
  description: string;
  /** "list": repeatable, collected into an array; "int": a whole number ≥ 0. */
  kind?: "list" | "int";
  choices?: string[];
};

/** What `--fields` narrows: task objects anywhere in the result, or the settings keys. */
export type FieldsKind = "task" | "settings";

export type RunContext = {
  io: Io;
  env: Env;
  out: Output;
  format: Format;
  fields?: string[];
  yes: boolean;
  /** Prompts are allowed: stdin and stdout are terminals and --no-input / HLM_NO_INPUT are off. */
  interactive: boolean;
  client(): Promise<HelmClient>;
  /** The operation id: --client-id, or one generated per run and reported on errors. */
  clientId(): string;
  confirm(question: string): Promise<boolean>;
};

export type Outcome = { value: unknown; view: View };

export type Args = Record<string, string | string[] | undefined>;
export type Opts = Record<string, unknown>;

export type CommandSpec = {
  name: string;
  aliases?: string[];
  summary: string;
  description?: string;
  args?: ArgSpec[];
  options?: OptSpec[];
  /** MCP tools (or "/devices…" endpoints) the command calls; drives the coverage test and docs. */
  tools: string[];
  fields?: FieldsKind;
  /**
   * Files in docs/schemas its --json output follows; a command whose output
   * depends on its arguments lists each. Several tasks: results.schema.json.
   */
  schema?: string | string[];
  examples?: string[];
  subcommands?: CommandSpec[];
  run?: (ctx: RunContext, args: Args, opts: Opts) => Promise<Outcome>;
};
