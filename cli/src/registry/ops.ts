// Helpers the commands share: calling a tool for its structured result and
// applying one change to several tasks safely.
import { CliError, usageError } from "../core/exit.js";
import { resolveRef } from "./parse.js";
import type { RunContext } from "./types.js";

/** From this many tasks on, a change needs --yes (or a yes at a prompt). */
export const BULK_THRESHOLD = 3;

export async function tool<T = Record<string, unknown>>(ctx: RunContext, name: string, args: Record<string, unknown> = {}): Promise<T> {
  const result = await (await ctx.client()).callTool(name, args);
  return (result.structured ?? {}) as T;
}

/** The user's time zone, for timestamps in human output only (one extra read). */
export async function userTimezone(ctx: RunContext): Promise<string | undefined> {
  if (ctx.format !== "human") return undefined;
  return ctx.zone();
}

export async function confirmBulk(ctx: RunContext, count: number, verb: string): Promise<void> {
  if (count < BULK_THRESHOLD || ctx.yes) return;
  if (!ctx.interactive) {
    throw usageError(`Refusing to ${verb} ${count} tasks without --yes`, { hint: `hlm ${verb} <ref>... --yes` });
  }
  if (!(await ctx.confirm(`${capitalize(verb)} ${count} tasks?`))) throw usageError("Cancelled; nothing was changed");
}

/**
 * Applies `change` to each task reference in order and stops at the first
 * error. Each task gets its own clientId derived from the run's, so retrying
 * the same command line with the same --client-id applies nothing twice.
 */
export async function eachRef<T>(
  ctx: RunContext,
  refs: string[],
  verb: string,
  change: (taskId: string, clientId: string) => Promise<T>,
): Promise<T[]> {
  await confirmBulk(ctx, refs.length, verb);
  const base = ctx.clientId();
  const results: T[] = [];
  for (const [index, raw] of refs.entries()) {
    try {
      results.push(await change(await resolveRef(ctx, raw), refs.length === 1 ? base : `${base}:${index + 1}`));
    } catch (error) {
      throw error instanceof CliError && refs.length > 1 ? error.with({ ref: raw }) : error;
    }
  }
  return results;
}

/** One result as the tool returned it; several as `{ results: [...] }`. */
export const oneOrMany = <T>(results: T[]): T | { results: T[] } => (results.length === 1 ? results[0]! : { results });

const capitalize = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);
