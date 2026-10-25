// The dayhand.dev Worker. Static files are served from dist/ before this script runs (run_worker_first in
// wrangler.toml lists only /api/*), so it handles one thing: POST /api/waitlist, which adds an address to the
// Dayhand Cloud waitlist in D1. Answers are JSON with a message the page can show; internal errors stay in the
// Worker's logs.

import { MAX_BODY_BYTES, parseWaitlistBody } from "./input";

/** The parts of the D1 binding this script uses. */
interface D1Statement {
  bind(...values: unknown[]): D1Statement;
  first<T>(): Promise<T | null>;
  run(): Promise<unknown>;
}
interface D1Database {
  prepare(query: string): D1Statement;
}
interface Env {
  ASSETS: { fetch(request: Request): Promise<Response> };
  WAITLIST_DB: D1Database;
}

const WAITLIST_PATH = "/api/waitlist";
/** Attempts one client address may make in one window, counting every POST, accepted or not. */
const RATE_LIMIT = 5;
const RATE_WINDOW_MS = 10 * 60 * 1000;

const MESSAGES = {
  joined: "You're on the list. We'll send one email when Dayhand Cloud opens.",
  invalidEmail: "That doesn't look like an email address. Check it and try again.",
  invalidBody: "The form could not be read. Reload the page and try again.",
  tooFast: "That was quicker than a person types. Wait a moment and try again.",
  tooMany: "Too many tries from your network. Try again in a few minutes.",
  tooLarge: "The form sent too much. Reload the page and try again.",
  notJson: "The form could not be read. Reload the page and try again.",
  crossSite: "Joining only works from dayhand.dev.",
  method: "Send the form with POST.",
  failed: "Something went wrong on our side, so you're not on the list yet. Try again later.",
} as const;

function json(status: number, body: { ok: boolean; message: string }, headers: HeadersInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...headers },
  });
}

async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** Counts this attempt for the client address and says whether it is over the limit. */
async function overRateLimit(db: D1Database, clientAddress: string, now: number): Promise<boolean> {
  const windowStart = now - (now % RATE_WINDOW_MS);
  const ipHash = await sha256Hex(clientAddress);
  await db.prepare("DELETE FROM waitlist_rate WHERE window_start < ?1").bind(windowStart).run();
  // In an UPDATE every expression reads the row as it was, so window_start in the CASE is the old window.
  const row = await db
    .prepare(
      `INSERT INTO waitlist_rate (ip_hash, window_start, attempts) VALUES (?1, ?2, 1)
       ON CONFLICT (ip_hash) DO UPDATE SET
         attempts = CASE WHEN window_start = ?2 THEN attempts + 1 ELSE 1 END,
         window_start = ?2
       RETURNING attempts`,
    )
    .bind(ipHash, windowStart)
    .first<{ attempts: number }>();
  return (row?.attempts ?? 0) > RATE_LIMIT;
}

/** Reads at most MAX_BODY_BYTES of JSON, or null when the body is larger or not JSON. */
async function readJson(request: Request): Promise<{ value: unknown } | "too-large" | null> {
  const declared = Number(request.headers.get("content-length") ?? "0");
  if (declared > MAX_BODY_BYTES) return "too-large";
  const bytes = await request.arrayBuffer();
  if (bytes.byteLength > MAX_BODY_BYTES) return "too-large";
  try {
    return { value: JSON.parse(new TextDecoder().decode(bytes)) };
  } catch {
    return null;
  }
}

async function joinWaitlist(request: Request, env: Env): Promise<Response> {
  const origin = request.headers.get("origin");
  if (origin !== null && origin !== new URL(request.url).origin) {
    return json(403, { ok: false, message: MESSAGES.crossSite });
  }
  if (!(request.headers.get("content-type") ?? "").toLowerCase().startsWith("application/json")) {
    return json(415, { ok: false, message: MESSAGES.notJson });
  }

  const now = Date.now();
  const clientAddress = request.headers.get("cf-connecting-ip") ?? "unknown";
  if (await overRateLimit(env.WAITLIST_DB, clientAddress, now)) {
    return json(429, { ok: false, message: MESSAGES.tooMany }, { "retry-after": String(RATE_WINDOW_MS / 1000) });
  }

  const body = await readJson(request);
  if (body === "too-large") return json(413, { ok: false, message: MESSAGES.tooLarge });
  if (body === null) return json(400, { ok: false, message: MESSAGES.invalidBody });

  const input = parseWaitlistBody(body.value);
  switch (input.kind) {
    case "trap":
      // A bot filled the hidden field: it gets the same answer as a person, and nothing is stored.
      return json(200, { ok: true, message: MESSAGES.joined });
    case "too-fast":
      return json(400, { ok: false, message: MESSAGES.tooFast });
    case "invalid":
      return json(400, { ok: false, message: input.field === "email" ? MESSAGES.invalidEmail : MESSAGES.invalidBody });
    case "signup":
      // An address already on the list gets the same answer, so the form does not tell who has signed up.
      await env.WAITLIST_DB.prepare(
        "INSERT INTO waitlist (email, created_at, source) VALUES (?1, ?2, ?3) ON CONFLICT (email) DO NOTHING",
      )
        .bind(input.email, new Date(now).toISOString(), input.source)
        .run();
      return json(200, { ok: true, message: MESSAGES.joined });
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const { pathname } = new URL(request.url);
    if (pathname !== WAITLIST_PATH) return env.ASSETS.fetch(request);
    if (request.method !== "POST") return json(405, { ok: false, message: MESSAGES.method }, { allow: "POST" });
    try {
      return await joinWaitlist(request, env);
    } catch (error) {
      console.error("waitlist: request failed", error);
      return json(500, { ok: false, message: MESSAGES.failed });
    }
  },
};
