// The command registry is the single source of truth for the commander
// program, `--help`, docs/cli.md, shell completion and the coverage tests. A command is data plus a run function.
import type { Env, Format } from "../config/env.js";
import type { Config } from "../config/file.js";
import type { Paths } from "../config/paths.js";
import type { Target } from "../config/resolve.js";
import type { Io } from "../core/io.js";
import type { Output } from "../core/output.js";
import type { KeyStore } from "../credentials/store.js";
import type { View } from "../render/views.js";
import type { HelmClient } from "../transport/client.js";
import type { When } from "../when/parse.js";

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
  /** --dry-run: changes are recorded and printed instead of sent. */
  dryRun: boolean;
  /** Prompts are allowed: stdin and stdout are terminals and --no-input / HLM_NO_INPUT are off. */
  interactive: boolean;
  paths: Paths;
  /** --url and --profile as given. */
  flags: { url?: string; profile?: string };
  /** config.toml (throws when the file is broken). */
  config(): Config;
  /** The deployment URL and where it came from, without needing a key. */
  target(): Target;
  /** The stores `hlm login` writes to, in reading order. */
  keyStores(): KeyStore[];
  client(): Promise<HelmClient>;
  /** A client for a key that is not stored yet (`hlm login` checks it first). */
  clientFor(url: string, key: string): HelmClient;
  /** The operation id: --client-id, or one generated per run and reported on errors. */
  clientId(): string;
  /** The user's time zone from the server settings (one read, shared). */
  zone(): Promise<string>;
  /** A date phrase ("fri 14:00") resolved in the user's time zone; a usage error when not understood. */
  when(text: string): Promise<When>;
  confirm(question: string): Promise<boolean>;
  prompt(question: string, hidden?: boolean): Promise<string>;
  /** Opens $VISUAL/$EDITOR on the text (only on a terminal) and returns what was saved. */
  edit(initial: string, fileName: string): string;
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
  /** false: the command changes local files only, so --dry-run is refused rather than ignored. */
  dryRun?: false;
  subcommands?: CommandSpec[];
  run?: (ctx: RunContext, args: Args, opts: Opts) => Promise<Outcome>;
};
