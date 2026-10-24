// Commands that mostly run locally: the date preview and shell completion scripts.
import { SHELLS, completionScript, type Shell } from "../completion/scripts.js";
import { CliError, usageError } from "../core/exit.js";
import { formatDay } from "../render/format.js";
import { isTimezone, localAt } from "../when/calendar.js";
import { dateError, parseWhen, relativeDay, WhenError, type When } from "../when/parse.js";
import type { CommandSpec, Opts, RunContext } from "./types.js";

/** --timezone, else the server settings; without a configured server, this computer's zone (with a warning). */
async function previewZone(ctx: RunContext, opts: Opts): Promise<string> {
  if (opts.timezone !== undefined) {
    if (!isTimezone(String(opts.timezone))) throw usageError("Not an IANA time zone (e.g. Europe/London)");
    return String(opts.timezone);
  }
  try {
    return await ctx.zone();
  } catch (error) {
    if (!(error instanceof CliError) || (error.code !== "usage" && error.code !== "unauthenticated")) throw error;
    const local = Intl.DateTimeFormat().resolvedOptions().timeZone;
    ctx.out.warn({ code: "local_timezone", message: `Not signed in, so using this computer's time zone (${local}); --timezone sets one` });
    return local;
  }
}

function referenceTime(opts: Opts): number {
  if (opts.now === undefined) return Date.now();
  const text = String(opts.now);
  const ms = Date.parse(text);
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(text) || !Number.isFinite(ms)) {
    throw usageError("--now takes an ISO 8601 moment, e.g. 2026-10-22T10:00:00Z");
  }
  return ms;
}

const when: CommandSpec = {
  name: "when",
  schema: "when.schema.json",
  summary: "Show the day (and time) a date phrase means in your time zone, without changing anything",
  args: [{ name: "phrase", description: "A date phrase, e.g. fri 14:00 (quotes optional)", required: true, variadic: true }],
  options: [
    { flags: "--timezone <zone>", description: "IANA time zone to resolve in (default: yours from the server settings)" },
    { flags: "--now <moment>", description: "Resolve as if it were this moment (ISO 8601) instead of now" },
  ],
  tools: ["get_settings"],
  examples: ['dayhand when "fri 14:00"', "dayhand when next mon --json", 'dayhand when "in 2 hours" --timezone America/New_York'],
  run: async (ctx, args, opts) => {
    const timezone = await previewZone(ctx, opts);
    const now = referenceTime(opts);
    let found: When;
    try {
      found = parseWhen((args.phrase as string[]).join(" "), { now, timezone });
    } catch (error) {
      if (error instanceof WhenError) throw dateError(error);
      throw error;
    }
    const today = localAt(now, timezone).date;
    const relative = relativeDay(found.date, today);
    const value = {
      date: found.date,
      time: found.time ?? null,
      timezone,
      weekday: formatDay(found.date).slice(0, 3),
      relative,
      ...(found.shiftedFrom ? { shiftedFrom: found.shiftedFrom } : {}),
    };
    const lines = [`${formatDay(found.date)}${found.time ? ` ${found.time}` : ""} (${timezone}), ${relative}`];
    if (found.shiftedFrom) lines.push(`${found.shiftedFrom} does not exist that day (the clocks go forward); ${found.time} is used`);
    return { value, view: { kind: "text", text: lines.join("\n") } };
  },
};

const completion: CommandSpec = {
  name: "completion",
  schema: "completion.schema.json",
  summary: "Print the shell completion script for bash, zsh, fish or powershell (dayhand help completion)",
  args: [{ name: "shell", description: SHELLS.join(", "), required: true }],
  tools: [],
  examples: ["source <(dayhand completion bash)", 'dayhand completion zsh > "${fpath[1]}/_dayhand"', "dayhand completion powershell | Out-String | Invoke-Expression"],
  run: async (_ctx, args) => {
    const shell = String(args.shell).toLowerCase();
    if (!(SHELLS as readonly string[]).includes(shell)) throw usageError("Unknown shell", { valid: [...SHELLS] });
    const script = completionScript(shell as Shell);
    return { value: { shell, script }, view: { kind: "text", text: script } };
  },
};

export const localCommands: CommandSpec[] = [when, completion];
