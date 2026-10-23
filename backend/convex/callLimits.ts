// Limits on MCP calls per API key or agent connection (OAuth): a fixed
// one-minute window that starts at the first call, separately for reads and writes. A call over the limit is
// refused before it runs and says when to try again.
import { v, type Infer } from "convex/values";
import type { Id } from "./_generated/dataModel";
import { internalMutation, type MutationCtx } from "./_generated/server";

export const CALL_WINDOW_MS = 60 * 1000;
export const CALL_LIMITS = { read: 120, write: 60 } as const;

const kindValidator = v.union(v.literal("read"), v.literal("write"));
export type CallKind = Infer<typeof kindValidator>;

export type CallAllowance = { ok: true } | { ok: false; limit: number; retryAfterMs: number };

type Subject = { keyId?: Id<"apiKeys">; connectionId?: Id<"oauthGrants"> };

/** The counters of one key or one connection, of one kind or of both. */
function rowsOf(ctx: MutationCtx, { keyId, connectionId }: Subject, kind?: CallKind) {
  if (keyId) {
    return ctx.db.query("callLimits").withIndex("by_key_kind", (q) => (kind ? q.eq("keyId", keyId).eq("kind", kind) : q.eq("keyId", keyId)));
  }
  return ctx.db
    .query("callLimits")
    .withIndex("by_connection_kind", (q) => (kind ? q.eq("connectionId", connectionId).eq("kind", kind) : q.eq("connectionId", connectionId)));
}

const subjectArgs = { keyId: v.optional(v.id("apiKeys")), connectionId: v.optional(v.id("oauthGrants")) };

/** Counts one call of `kind` with the key or connection (exactly one of them); refused calls are not counted. */
export const consume = internalMutation({
  args: { ...subjectArgs, kind: kindValidator },
  handler: async (ctx, { keyId, connectionId, kind }): Promise<CallAllowance> => {
    if (!keyId === !connectionId) throw new Error("consume needs exactly one of keyId and connectionId");
    const subject = keyId ? { keyId } : { connectionId };
    const now = Date.now();
    const limit = CALL_LIMITS[kind];
    const row = await rowsOf(ctx, subject, kind).unique();
    if (!row) {
      await ctx.db.insert("callLimits", { ...subject, kind, windowStart: now, calls: 1 });
      return { ok: true };
    }
    if (now - row.windowStart >= CALL_WINDOW_MS) {
      await ctx.db.patch(row._id, { windowStart: now, calls: 1 });
      return { ok: true };
    }
    if (row.calls >= limit) return { ok: false, limit, retryAfterMs: row.windowStart + CALL_WINDOW_MS - now };
    await ctx.db.patch(row._id, { calls: row.calls + 1 });
    return { ok: true };
  },
});

/**
 * Clears a key's or a connection's counters, e.g. after a runaway agent:
 * `npx convex run callLimits:reset '{"keyId":"…"}'` (or `'{"connectionId":"…"}'`).
 */
export const reset = internalMutation({
  args: subjectArgs,
  handler: async (ctx, { keyId, connectionId }) => {
    if (!keyId === !connectionId) throw new Error("reset needs exactly one of keyId and connectionId");
    const rows = await rowsOf(ctx, keyId ? { keyId } : { connectionId }).collect();
    for (const row of rows) await ctx.db.delete(row._id);
  },
});
