// Fixed facts of Dayhand's OAuth 2.1 authorization server (docs/oauth.md): the
// scopes, the lifetimes, the only redirect URIs a client may use, and the
// public URL that names the issuer and the protected resource (/mcp).
import { v, type Infer } from "convex/values";
import { serverEnv } from "./env";

export const SCOPES = ["tasks:read", "tasks:write"] as const;
export const scopeValidator = v.union(v.literal("tasks:read"), v.literal("tasks:write"));
export type Scope = Infer<typeof scopeValidator>;

/** What a request without `scope` gets: reading only, never writing. */
export const DEFAULT_SCOPES: Scope[] = ["tasks:read"];

/** The scopes the 401 on /mcp asks for: Dayhand is useful to an agent only with both; the phone may grant less. */
export const CHALLENGE_SCOPES: Scope[] = ["tasks:read", "tasks:write"];

export const REQUEST_TTL_MS = 10 * 60 * 1000;
export const CODE_TTL_MS = 2 * 60 * 1000;
export const ACCESS_TOKEN_TTL_MS = 60 * 60 * 1000;
export const REFRESH_TOKEN_TTL_MS = 60 * 24 * 60 * 60 * 1000;
/** How rarely /mcp records the use of a connection, so that reads stay cheap. */
export const TOUCH_INTERVAL_MS = 10 * 60 * 1000;

/** Redirect URI of the hosted Claude apps (web, desktop, mobile, Cowork): claude.com/docs/connectors/building/authentication. */
export const CLAUDE_APP_CALLBACK = "https://claude.ai/api/mcp/auth_callback";
/** Claude Code's loopback redirect: any port on these hosts, this path (its client metadata document lists both). */
export const LOOPBACK_HOSTS = ["localhost", "127.0.0.1"];
export const LOOPBACK_PATH = "/callback";

/**
 * Origins whose HTTPS URLs Dayhand accepts as Client ID Metadata Documents. Only Anthropic's host by
 * default, so the server never fetches an address a stranger chose (no SSRF surface).
 * DAYHAND_OAUTH_CIMD_ORIGINS (comma-separated origins) replaces the list, e.g. for a test client.
 */
export const DEFAULT_CIMD_ORIGINS = ["https://claude.ai"];

export function cimdOrigins(): string[] {
  const configured = serverEnv("OAUTH_CIMD_ORIGINS");
  if (!configured) return DEFAULT_CIMD_ORIGINS;
  return configured
    .split(",")
    .map((origin) => origin.trim().replace(/\/+$/, ""))
    .filter((origin) => origin !== "");
}

/**
 * The deployment's public HTTP actions URL, without a trailing slash: DAYHAND_PUBLIC_URL when set
 * (a custom domain), else the Convex site URL. Null when neither is known.
 */
export function publicUrl(): string | null {
  const url = serverEnv("PUBLIC_URL") || process.env.CONVEX_SITE_URL;
  return url ? url.replace(/\/+$/, "") : null;
}

/** The protected resource every token is bound to (RFC 8707): the MCP endpoint. */
export const resourceFor = (base: string) => `${base}/mcp`;

/** Where the protected resource metadata (RFC 9728) of /mcp is served. */
export const resourceMetadataFor = (base: string) => `${base}/.well-known/oauth-protected-resource/mcp`;
