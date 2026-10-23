// Random secrets, hashing and comparison shared by API keys, pairing codes
// and device tokens. Random values need a real random source: generate them
// in actions or HTTP actions, never in mutations (those are deterministic).

export function bytesToBase64url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function randomBase64url(byteCount: number): string {
  return bytesToBase64url(crypto.getRandomValues(new Uint8Array(byteCount)));
}

export async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Compares two strings in time that depends only on their length. */
export function timingSafeEqual(a: string, b: string): boolean {
  let difference = a.length ^ b.length;
  const length = Math.max(a.length, b.length);
  for (let i = 0; i < length; i++) difference |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  return difference === 0;
}

// ---- Pairing codes ----
// Crockford base32 (no I, L, O, U), 12 characters = 60 random bits, shown as
// XXXX-XXXX-XXXX. The first 4 characters select the stored code, the other 8
// are the secret part, stored only as SHA-256.

const CODE_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const CODE_LENGTH = 12;
export const CODE_SELECTOR_LENGTH = 4;

export function newPairingCode(): string {
  // 256 is a multiple of 32, so masking a byte keeps the choice uniform.
  const bytes = crypto.getRandomValues(new Uint8Array(CODE_LENGTH));
  return [...bytes].map((b) => CODE_ALPHABET[b & 31]).join("");
}

export function formatPairingCode(code: string): string {
  return code.match(/.{4}/g)!.join("-");
}

/** Normalizes a typed code (case, dashes, spaces, O/I/L look-alikes); null if malformed. */
export function parsePairingCode(input: string): { selector: string; secret: string } | null {
  const code = input
    .toUpperCase()
    .replace(/[\s-]/g, "")
    .replace(/O/g, "0")
    .replace(/[IL]/g, "1");
  if (code.length !== CODE_LENGTH || [...code].some((c) => !CODE_ALPHABET.includes(c))) return null;
  return { selector: code.slice(0, CODE_SELECTOR_LENGTH), secret: code.slice(CODE_SELECTOR_LENGTH) };
}

// ---- Device tokens ----
// helmdev_<selector>.<secret>: a 16-byte selector to find the device and a
// 32-byte secret stored only as SHA-256.

const DEVICE_TOKEN_PREFIX = "helmdev_";

export function newDeviceToken(): { token: string; selector: string; secret: string } {
  const selector = randomBase64url(16);
  const secret = randomBase64url(32);
  return { token: `${DEVICE_TOKEN_PREFIX}${selector}.${secret}`, selector, secret };
}

export function parseDeviceToken(token: string): { selector: string; secret: string } | null {
  const match = /^helmdev_([A-Za-z0-9_-]{22})\.([A-Za-z0-9_-]{43})$/.exec(token);
  return match ? { selector: match[1], secret: match[2] } : null;
}

// ---- OAuth secrets (docs/oauth.md) ----
// Request handles, access and refresh tokens: <prefix><selector>.<secret>,
// a 16-byte selector and a 32-byte secret stored only as SHA-256, like
// device tokens. Authorization codes are 32 random bytes, looked up by hash.

export type OAuthTokenPrefix = "helmrq_" | "helmat_" | "helmrt_";

export function newSelectorToken(prefix: OAuthTokenPrefix): { token: string; selector: string; secret: string } {
  const selector = randomBase64url(16);
  const secret = randomBase64url(32);
  return { token: `${prefix}${selector}.${secret}`, selector, secret };
}

export function parseSelectorToken(prefix: OAuthTokenPrefix, token: string): { selector: string; secret: string } | null {
  if (!token.startsWith(prefix)) return null;
  const match = /^([A-Za-z0-9_-]{22})\.([A-Za-z0-9_-]{43})$/.exec(token.slice(prefix.length));
  return match ? { selector: match[1], secret: match[2] } : null;
}

export const AUTHORIZATION_CODE_PREFIX = "helmac_";
export const newAuthorizationCode = () => AUTHORIZATION_CODE_PREFIX + randomBase64url(32);

// The code the user types on the phone to approve a connection: 8 Crockford
// base32 characters (40 bits), shown as XXXX-XXXX, stored only as SHA-256.

const USER_CODE_LENGTH = 8;

export function newUserCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(USER_CODE_LENGTH));
  const code = [...bytes].map((b) => CODE_ALPHABET[b & 31]).join("");
  return `${code.slice(0, 4)}-${code.slice(4)}`;
}

/** Normalizes a typed user code like a pairing code; null if malformed. */
export function normalizeUserCode(input: string): string | null {
  const code = input
    .toUpperCase()
    .replace(/[\s-]/g, "")
    .replace(/O/g, "0")
    .replace(/[IL]/g, "1");
  if (code.length !== USER_CODE_LENGTH || [...code].some((c) => !CODE_ALPHABET.includes(c))) return null;
  return code;
}
