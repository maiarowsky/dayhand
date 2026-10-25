// Reads and checks what the waitlist form sends. Everything here is untrusted input from the network, so it is
// parsed into a fixed shape and anything else is refused.

export const MAX_BODY_BYTES = 2048;
export const MAX_EMAIL_LENGTH = 254;
const MAX_LOCAL_PART_LENGTH = 64;
/** A person needs longer than this between opening the page and sending the form; a script does not. */
export const MIN_FILL_MS = 2000;
/** The only places on the site that send the form. */
const SOURCES = new Set(["home"]);

// ASCII only: the local part takes the characters RFC 5322 allows without quoting, the domain takes labels of
// letters, digits and inner hyphens (international domains arrive in their xn-- form), with at least one dot.
const LOCAL_PART = /^[a-z0-9!#$%&'*+/=?^_`{|}~-]+(?:\.[a-z0-9!#$%&'*+/=?^_`{|}~-]+)*$/;
const DOMAIN = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

export type WaitlistInput =
  | { kind: "signup"; email: string; source: string }
  | { kind: "trap" }
  | { kind: "too-fast" }
  | { kind: "invalid"; field: "email" | "body" };

/** Trims and lowercases an address, or returns null when it is not one the list accepts. */
export function normalizeEmail(raw: string): string | null {
  const email = raw.trim().toLowerCase();
  if (email.length === 0 || email.length > MAX_EMAIL_LENGTH) return null;
  const at = email.lastIndexOf("@");
  if (at < 1) return null;
  const local = email.slice(0, at);
  const domain = email.slice(at + 1);
  if (local.length > MAX_LOCAL_PART_LENGTH || !LOCAL_PART.test(local) || !DOMAIN.test(domain)) return null;
  return email;
}

/**
 * Turns the parsed JSON body into what the endpoint does with it. The honeypot (`website`, a field people never
 * see) and the time since the page opened (`elapsedMs`) are checked before the address, so a bot learns nothing
 * about which addresses would pass.
 */
export function parseWaitlistBody(body: unknown): WaitlistInput {
  if (typeof body !== "object" || body === null || Array.isArray(body)) return { kind: "invalid", field: "body" };
  const { email, website, elapsedMs, source } = body as Record<string, unknown>;
  if (website !== undefined && website !== "") return { kind: "trap" };
  if (typeof elapsedMs !== "number" || !Number.isFinite(elapsedMs)) return { kind: "invalid", field: "body" };
  if (elapsedMs < MIN_FILL_MS) return { kind: "too-fast" };
  if (typeof source !== "string" || !SOURCES.has(source)) return { kind: "invalid", field: "body" };
  if (typeof email !== "string" || email.length > MAX_EMAIL_LENGTH * 2) return { kind: "invalid", field: "email" };
  const normalized = normalizeEmail(email);
  if (normalized === null) return { kind: "invalid", field: "email" };
  return { kind: "signup", email: normalized, source };
}
