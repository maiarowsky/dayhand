// The backend over HTTP: MCP JSON-RPC on /mcp (stateless, JSON responses) and
// the /devices endpoints. Every failure becomes a CliError with the exit code
// of the contract: 3 for a rejected key, 5 when the server could not answer.
// With --dry-run, changes are recorded instead of applied: a 0.4 backend checks
// each tool call (dryRun: true) and returns what it would produce; endpoint
// calls, and tool calls to an older backend, are only recorded. Reads still happen.
import type { Target } from "../config/resolve.js";
import { displayUrl } from "../config/url.js";
import { CliError, toErrorCode } from "../core/exit.js";

const TIMEOUT_MS = 30_000;
const PROTOCOL_VERSION = "2025-06-18";

export type ToolResult = {
  /** `structuredContent` of the tool, when the tool returned one. */
  structured?: Record<string, unknown>;
  /** The text block (JSON text, or Markdown for a Markdown export). */
  text: string;
  /** MCP `content`, kept for results without structured content. */
  content: unknown[];
};

export type ToolInfo = {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  annotations?: Record<string, unknown>;
};

export type ServerInfo = { name: string; version: string };

/** A change --dry-run held back: a tool call (with the backend's preview) or a POST to a /devices endpoint. */
export type HeldCall =
  | { tool: string; arguments: Record<string, unknown>; result?: Record<string, unknown> }
  | { endpoint: string; body: unknown };

/** Tools that only read; every other tool (including unknown ones) counts as a change. */
export const READ_ONLY_TOOLS = new Set(["list_today", "list_all", "board", "get_task", "list_trash", "get_settings", "export_plan"]);

type RpcResponse = { result?: any; error?: { code: number; message: string } };

const unavailable = (message: string, cause?: unknown) =>
  new CliError("unavailable", message, { retryable: true }, { cause });

/** Where to connect; the source fields are for `hlm whoami` (the key itself is never printed). */
export type ClientConnection = { url: string; key: string } & Partial<Target> & { keySource?: string };

export class HelmClient {
  private nextId = 1;

  constructor(
    readonly connection: ClientConnection,
    private readonly fetchImpl: typeof fetch = fetch,
    /** Set by --dry-run: changes are appended here and not sent. */
    private readonly held?: HeldCall[],
    private readonly timeoutMs = TIMEOUT_MS,
  ) {}

  /** The deployment HTTP actions URL (no trailing slash). */
  get baseUrl(): string {
    return this.connection.url;
  }

  /** One HTTP request; maps transport and status errors to exit codes. */
  async request(method: "GET" | "POST", path: string, body?: unknown): Promise<any> {
    if (this.held && method === "POST" && path !== "/mcp") {
      this.held.push({ endpoint: path, body: body ?? null });
      return {};
    }
    const where = displayUrl(this.connection.url);
    let response: Response;
    try {
      response = await this.fetchImpl(this.connection.url + path, {
        method,
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json, text/event-stream",
          Authorization: `Bearer ${this.connection.key}`,
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (error) {
      throw unavailable(`Cannot reach ${where} (${networkReason(error)})`, error);
    }
    if (response.status === 401) {
      throw new CliError("unauthenticated", "The API key was rejected (wrong or revoked)", {
        hint: "hlm login (or set HLM_API_KEY to a valid key)",
      });
    }
    if (response.status === 429) throw rateLimited(response.headers.get("Retry-After"));
    if (response.status >= 500) {
      throw unavailable(`${where} answered HTTP ${response.status}; the change may or may not have been applied`);
    }
    const payload = await response.json().catch(() => undefined);
    if (!response.ok) throw httpError(response.status, payload, where);
    if (payload === undefined) throw new CliError("internal", `${where} did not answer with JSON`);
    return payload;
  }

  private async rpc(method: string, params?: unknown): Promise<any> {
    const message: RpcResponse = await this.request("POST", "/mcp", {
      jsonrpc: "2.0",
      id: this.nextId++,
      method,
      params,
    });
    if (message.error) {
      // -32602 is an unknown tool or bad params: the caller's mistake.
      const code = message.error.code === -32602 ? "invalid_argument" : "internal";
      throw new CliError(code, message.error.message);
    }
    return message.result;
  }

  async initialize(): Promise<ServerInfo> {
    const result = await this.rpc("initialize", {
      protocolVersion: PROTOCOL_VERSION,
      capabilities: {},
      clientInfo: { name: "hlm", version: "cli" },
    });
    return result.serverInfo as ServerInfo;
  }

  async listTools(): Promise<ToolInfo[]> {
    return (await this.rpc("tools/list")).tools as ToolInfo[];
  }

  /** Calls a tool; a tool error (`isError`) is thrown with its backend code. */
  async callTool(name: string, args: Record<string, unknown> = {}): Promise<ToolResult> {
    if (this.held && !READ_ONLY_TOOLS.has(name)) return this.preview(name, args, this.held);
    return this.send(name, args);
  }

  private async send(name: string, args: Record<string, unknown>): Promise<ToolResult> {
    const result = await this.rpc("tools/call", { name, arguments: args });
    const content = Array.isArray(result.content) ? result.content : [];
    const text = content.find((c: { type?: string }) => c.type === "text")?.text ?? "";
    const structured = result.structuredContent as Record<string, unknown> | undefined;
    if (result.isError) {
      const error = (structured?.error ?? {}) as { code?: unknown; message?: unknown; retryAfterMs?: unknown };
      const message = typeof error.message === "string" ? error.message : text;
      if (error.code === "rate_limited") throw rateLimited(retryAfterSeconds(error.retryAfterMs), message);
      throw new CliError(toErrorCode(error.code), message);
    }
    return { structured, text, content };
  }

  /** A held change, checked by the backend without saving it; an older backend only records it. */
  private async preview(name: string, args: Record<string, unknown>, held: HeldCall[]): Promise<ToolResult> {
    try {
      const checked = await this.send(name, { ...args, dryRun: true });
      held.push({ tool: name, arguments: args, result: checked.structured });
      return checked;
    } catch (error) {
      if (!(error instanceof CliError && error.code === "invalid_argument" && /extra field `dryRun`/.test(error.message))) throw error;
      held.push({ tool: name, arguments: args });
      return { structured: {}, text: "", content: [] };
    }
  }
}

const retryAfterSeconds = (ms: unknown) => (typeof ms === "number" ? String(Math.max(1, Math.ceil(ms / 1000))) : null);

/** Too many calls with the key (HTTP 429 or a rate_limited tool error): nothing was applied. */
function rateLimited(retryAfter: string | null, message?: string): CliError {
  const wait = retryAfter && /^\d+$/.test(retryAfter) ? ` in ${retryAfter} s` : " in a minute";
  return new CliError("rate_limited", message ?? `Too many requests with this API key; try again${wait}`, {
    hint: `run the same command again${wait}`,
  });
}

/** A 4xx answer other than 401: `{error, error_description}` from /devices, or a wrong URL. */
function httpError(status: number, payload: any, where: string): CliError {
  const description =
    typeof payload?.error_description === "string"
      ? payload.error_description
      : typeof payload?.error?.message === "string"
        ? payload.error.message
        : undefined;
  if (payload?.error === "not_found") return new CliError("not_found", description ?? "Not found");
  if (status === 404) return new CliError("internal", `No Helm endpoint at ${where} (HTTP 404); check the URL (hlm whoami)`);
  if (status === 400 || status === 413) {
    return new CliError("invalid_argument", description ?? `${where} rejected the request (HTTP ${status})`);
  }
  return new CliError("internal", description ?? `${where} answered HTTP ${status}`);
}

/** "ECONNREFUSED", "timeout", … from a fetch failure, without internals. */
function networkReason(error: unknown): string {
  if ((error as Error).name === "TimeoutError") return "timeout";
  const cause = (error as { cause?: { code?: string; errors?: { code?: string }[] } }).cause;
  return cause?.code ?? cause?.errors?.[0]?.code ?? "network error";
}
