// Pure checks of the OAuth server: redirect URIs, scopes, PKCE, the resource
// indicator, client metadata documents and dynamic registrations. No I/O, so
// every rule is unit-tested on its own (tests/oauthRules.test.ts).
import { CLAUDE_APP_CALLBACK, DEFAULT_SCOPES, LOOPBACK_HOSTS, LOOPBACK_PATH, SCOPES, type Scope } from "./oauthConfig";

export type RedirectKind = "app" | "loopback";

const MAX_REDIRECT_URIS = 10;
const MAX_CLIENT_NAME = 60;
const MAX_STATE = 1024;

function parseUrl(value: string): URL | null {
  try {
    return new URL(value);
  } catch {
    return null;
  }
}

/** Claude Code's loopback form: http, localhost or 127.0.0.1, any port, exactly /callback, nothing else. */
function loopbackParts(value: string): { host: string } | null {
  const url = parseUrl(value);
  if (!url || url.protocol !== "http:" || !LOOPBACK_HOSTS.includes(url.hostname)) return null;
  if (url.username || url.password || url.search || url.hash || url.pathname !== LOOPBACK_PATH) return null;
  if (!value.startsWith(`http://${url.hostname}`)) return null; // no IPv4 shorthands or odd spellings
  return { host: url.hostname };
}

/** Whether Helm sends codes to this URI at all: only the official Claude callbacks. */
export function redirectKind(uri: string): RedirectKind | null {
  if (uri === CLAUDE_APP_CALLBACK) return "app";
  return loopbackParts(uri) ? "loopback" : null;
}

/**
 * Whether a requested redirect URI matches one the client registered: exactly, or for loopback
 * URIs with the port ignored (RFC 8252 section 7.3). It must also be one Helm allows.
 */
export function redirectMatches(requested: string, registered: string[]): boolean {
  const kind = redirectKind(requested);
  if (kind === "app") return registered.includes(requested);
  if (kind !== "loopback") return false;
  const host = loopbackParts(requested)!.host;
  return registered.some((uri) => loopbackParts(uri)?.host === host);
}

/** The host shown on the consent screen for a redirect URI. */
export const redirectHost = (uri: string) => parseUrl(uri)?.hostname ?? uri;

export type ScopeResult = { ok: true; scopes: Scope[] } | { ok: false; error: string };

/**
 * A space-separated scope parameter. Missing or empty means reading only. `offline_access` is
 * ignored (a refresh token always comes with the code). Anything else unknown is refused.
 */
export function parseScopes(raw: string | null | undefined): ScopeResult {
  const words = (raw ?? "").split(" ").filter((w) => w !== "" && w !== "offline_access");
  if (words.length === 0) return { ok: true, scopes: [...DEFAULT_SCOPES] };
  const unknown = words.filter((w) => !(SCOPES as readonly string[]).includes(w));
  if (unknown.length) return { ok: false, error: `Unknown scope: ${unknown.join(" ")}` };
  return { ok: true, scopes: SCOPES.filter((s) => words.includes(s)) };
}

export const formatScopes = (scopes: readonly string[]) => scopes.join(" ");

/** Granted scopes on approval: a non-empty part of what was requested. */
export function checkGranted(requested: Scope[], granted: Scope[]): Scope[] | null {
  const unique = SCOPES.filter((s) => granted.includes(s));
  if (unique.length === 0 || unique.some((s) => !requested.includes(s))) return null;
  return unique;
}

const VERIFIER = /^[A-Za-z0-9\-._~]{43,128}$/;
const CHALLENGE = /^[A-Za-z0-9_-]{43}$/;

export const isCodeVerifier = (value: string) => VERIFIER.test(value);
export const isCodeChallenge = (value: string) => CHALLENGE.test(value);

/** `state` is returned untouched; it only has to be printable and of sane length. */
export const isState = (value: string) => value.length <= MAX_STATE && /^[\x20-\x7e]*$/.test(value);

/** The resource indicator, when given, must name this server's MCP endpoint (a trailing slash is tolerated). */
export function resourceMatches(given: string | null | undefined, resource: string): boolean {
  if (given === null || given === undefined || given === "") return true;
  return given.replace(/\/+$/, "") === resource;
}

/** A display name from self-asserted client metadata: printable, trimmed, short; else the fallback. */
export function cleanName(name: unknown, fallback: string): string {
  if (typeof name !== "string") return fallback;
  const cleaned = name.replace(/[\u0000-\u001f\u007f-\u009f​-‏‪-‮⁦-⁩]/g, "").trim();
  return cleaned ? cleaned.slice(0, MAX_CLIENT_NAME) : fallback;
}

export type ClientInfo = { name: string; redirectUris: string[] };
export type ClientCheck = { ok: true; client: ClientInfo } | { ok: false; error: string };

function checkRedirectUris(value: unknown): string[] | string {
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_REDIRECT_URIS) {
    return `redirect_uris must list 1 to ${MAX_REDIRECT_URIS} URIs`;
  }
  if (value.some((uri) => typeof uri !== "string" || redirectKind(uri) === null)) {
    return `Only Claude's redirect URIs are accepted: ${CLAUDE_APP_CALLBACK}, or http://localhost/callback and http://127.0.0.1/callback on any port`;
  }
  return value as string[];
}

function checkPublicClient(doc: Record<string, unknown>): string | null {
  const method = doc.token_endpoint_auth_method;
  if (method !== undefined && method !== "none") return "Only public clients (token_endpoint_auth_method none) are supported";
  const grants = doc.grant_types;
  if (grants !== undefined && (!Array.isArray(grants) || grants.some((g) => g !== "authorization_code" && g !== "refresh_token"))) {
    return "grant_types may only be authorization_code and refresh_token";
  }
  const responses = doc.response_types;
  if (responses !== undefined && (!Array.isArray(responses) || responses.some((r) => r !== "code"))) {
    return "response_types may only be code";
  }
  return null;
}

/**
 * A URL client_id usable as a Client ID Metadata Document: on one of the allowed origins (HTTPS
 * unless the deployment lists another origin itself), with a path, without credentials or a fragment.
 */
export function cimdUrlProblem(clientId: string, allowedOrigins: string[]): string | null {
  const url = parseUrl(clientId);
  if (!url || url.username || url.password || url.hash || url.pathname === "/" || url.href !== clientId) {
    return "client_id is not a valid client metadata URL";
  }
  return allowedOrigins.includes(url.origin) ? null : `Clients from ${url.host} are not accepted`;
}

/** A fetched Client ID Metadata Document for `clientId`. */
export function checkMetadataDocument(clientId: string, doc: unknown): ClientCheck {
  if (doc === null || typeof doc !== "object" || Array.isArray(doc)) return { ok: false, error: "Client metadata is not a JSON object" };
  const fields = doc as Record<string, unknown>;
  if (fields.client_id !== clientId) return { ok: false, error: "Client metadata names another client_id" };
  if ("client_secret" in fields) return { ok: false, error: "Client metadata must not contain a secret" };
  const problem = checkPublicClient(fields);
  if (problem) return { ok: false, error: problem };
  const redirectUris = checkRedirectUris(fields.redirect_uris);
  if (typeof redirectUris === "string") return { ok: false, error: redirectUris };
  return { ok: true, client: { name: cleanName(fields.client_name, new URL(clientId).host), redirectUris } };
}

/** A Dynamic Client Registration request (RFC 7591), public clients only. */
export function checkRegistration(body: Record<string, unknown>): ClientCheck {
  const problem = checkPublicClient(body);
  if (problem) return { ok: false, error: problem };
  const redirectUris = checkRedirectUris(body.redirect_uris);
  if (typeof redirectUris === "string") return { ok: false, error: redirectUris };
  return { ok: true, client: { name: cleanName(body.client_name, "Unnamed client"), redirectUris } };
}
