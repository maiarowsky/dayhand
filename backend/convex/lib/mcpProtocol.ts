// The two eras of MCP on one endpoint (docs/mcp.md#protocol-versions):
//   legacy (2025-11-25 and earlier): initialize handshake, then plain requests;
//   modern (2026-07-28): no handshake, every request carries its protocol
//   version and client capabilities in params._meta and mirrors its method
//   (and tool, prompt or resource name) in HTTP headers.
// A request is modern when its _meta claims a protocol version, as the
// specification and the official SDK decide it.
import { json } from "./http";

export const SERVER_INFO = { name: "helm", version: "0.7.0" };

export const MODERN_VERSIONS = ["2026-07-28"];
export const LEGACY_VERSIONS = ["2025-11-25", "2025-06-18", "2025-03-26", "2024-11-05"];
export const SUPPORTED_VERSIONS = [...MODERN_VERSIONS, ...LEGACY_VERSIONS];

const META = {
  protocolVersion: "io.modelcontextprotocol/protocolVersion",
  clientCapabilities: "io.modelcontextprotocol/clientCapabilities",
  serverInfo: "io.modelcontextprotocol/serverInfo",
};

// JSON-RPC error codes (MCP 2026-07-28, basic/index#error-codes).
export const RPC = {
  parseError: -32700,
  invalidRequest: -32600,
  methodNotFound: -32601,
  invalidParams: -32602,
  internalError: -32603,
  headerMismatch: -32020,
  unsupportedVersion: -32022,
  // Resource not found before 2026-07-28 (-32602 since).
  legacyResourceNotFound: -32002,
  // Helm's own, outside the JSON-RPC reserved range: too many calls with the key.
  rateLimited: 429,
};

export type RpcId = string | number | null | undefined;
export type RpcRequest = { jsonrpc: "2.0"; id?: RpcId; method?: string; params?: any };
export type Era = "modern" | "legacy";

export const rpcResult = (id: RpcId, result: unknown, headers: Record<string, string> = {}) =>
  json({ jsonrpc: "2.0", id, result }, 200, headers);

export const rpcError = (id: RpcId, code: number, message: string, status = 200, data?: unknown, headers: Record<string, string> = {}) =>
  json({ jsonrpc: "2.0", id: id ?? null, error: data === undefined ? { code, message } : { code, message, data } }, status, headers);

export function eraOf(message: RpcRequest): Era {
  if (message.method === "initialize") return "legacy";
  const meta = message.params?._meta;
  return meta && typeof meta === "object" && META.protocolVersion in meta ? "modern" : "legacy";
}

// Methods whose target is mirrored in the Mcp-Name header, and where it is in params.
const NAMED: Record<string, "name" | "uri"> = { "tools/call": "name", "prompts/get": "name", "resources/read": "uri" };

/** A header value in the Base64 sentinel form `=?base64?…?=` decoded; other values as they are. */
export function decodeHeader(value: string): string | null {
  const encoded = /^=\?base64\?(.*)\?=$/.exec(value);
  if (!encoded) return value;
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(Uint8Array.from(atob(encoded[1]!), (c) => c.charCodeAt(0)));
  } catch {
    return null;
  }
}

const mismatch = (id: RpcId, detail: string) => rpcError(id, RPC.headerMismatch, `Header mismatch: ${detail}`, 400);

/**
 * Checks a modern request before it is served: the required _meta fields, the
 * standard headers against the body, and the protocol version. Null when the
 * request may proceed, otherwise the 400 response the specification asks for.
 */
export function checkModernRequest(request: Request, message: RpcRequest): Response | null {
  const meta = message.params._meta as Record<string, unknown>;
  const version = meta[META.protocolVersion];
  const capabilities = meta[META.clientCapabilities];
  if (typeof version !== "string" || capabilities === null || typeof capabilities !== "object" || Array.isArray(capabilities)) {
    return rpcError(message.id, RPC.invalidParams, `_meta must carry ${META.protocolVersion} and ${META.clientCapabilities}`, 400);
  }
  const header = (name: string) => request.headers.get(name);
  const protocolHeader = header("MCP-Protocol-Version");
  if (protocolHeader === null) return mismatch(message.id, "MCP-Protocol-Version header is missing");
  if (protocolHeader !== version) return mismatch(message.id, `MCP-Protocol-Version header "${protocolHeader}" does not match _meta "${version}"`);
  const methodHeader = header("Mcp-Method");
  if (methodHeader === null) return mismatch(message.id, "Mcp-Method header is missing");
  if (methodHeader !== message.method) return mismatch(message.id, `Mcp-Method header "${methodHeader}" does not match method "${message.method}"`);
  const named = NAMED[message.method!];
  if (named) {
    const raw = header("Mcp-Name");
    if (raw === null) return mismatch(message.id, "Mcp-Name header is missing");
    const value = decodeHeader(raw);
    if (value === null) return mismatch(message.id, "Mcp-Name header is not valid Base64 UTF-8");
    if (value !== message.params?.[named]) return mismatch(message.id, `Mcp-Name header does not match params.${named}`);
  }
  if (!MODERN_VERSIONS.includes(version)) {
    return rpcError(message.id, RPC.unsupportedVersion, "Unsupported protocol version", 400, {
      supported: SUPPORTED_VERSIONS,
      requested: version,
    });
  }
  return null;
}

export type CacheHint = { ttlMs: number; cacheScope: "public" | "private" };

// Lists that are the same for every user change only with a new release.
export const PUBLIC_LIST: CacheHint = { ttlMs: 5 * 60 * 1000, cacheScope: "public" };
// The user's own data may change at any moment.
export const PRIVATE_LIVE: CacheHint = { ttlMs: 0, cacheScope: "private" };

/** A modern result: resultType, the server's identity and, for cacheable results, the cache hint. */
export function modernResult(result: Record<string, unknown>, cache?: CacheHint) {
  const meta = (result._meta ?? {}) as Record<string, unknown>;
  return { resultType: "complete", ...result, ...cache, _meta: { ...meta, [META.serverInfo]: SERVER_INFO } };
}

/** Origins allowed to call the endpoint from a browser (HELM_MCP_ALLOWED_ORIGINS, comma-separated). */
export function originAllowed(request: Request): boolean {
  const origin = request.headers.get("Origin");
  if (origin === null) return true;
  const allowed = (process.env.HELM_MCP_ALLOWED_ORIGINS ?? "")
    .split(",")
    .map((o) => o.trim())
    .filter(Boolean);
  return allowed.includes(origin);
}
