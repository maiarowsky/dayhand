// The deployment URL: checked once, then used without user info or a query in messages.
import { usageError } from "../core/exit.js";

/** Deployment HTTP actions URL without a trailing slash or /mcp. */
export function normalizeUrl(raw: string): string {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw usageError("The Dayhand URL is not a valid URL (expected e.g. https://<deployment>.convex.site)");
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw usageError("The Dayhand URL must start with https:// or http://");
  }
  return raw.replace(/\/+$/, "").replace(/\/mcp$/, "");
}

/** The URL for messages: no user info, no query. */
export function displayUrl(url: string): string {
  try {
    const parsed = new URL(url);
    return `${parsed.protocol}//${parsed.host}${parsed.pathname.replace(/\/$/, "")}`;
  } catch {
    return "the Dayhand URL";
  }
}
