// Fixed-window counters in the authLimits table, one row per bucket, for the
// OAuth endpoints (pairing keeps its own counter in devices.ts). A bucket is
// full when `limit` hits fall into the current window.
import type { MutationCtx } from "../_generated/server";

export type Limit = { bucket: string; limit: number; windowMs: number };

async function row(ctx: MutationCtx, bucket: string) {
  return ctx.db
    .query("authLimits")
    .withIndex("by_bucket", (q) => q.eq("bucket", bucket))
    .unique();
}

/** Milliseconds until the bucket accepts hits again; null when it is not full. */
export async function retryAfter(ctx: MutationCtx, { bucket, limit, windowMs }: Limit, now: number): Promise<number | null> {
  const current = await row(ctx, bucket);
  if (!current || now - current.windowStart >= windowMs || current.failures < limit) return null;
  return current.windowStart + windowMs - now;
}

/** Counts one hit (a failure, or a creation) in the bucket's current window. */
export async function countHit(ctx: MutationCtx, { bucket, windowMs }: Limit, now: number) {
  const current = await row(ctx, bucket);
  if (!current) await ctx.db.insert("authLimits", { bucket, windowStart: now, failures: 1 });
  else if (now - current.windowStart >= windowMs) await ctx.db.patch(current._id, { windowStart: now, failures: 1 });
  else await ctx.db.patch(current._id, { failures: current.failures + 1 });
}

/** Empties a bucket (admin, after someone filled it on purpose). */
export async function resetBucket(ctx: MutationCtx, bucket: string) {
  const current = await row(ctx, bucket);
  if (current) await ctx.db.delete(current._id);
}
