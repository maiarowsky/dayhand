// Runs one command: builds its context (connection, config, dates, prompts),
// prints the result in the chosen format, and maps any failure to its exit code.
import { randomUUID } from "node:crypto";
import { envFlag, envFormat, type Format } from "./config/env.js";
import type { Config } from "./config/file.js";
import { resolveConnection, resolveTarget } from "./config/resolve.js";
import { editText } from "./core/editor.js";
import { EXIT, toCliError, usageError } from "./core/exit.js";
import type { Io } from "./core/io.js";
import { Output } from "./core/output.js";
import { ask, askHidden, confirm } from "./core/prompt.js";
import { credentialStores, keyStores } from "./credentials/index.js";
import { parseFields, projectFields } from "./fields.js";
import type { Args, CommandSpec, RunContext } from "./registry/types.js";
import { colorEnabled, makeStyle } from "./render/style.js";
import { renderDryRun, renderHuman, renderPlain, type View } from "./render/views.js";
import type { Setup } from "./setup.js";
import { DayhandClient, type HeldCall } from "./transport/client.js";
import { localAt } from "./when/calendar.js";
import { dateError, parseWhen, WhenError } from "./when/parse.js";

export type GlobalOpts = {
  json?: boolean;
  plain?: boolean;
  fields?: string;
  clientId?: string;
  approval?: string;
  yes?: boolean;
  input?: boolean;
  dryRun?: boolean;
  url?: string;
  profile?: string;
  color?: "auto" | "always" | "never" | false;
};

const CLIENT_ID = /^[\x21-\x7e]{1,120}$/;

export async function execute(io: Io, setup: Setup, spec: CommandSpec, name: string, args: Args, opts: Record<string, unknown>, global: GlobalOpts): Promise<number> {
  let out = new Output(io, global.json ? "json" : "human");
  let usedClientId: string | undefined;
  const held: HeldCall[] | undefined = global.dryRun ? [] : undefined;
  try {
    const format = resolveFormat(global, io);
    out = new Output(io, format);
    if (held && spec.dryRun === false) throw usageError(`--dry-run is not supported by dayhand ${name}`);
    const fields = parseFields(global.fields, spec.fields, name);
    if (global.clientId !== undefined && !CLIENT_ID.test(global.clientId)) {
      throw usageError("--client-id must be 1 to 120 printable characters without spaces");
    }
    const ctx = context(io, setup, global, { format, out, fields, held }, (id) => (usedClientId = id));
    // Human output shows days relative to the user's today: fetch the time zone alongside the command.
    const zone = format === "human" && spec.fields === "task" && !held ? ctx.zone().catch(() => undefined) : undefined;
    const outcome = await spec.run!(ctx, args, opts);
    if (held?.length) {
      if (format === "json") out.json({ dryRun: true, calls: held });
      else out.text(renderDryRun(held, format));
      return EXIT.ok;
    }
    if (outcome.printed) return EXIT.ok;
    const value = fields && spec.fields ? projectFields(outcome.value, spec.fields, fields) : outcome.value;
    if (format === "json") out.json(value);
    else if (format === "plain") out.text(renderPlain(outcome.view, value, fields));
    else out.text(renderHuman(outcome.view, value, fields, { ...humanOptions(io, setup, global), today: todayFor(outcome.view, await zone) }));
    return EXIT.ok;
  } catch (error) {
    let failure = toCliError(error);
    if (usedClientId && failure.details.clientId === undefined) failure = failure.with({ clientId: usedClientId });
    out.error(failure);
    return failure.exitCode;
  }
}

type Chosen = { format: Format; out: Output; fields?: string[]; held?: HeldCall[] };

function context(io: Io, setup: Setup, global: GlobalOpts, { format, out, fields, held }: Chosen, onClientId: (id: string) => void): RunContext {
  const flags = { url: global.url, profile: global.profile };
  const warn = out.warn.bind(out);
  let client: Promise<DayhandClient> | undefined;
  let zone: Promise<string> | undefined;
  let clientId: string | undefined;
  const ctx: RunContext = {
    io,
    env: io.env,
    out,
    format,
    fields,
    flags,
    paths: setup.paths,
    yes: Boolean(global.yes),
    dryRun: Boolean(held),
    interactive: Boolean(io.stdin.isTTY && io.stdout.isTTY) && global.input !== false && !envFlag(io.env, "DAYHAND_NO_INPUT"),
    config: () => setup.config(),
    target: () => resolveTarget(flags, io.env, setup.config(), warn),
    keyStores: () => keyStores(io.env, setup.paths.configDir, warn),
    client: () =>
      (client ??= resolveConnection(flags, io.env, setup.config(), warn, credentialStores(io.env, setup.paths.configDir, warn)).then(
        (connection) => new DayhandClient(connection, io.fetch, held, undefined, global.approval),
      )),
    clientFor: (url, key) => new DayhandClient({ url, key }, io.fetch),
    clientId: () => {
      if (clientId === undefined) onClientId((clientId = global.clientId ?? randomUUID()));
      return clientId;
    },
    zone: () =>
      (zone ??= ctx
        .client()
        .then((c) => c.callTool("get_settings"))
        .then((r) => (r.structured as { timezone?: string } | undefined)?.timezone ?? "Europe/London")),
    when: async (text) => {
      try {
        return parseWhen(text, { now: Date.now(), timezone: await ctx.zone() });
      } catch (error) {
        if (error instanceof WhenError) throw dateError(error);
        throw error;
      }
    },
    color: () => humanOptions(io, setup, global).style.enabled,
    confirm: (question) => confirm(io, question),
    prompt: (question, hidden) => (hidden ? askHidden(io, question) : ask(io, question)),
    edit: (initial, fileName) => editText(io.env, initial, fileName),
  };
  return ctx;
}

function humanOptions(io: Io, setup: Setup, global: GlobalOpts) {
  let configured: Config["color"];
  try {
    configured = setup.config().color;
  } catch {
    configured = undefined; // a broken config.toml is reported by the commands that read it
  }
  const enabled = colorEnabled({ flag: global.color, config: configured, env: io.env, isTTY: io.stdout.isTTY });
  return { style: makeStyle(enabled), width: io.stdout.isTTY ? (io.stdout.columns ?? 80) : undefined };
}

function todayFor(view: View, zone: string | undefined): string | undefined {
  if (view.kind === "today") return view.view.date;
  return zone ? localAt(Date.now(), zone).date : undefined;
}

function resolveFormat(global: GlobalOpts, io: Io): Format {
  if (global.json && global.plain) throw usageError("Use either --json or --plain");
  if (global.json) return "json";
  if (global.plain) return "plain";
  return envFormat(io.env) ?? "human";
}
