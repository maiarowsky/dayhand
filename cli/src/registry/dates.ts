// Due dates from the command line. The server's own forms (YYYY-MM-DD, today,
// tomorrow) are sent unchanged, so the request is the same as an agent's;
// any other phrase ("fri 14:00", "in 3 days") is resolved here, in the user's
// time zone from the server settings, and sent as YYYY-MM-DD and HH:MM.
import { usageError } from "../core/exit.js";
import type { When } from "../when/parse.js";
import type { RunContext } from "./types.js";

const SERVER_FORMS = /^(\d{4}-\d{2}-\d{2}|today|tomorrow)$/i;

export async function resolveDue(ctx: RunContext, text: string): Promise<When> {
  const trimmed = text.trim();
  // A dry run shows the real day, so it resolves even the server's forms.
  if (SERVER_FORMS.test(trimmed) && !ctx.dryRun) return { date: trimmed };
  const when = await ctx.when(trimmed);
  if (when.shiftedFrom) {
    ctx.out.warn({
      code: "time_shifted",
      message: `${when.shiftedFrom} does not exist on ${when.date} in your time zone (the clocks go forward); using ${when.time}`,
    });
  }
  return when;
}

/**
 * Sets dueDate (and dueTime from the phrase) on tool arguments. A phrase with
 * a time cannot be combined with --time or --clear-time.
 */
export async function applyDue(
  ctx: RunContext,
  input: Record<string, unknown>,
  text: string,
  opts: { time?: unknown; clearTime?: unknown },
): Promise<void> {
  const due = await resolveDue(ctx, text);
  input.dueDate = due.date;
  if (due.time === undefined) return;
  if (opts.time !== undefined || opts.clearTime) throw usageError("The date already has a time; drop --time/--clear-time or the time in the date");
  input.dueTime = due.time;
}
