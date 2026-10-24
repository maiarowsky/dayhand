// Where a webhook may send (docs/webhooks.md#security): HTTPS URLs on public
// hosts only, so the deployment cannot be pointed at its own network (SSRF).
// Checked when the webhook is added and again before every delivery. Pure.
//
// DAYHAND_WEBHOOK_ALLOWED_ORIGINS (comma-separated origins) exempts those exact
// origins from the rules, e.g. a local receiver in tests or on a self-hosted
// deployment; production leaves it unset.

import { serverEnv } from "./env";

const MAX_URL = 2048;

// Names that never mean a public host.
const PRIVATE_SUFFIXES = [".localhost", ".local", ".internal", ".home.arpa", ".lan", ".intranet", ".corp"];

export function allowedOrigins(): string[] {
  return (serverEnv("WEBHOOK_ALLOWED_ORIGINS") ?? "")
    .split(",")
    .map((origin) => origin.trim().replace(/\/+$/, ""))
    .filter((origin) => origin !== "");
}

function ipv4Private(host: string): boolean | null {
  const match = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (!match) return null;
  const [a, b] = [Number(match[1]), Number(match[2])];
  return (
    a === 0 || a === 10 || a === 127 || a >= 224 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 192 && b === 0 && Number(match[3]) === 0) ||
    (a === 198 && (b === 18 || b === 19))
  );
}

function ipv6Private(host: string): boolean | null {
  if (!host.startsWith("[")) return null;
  const address = host.slice(1, -1).toLowerCase();
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(address);
  if (mapped) return ipv4Private(mapped[1]!) ?? true;
  // Hex form of an IPv4-mapped address, as the URL parser writes it (::ffff:7f00:1).
  const mappedHex = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(address);
  if (mappedHex) {
    const high = parseInt(mappedHex[1]!, 16);
    const low = parseInt(mappedHex[2]!, 16);
    return ipv4Private(`${high >> 8}.${high & 255}.${low >> 8}.${low & 255}`) ?? true;
  }
  return (
    address === "::" || address === "::1" ||
    /^f[cd]/.test(address) || /^fe[89ab]/.test(address) || /^ff/.test(address) ||
    address.startsWith("64:ff9b:") || address.startsWith("2001:db8:") || address.startsWith("::")
  );
}

/** Why `url` cannot receive webhooks, or null when it can. */
export function targetProblem(url: string, allowed: string[] = allowedOrigins()): string | null {
  if (url.length > MAX_URL) return `url is longer than ${MAX_URL} characters`;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return "url is not a valid URL";
  }
  if (parsed.username || parsed.password) return "url must not carry a user name or password";
  if (allowed.includes(parsed.origin)) return null;
  if (parsed.protocol !== "https:") return "url must be https://";
  const host = parsed.hostname.toLowerCase().replace(/\.$/, "");
  if (host === "localhost" || PRIVATE_SUFFIXES.some((suffix) => host.endsWith(suffix))) return "url must be on a public host";
  const ip = ipv4Private(host) ?? ipv6Private(host);
  if (ip === true) return "url must not point at a private, loopback or reserved address";
  if (ip === null && !host.includes(".")) return "url must be on a public host";
  return null;
}
