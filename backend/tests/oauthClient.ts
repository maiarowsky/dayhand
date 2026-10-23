// A simulated Claude app for the OAuth tests: it walks the same steps the
// hosted Claude apps take (docs/oauth.md), with the browser and the phone
// played by plain HTTP requests and the app layer.
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { api } from "../convex/_generated/api";
import { CIMD_PATH, CLAUDE_CALLBACK } from "./globalSetup";
import { appClient, helm } from "./helpers";

export { CLAUDE_CALLBACK };

export const site = () => helm().siteUrl;
export const resource = () => `${site()}/mcp`;
export const cimdClientId = (path = CIMD_PATH) => `${helm().cimdOrigin}${path}`;

export function pkce() {
  const verifier = randomBytes(32).toString("base64url");
  return { verifier, challenge: createHash("sha256").update(verifier).digest("base64url") };
}

export async function getJson(path: string) {
  const response = await fetch(`${site()}${path}`);
  return { status: response.status, headers: response.headers, body: await response.json() };
}

export async function postForm(path: string, fields: Record<string, string>) {
  const response = await fetch(`${site()}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(fields).toString(),
    redirect: "manual",
  });
  const text = await response.text();
  let body: any = text;
  try {
    body = JSON.parse(text);
  } catch {
    // HTML or empty
  }
  return { status: response.status, headers: response.headers, body, text };
}

export async function registerClient(metadata: Record<string, unknown> = {}) {
  const response = await fetch(`${site()}/oauth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ client_name: "Claude", redirect_uris: [CLAUDE_CALLBACK], token_endpoint_auth_method: "none", ...metadata }),
  });
  return { status: response.status, body: await response.json() };
}

export type AuthorizeParams = Record<string, string | undefined>;

/** The browser opening the authorization URL: the page with the code, or a redirect, or an error page. */
export async function openAuthorize(params: AuthorizeParams, language = "en") {
  const url = new URL(`${site()}/oauth/authorize`);
  for (const [key, value] of Object.entries(params)) if (value !== undefined) url.searchParams.set(key, value);
  const response = await fetch(url, { redirect: "manual", headers: { "Accept-Language": language } });
  const html = await response.text();
  return {
    status: response.status,
    headers: response.headers,
    html,
    location: response.headers.get("location"),
    userCode: /<div class="code"[^>]*>([0-9A-Z-]+)<\/div>/.exec(html)?.[1] ?? null,
    handle: /name="request" value="([^"]+)"/.exec(html)?.[1] ?? null,
  };
}

export function authorizeParams(clientId: string, challenge: string, extra: AuthorizeParams = {}): AuthorizeParams {
  return {
    response_type: "code",
    client_id: clientId,
    redirect_uri: CLAUDE_CALLBACK,
    code_challenge: challenge,
    code_challenge_method: "S256",
    scope: "tasks:read tasks:write",
    state: "state-123",
    resource: resource(),
    ...extra,
  };
}

/** The owner on the paired phone: an app user signed in with an app JWT. */
export async function phone(subject?: ReturnType<typeof randomUUID>) {
  const { client, userId } = await appClient(subject);
  return {
    userId,
    client,
    lookup: (code: string) => client.mutation(api.app.lookupConnectionRequest, { code }) as Promise<any>,
    decide: (code: string, approve: boolean, scopes?: string[]) =>
      client.mutation(api.app.decideConnectionRequest, { code, approve, scopes: scopes as any }) as Promise<any>,
    connections: () => client.query(api.app.listConnections, {}) as Promise<any[]>,
    revoke: (connectionId: string) => client.mutation(api.app.revokeConnection, { connectionId }),
  };
}

/** The browser continuing after the phone decided; returns the redirect's query. */
export async function continueAuthorize(handle: string, userCode = "") {
  const answer = await postForm("/oauth/authorize/continue", { request: handle, code: userCode });
  const location = answer.headers.get("location");
  return { ...answer, location, query: location ? new URL(location).searchParams : null };
}

export function exchangeCode(fields: { code: string; verifier: string; clientId: string; redirectUri?: string; resource?: string }) {
  return postForm("/oauth/token", {
    grant_type: "authorization_code",
    code: fields.code,
    code_verifier: fields.verifier,
    client_id: fields.clientId,
    redirect_uri: fields.redirectUri ?? CLAUDE_CALLBACK,
    resource: fields.resource ?? resource(),
  });
}

export function refreshTokens(refreshToken: string, clientId: string, extra: Record<string, string> = {}) {
  return postForm("/oauth/token", { grant_type: "refresh_token", refresh_token: refreshToken, client_id: clientId, resource: resource(), ...extra });
}

/** The whole flow, as the Claude app and the owner would do it; returns the tokens and the owner's phone. */
export async function connect(options: { clientId?: string; scopes?: string; grant?: string[]; owner?: Awaited<ReturnType<typeof phone>> } = {}) {
  const owner = options.owner ?? (await phone());
  const clientId = options.clientId ?? cimdClientId();
  const { verifier, challenge } = pkce();
  const page = await openAuthorize(authorizeParams(clientId, challenge, { scope: options.scopes ?? "tasks:read tasks:write" }));
  if (page.status !== 200 || !page.userCode || !page.handle) throw new Error(`authorize failed: ${page.status} ${page.html}`);
  const decided = await owner.decide(page.userCode, true, options.grant);
  if (decided.status !== "approved") throw new Error(`approval failed: ${JSON.stringify(decided)}`);
  const back = await continueAuthorize(page.handle, page.userCode);
  const code = back.query?.get("code");
  if (!code) throw new Error(`no code: ${back.status} ${back.location}`);
  const tokens = await exchangeCode({ code, verifier, clientId });
  if (tokens.status !== 200) throw new Error(`token exchange failed: ${tokens.text}`);
  return { owner, clientId, tokens: tokens.body as { access_token: string; refresh_token: string; scope: string; expires_in: number } };
}

/** A raw MCP request with a bearer token. */
export function mcpRequest(token: string | null, body: unknown) {
  return fetch(`${site()}/mcp`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
}
