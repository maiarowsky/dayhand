// Limits on MCP calls per API key: a fixed one-minute window that starts at
// the first call, separately for reads and writes. A call over the limit is
// refused before it runs and says when to try again.
import { v, type Infer } from "convex/values";
import { internalMutation } from "./_generated/server";

export const CALL_WINDOW_MS = 60 * 1000;
export const CALL_LIMITS = { read: 120, write: 60 } as const;

const kindValidator = v.union(v.literal("read"), v.literal("write"));
export type CallKind = Infer<typeof kindValidator>;

export type CallAllowance = { ok: true } | { ok: false; limit: number; retryAfterMs: number };

/** Counts one call of `kind` with the key; refused calls are not counted. */
export const consume = internalMutation({
  args: { keyId: v.id("apiKeys"), kind: kindValidator },
  handler: async (ctx, { keyId, kind }): Promise<CallAllowance> => {
    const now = Date.now();
    const limit = CALL_LIMITS[kind];
    const row = await ctx.db
      .query("callLimits")
      .withIndex("by_key_kind", (q) => q.eq("keyId", keyId).eq("kind", kind))
      .unique();
    if (!row) {
      await ctx.db.insert("callLimits", { keyId, kind, windowStart: now, calls: 1 });
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

/** Clears a key's counters, e.g. after a runaway agent: `npx convex run callLimits:reset '{"keyId":"…"}'`. */
export const reset = internalMutation({
  args: { keyId: v.id("apiKeys") },
  handler: async (ctx, { keyId }) => {
    const rows = await ctx.db
      .query("callLimits")
      .withIndex("by_key_kind", (q) => q.eq("keyId", keyId))
      .collect();
    for (const row of rows) await ctx.db.delete(row._id);
  },
});
