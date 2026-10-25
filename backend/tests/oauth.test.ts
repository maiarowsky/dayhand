// OAuth 2.1 for MCP clients (docs/oauth.md) on the local backend: discovery,
// authorization with the approval on the phone, tokens, scopes and revocation.
// tests/oauthClient.ts plays the Claude app, the browser and the phone.
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { api, internal } from "../convex/_generated/api";
import { afterEach, describe, expect, test } from "vitest";
import { admin, callTool, createKey } from "./helpers";
import {
  authorizeParams,
  cimdClientId,
  CLAUDE_CALLBACK,
  connect,
  continueAuthorize,
  exchangeCode,
  getJson,
  mcpRequest,
  openAuthorize,
  phone,
  pkce,
  refreshTokens,
  registerClient,
  resource,
  site,
} from "./oauthClient";

const hashKeyForTest = async (key: string) => (await import("node:crypto")).createHash("sha256").update(key).digest("hex");
const listTools = (token: string) => mcpRequest(token, { jsonrpc: "2.0", id: 1, method: "tools/list" });
const callToolRaw = (token: string, name: string, args: Record<string, unknown> = {}) =>
  mcpRequest(token, { jsonrpc: "2.0", id: 2, method: "tools/call", params: { name, arguments: args } });

async function mcpWith(token: string) {
  const client = new Client({ name: "claude-sim", version: "0.0.0" });
  await client.connect(
    new StreamableHTTPClientTransport(new URL(resource()), { requestInit: { headers: { Authorization: `Bearer ${token}` } } }),
  );
  return client;
}

afterEach(async () => {
  await admin().mutation(internal.oauth.resetLimits, {});
});

describe("discovery", () => {
  test("/mcp without a token answers 401 that points at the protected resource metadata", async () => {
    const response = await mcpRequest(null, { jsonrpc: "2.0", id: 1, method: "initialize", params: {} });
    expect(response.status).toBe(401);
    const challenge = response.headers.get("www-authenticate")!;
    expect(challenge).toContain(`resource_metadata="${site()}/.well-known/oauth-protected-resource/mcp"`);
    expect(challenge).toContain('scope="tasks:read tasks:write"');
    expect(challenge).not.toContain("error=");

    const wrong = await mcpRequest("helmat_AAAAAAAAAAAAAAAAAAAAAA.AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA", {});
    expect(wrong.status).toBe(401);
    expect(wrong.headers.get("www-authenticate")).toContain('error="invalid_token"');
  });

  test("protected resource and authorization server metadata", async () => {
    for (const path of ["/.well-known/oauth-protected-resource/mcp", "/.well-known/oauth-protected-resource"]) {
      const prm = await getJson(path);
      expect(prm.status).toBe(200);
      expect(prm.body).toMatchObject({
        resource: resource(),
        authorization_servers: [site()],
        scopes_supported: ["tasks:read", "tasks:write"],
        bearer_methods_supported: ["header"],
      });
    }
    const as = await getJson("/.well-known/oauth-authorization-server");
    expect(as.body).toMatchObject({
      issuer: site(),
      authorization_endpoint: `${site()}/oauth/authorize`,
      token_endpoint: `${site()}/oauth/token`,
      registration_endpoint: `${site()}/oauth/register`,
      revocation_endpoint: `${site()}/oauth/revoke`,
      response_types_supported: ["code"],
      grant_types_supported: ["authorization_code", "refresh_token"],
      token_endpoint_auth_methods_supported: ["none"],
      code_challenge_methods_supported: ["S256"],
      client_id_metadata_document_supported: true,
      authorization_response_iss_parameter_supported: true,
    });
    expect(as.body.scopes_supported).not.toContain("offline_access");
  });
});

describe("the flow with a Client ID Metadata Document", () => {
  test("approve on the phone, get tokens, read and change the plan as the agent", async () => {
    const owner = await phone();
    await owner.client.mutation(api.app.add, { title: "Call the accountant", dueDate: "today" });
    const { verifier, challenge } = pkce();
    const page = await openAuthorize(authorizeParams(cimdClientId(), challenge));
    expect(page.status).toBe(200);
    expect(page.headers.get("content-security-policy")).toContain("frame-ancestors 'none'");
    expect(page.headers.get("cache-control")).toBe("no-store");
    expect(page.html).toContain("Claude (test)");
    expect(page.userCode).toMatch(/^[0-9A-Z]{4}-[0-9A-Z]{4}$/);

    // Status stays pending until the phone decides.
    const pending = await (await fetch(`${site()}/oauth/authorize/status`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ request: page.handle! }).toString(),
    })).json();
    expect(pending).toEqual({ status: "pending" });
    const early = await continueAuthorize(page.handle!, page.userCode!);
    expect(early.status).toBe(200);
    expect(early.text).toContain(page.userCode);

    const seen = await owner.lookup(page.userCode!.toLowerCase().replace("-", ""));
    expect(seen).toMatchObject({
      status: "found",
      request: { clientName: "Claude (test)", clientType: "cimd", clientHost: new URL(cimdClientId()).host, redirectHost: "claude.ai", loopback: false, scopes: ["tasks:read", "tasks:write"] },
    });
    expect(await owner.decide(page.userCode!, true)).toEqual({ status: "approved", scopes: ["tasks:read", "tasks:write"] });

    const back = await continueAuthorize(page.handle!);
    expect(back.status).toBe(303);
    expect(back.location!.startsWith(`${CLAUDE_CALLBACK}?`)).toBe(true);
    expect(back.query!.get("state")).toBe("state-123");
    expect(back.query!.get("iss")).toBe(site());
    const code = back.query!.get("code")!;

    const tokens = await exchangeCode({ code, verifier, clientId: cimdClientId() });
    expect(tokens.status).toBe(200);
    expect(tokens.headers.get("cache-control")).toBe("no-store");
    expect(tokens.body).toMatchObject({ token_type: "Bearer", expires_in: 3600, scope: "tasks:read tasks:write" });
    expect(tokens.body.access_token).toMatch(/^helmat_/);
    expect(tokens.body.refresh_token).toMatch(/^helmrt_/);

    const mcp = await mcpWith(tokens.body.access_token);
    expect((await mcp.listTools()).tools).toHaveLength(32);
    const today = await callTool(mcp, "list_today");
    expect(today.today.map((t: any) => t.title)).toEqual(["Call the accountant"]);
    const added = await callTool(mcp, "add_task", { title: "Book the dentist" });
    const detail = await callTool(mcp, "get_task", { taskId: added.id });
    expect(detail.history[0]).toMatchObject({ actor: "agent", actorName: "Claude (test)", by: "agent: Claude (test)" });

    const [connection] = await owner.connections();
    expect(connection).toMatchObject({ clientName: "Claude (test)", clientType: "cimd", scopes: ["tasks:read", "tasks:write"], active: true, revokedAt: null });
    expect(connection.lastUsedAt).toEqual(expect.any(Number));
  });

  test("a read-only connection sees no write tools and gets 403 insufficient_scope for one", async () => {
    const { tokens } = await connect({ grant: ["tasks:read"] });
    expect(tokens.scope).toBe("tasks:read");
    const list = await (await listTools(tokens.access_token)).json();
    const names = list.result.tools.map((t: any) => t.name);
    expect(names).toEqual(expect.arrayContaining(["list_today", "get_task", "export_plan"]));
    expect(names).not.toContain("delete_task");
    expect(names).not.toContain("add_task");
    expect(names).toHaveLength(15);
    expect(names.filter((name: string) => ["list_projects", "add_project", "update_project", "delete_project"].includes(name))).toEqual(["list_projects"]);
    const projects = await callToolRaw(tokens.access_token, "list_projects");
    expect(projects.status).toBe(200);
    expect((await projects.json()).result.structuredContent).toEqual({ result: [], noProject: { open: 0, overdue: 0 } });
    const addProject = await callToolRaw(tokens.access_token, "add_project", { name: "Not allowed" });
    expect(addProject.status).toBe(403);
    expect(addProject.headers.get("www-authenticate")).toContain('error="insufficient_scope"');
    expect(await addProject.json()).toMatchObject({ error: "insufficient_scope" });

    const refused = await callToolRaw(tokens.access_token, "delete_task", { taskId: "#1" });
    expect(refused.status).toBe(403);
    const challenge = refused.headers.get("www-authenticate")!;
    expect(challenge).toContain('error="insufficient_scope"');
    expect(challenge).toContain('scope="tasks:read tasks:write"');
    expect((await callToolRaw(tokens.access_token, "list_today")).status).toBe(200);
  });

  test("a write-only connection cannot read the plan through tools, resources or prompts", async () => {
    const { tokens } = await connect({ grant: ["tasks:write"] });
    expect(tokens.scope).toBe("tasks:write");
    const rpc = (method: string, params: Record<string, unknown>) => mcpRequest(tokens.access_token, { jsonrpc: "2.0", id: 3, method, params });
    expect((await callToolRaw(tokens.access_token, "list_today")).status).toBe(403);
    expect((await rpc("resources/read", { uri: "dayhand://today" })).status).toBe(403);
    expect((await callToolRaw(tokens.access_token, "list_projects")).status).toBe(403);
    expect((await rpc("resources/read", { uri: "dayhand://projects" })).status).toBe(403);
    expect((await rpc("prompts/get", { name: (await (await rpc("prompts/list", {})).json()).result.prompts[0].name })).status).toBe(403);
    // The guide holds no user data.
    expect((await rpc("resources/read", { uri: "dayhand://guide" })).status).toBe(200);
    expect((await callToolRaw(tokens.access_token, "add_task", { title: "Written blind" })).status).toBe(200);
  });

  test("calls are limited per connection, apart from API keys", async () => {
    const { owner } = await connect();
    const [connection] = await owner.connections();
    const key = await createKey(owner.userId, "agent-key");
    const keyId = (await admin().query(internal.apiKeys.verify, { hash: await hashKeyForTest(key) }))!.keyId;
    for (let i = 0; i < 60; i++) {
      expect((await admin().mutation(internal.callLimits.consume, { connectionId: connection.id, kind: "write" })).ok).toBe(true);
    }
    expect(await admin().mutation(internal.callLimits.consume, { connectionId: connection.id, kind: "write" })).toMatchObject({ ok: false, limit: 60 });
    expect((await admin().mutation(internal.callLimits.consume, { keyId, kind: "write" })).ok).toBe(true);
    await admin().mutation(internal.callLimits.reset, { connectionId: connection.id });
    expect((await admin().mutation(internal.callLimits.consume, { connectionId: connection.id, kind: "write" })).ok).toBe(true);
  });

  test("a request without scope asks for reading only", async () => {
    const { tokens } = await connect({ scopes: "" });
    expect(tokens.scope).toBe("tasks:read");
  });

  test("metadata documents that are not acceptable show an error page, never a redirect", async () => {
    const { challenge } = pkce();
    for (const path of ["/oauth/other-id.json", "/oauth/evil-redirect.json", "/oauth/with-secret.json", "/oauth/redirect.json", "/oauth/huge.json", "/oauth/missing.json"]) {
      const page = await openAuthorize(authorizeParams(cimdClientId(path), challenge));
      expect(page.status, path).toBe(400);
      expect(page.location, path).toBeNull();
    }
    // Origins that are not allowed are not even fetched.
    const stranger = await openAuthorize(authorizeParams("https://evil.example/client.json", challenge));
    expect(stranger.status).toBe(400);
  });
});

describe("the flow with Dynamic Client Registration, driven by the MCP SDK's OAuth client", () => {
  test("registers, authorizes with PKCE and resource, refreshes, and calls tools", async () => {
    const { auth } = await import("@modelcontextprotocol/sdk/client/auth.js");
    const owner = await phone();
    const saved: Record<string, any> = {};
    let authorizationUrl: URL | null = null;
    const provider = {
      redirectUrl: CLAUDE_CALLBACK,
      clientMetadata: { client_name: "Claude", redirect_uris: [CLAUDE_CALLBACK], grant_types: ["authorization_code", "refresh_token"], response_types: ["code"], token_endpoint_auth_method: "none" },
      state: () => "sdk-state",
      clientInformation: () => saved.client,
      saveClientInformation: (info: any) => void (saved.client = info),
      tokens: () => saved.tokens,
      saveTokens: (tokens: any) => void (saved.tokens = tokens),
      redirectToAuthorization: (url: URL) => void (authorizationUrl = url),
      saveCodeVerifier: (verifier: string) => void (saved.verifier = verifier),
      codeVerifier: () => saved.verifier,
    };
    expect(await auth(provider as any, { serverUrl: resource() })).toBe("REDIRECT");
    expect(saved.client.client_id).toMatch(/^helmc_/);
    expect(authorizationUrl!.searchParams.get("resource")).toBe(resource());
    expect(authorizationUrl!.searchParams.get("code_challenge_method")).toBe("S256");

    const page = await openAuthorize(Object.fromEntries(authorizationUrl!.searchParams));
    expect(page.status).toBe(200);
    expect((await owner.lookup(page.userCode!)).request).toMatchObject({ clientType: "dcr", clientHost: null, clientName: "Claude" });
    await owner.decide(page.userCode!, true);
    const back = await continueAuthorize(page.handle!);
    expect(back.query!.get("state")).toBe("sdk-state");
    expect(await auth(provider as any, { serverUrl: resource(), authorizationCode: back.query!.get("code")! })).toBe("AUTHORIZED");

    const client = new Client({ name: "claude-sim", version: "0.0.0" });
    await client.connect(new StreamableHTTPClientTransport(new URL(resource()), { authProvider: provider as any }));
    expect((await client.listTools()).tools).toHaveLength(32);
    await callTool(client, "add_task", { title: "From the SDK client" });

    // A refresh through the SDK rotates both tokens.
    const before = saved.tokens;
    expect(await auth(provider as any, { serverUrl: resource() })).toBe("AUTHORIZED");
    expect(saved.tokens.refresh_token).not.toBe(before.refresh_token);
    expect(saved.tokens.access_token).not.toBe(before.access_token);
  });

  test("registration accepts only Claude's redirect URIs and public clients", async () => {
    expect((await registerClient()).status).toBe(201);
    const loopback = await registerClient({ redirect_uris: ["http://localhost/callback", "http://127.0.0.1/callback"] });
    expect(loopback.status).toBe(201);
    for (const redirect_uris of [["https://evil.example/cb"], ["https://claude.ai/api/mcp/auth_callback/x"], ["http://localhost/other"], ["http://localhost.evil.example/callback"], []]) {
      const refused = await registerClient({ redirect_uris });
      expect(refused.status, JSON.stringify(redirect_uris)).toBe(400);
    }
    expect((await registerClient({ token_endpoint_auth_method: "client_secret_post" })).body.error).toBe("invalid_client_metadata");
  });

  test("a client name is escaped on the page", async () => {
    const { body } = await registerClient({ client_name: '<img src=x onerror="alert(1)">' });
    const page = await openAuthorize(authorizeParams(body.client_id, pkce().challenge));
    expect(page.html).not.toContain("<img src=x");
    expect(page.html).toContain("&lt;img src=x onerror=&quot;alert(1)&quot;&gt;");
  });
});

describe("authorization request errors", () => {
  test("a wrong redirect URI gets an error page; other errors go back to the client", async () => {
    const { challenge } = pkce();
    const wrongRedirect = await openAuthorize(authorizeParams(cimdClientId(), challenge, { redirect_uri: "https://evil.example/cb" }));
    expect(wrongRedirect.status).toBe(400);
    expect(wrongRedirect.location).toBeNull();
    const unknown = await openAuthorize(authorizeParams("helmc_nope", challenge));
    expect(unknown.status).toBe(400);

    const cases: [Record<string, string | undefined>, string][] = [
      [{ code_challenge_method: "plain" }, "invalid_request"],
      [{ code_challenge: undefined }, "invalid_request"],
      [{ code_challenge_method: undefined }, "invalid_request"],
      [{ response_type: "token" }, "unsupported_response_type"],
      [{ scope: "tasks:read tasks:admin" }, "invalid_scope"],
      [{ resource: "https://other.example/mcp" }, "invalid_target"],
    ];
    for (const [extra, error] of cases) {
      const page = await openAuthorize(authorizeParams(cimdClientId(), challenge, extra));
      expect(page.status, JSON.stringify(extra)).toBe(303);
      const query = new URL(page.location!).searchParams;
      expect(query.get("error"), JSON.stringify(extra)).toBe(error);
      expect(query.get("state")).toBe("state-123");
      expect(query.get("iss")).toBe(site());
    }
  });

  test("a refusal on the phone sends the browser back with access_denied", async () => {
    const owner = await phone();
    const page = await openAuthorize(authorizeParams(cimdClientId(), pkce().challenge));
    expect(await owner.decide(page.userCode!, false)).toEqual({ status: "denied" });
    const back = await continueAuthorize(page.handle!);
    expect(back.query!.get("error")).toBe("access_denied");
    expect(back.query!.get("code")).toBeNull();
    expect((await owner.decide(page.userCode!, true)).status).toBe("not_found");
  });

  test("the phone can grant only what was asked, and wrong codes are limited per user", async () => {
    const owner = await phone();
    const page = await openAuthorize(authorizeParams(cimdClientId(), pkce().challenge, { scope: "tasks:read" }));
    await expect(owner.decide(page.userCode!, true, ["tasks:read", "tasks:write"])).rejects.toThrow(/scopes must be/);
    for (let i = 0; i < 10; i++) expect((await owner.lookup("0000-0000")).status).toBe("not_found");
    expect((await owner.lookup(page.userCode!)).status).toBe("rate_limited");
    // Another user is not affected.
    expect((await (await phone()).lookup(page.userCode!)).status).toBe("found");
  });

  test("too many waiting requests of one client are refused with 429; other clients are not affected", async () => {
    const owner = await phone();
    const codes: string[] = [];
    let refused = null;
    for (let i = 0; i < 8 && !refused; i++) {
      const page = await openAuthorize(authorizeParams(cimdClientId(), pkce().challenge));
      if (page.status === 429) refused = page;
      else codes.push(page.userCode!);
    }
    expect(refused?.status).toBe(429);
    expect(codes.length).toBeLessThanOrEqual(5);
    const other = await registerClient({ client_name: "Another client", redirect_uris: [CLAUDE_CALLBACK] });
    const page = await openAuthorize(authorizeParams(other.body.client_id, pkce().challenge));
    expect(page.status).toBe(200);
    for (const code of [...codes, page.userCode!]) await owner.decide(code, false); // free the slots for the other tests
  });
});

describe("the token endpoint", () => {
  async function approvedCode() {
    const owner = await phone();
    const { verifier, challenge } = pkce();
    const page = await openAuthorize(authorizeParams(cimdClientId(), challenge));
    await owner.decide(page.userCode!, true);
    const back = await continueAuthorize(page.handle!);
    return { owner, verifier, code: back.query!.get("code")!, handle: page.handle! };
  }

  test("a wrong PKCE verifier fails and burns the code", async () => {
    const { verifier, code } = await approvedCode();
    const wrong = await exchangeCode({ code, verifier: pkce().verifier, clientId: cimdClientId() });
    expect(wrong.status).toBe(400);
    expect(wrong.body).toEqual({ error: "invalid_grant", error_description: "The code or token is not valid" });
    expect((await exchangeCode({ code, verifier, clientId: cimdClientId() })).body.error).toBe("invalid_grant");
  });

  test("a code used twice fails and revokes the connection it created", async () => {
    const { owner, verifier, code } = await approvedCode();
    const first = await exchangeCode({ code, verifier, clientId: cimdClientId() });
    expect(first.status).toBe(200);
    expect((await listTools(first.body.access_token)).status).toBe(200);
    const second = await exchangeCode({ code, verifier, clientId: cimdClientId() });
    expect(second.body.error).toBe("invalid_grant");
    expect((await listTools(first.body.access_token)).status).toBe(401);
    expect((await owner.connections())[0]).toMatchObject({ active: false, revokedAt: expect.any(Number) });
  });

  test("the code is bound to its client, redirect URI and resource", async () => {
    for (const change of [{ clientId: "helmc_other" }, { redirectUri: "http://localhost:3118/callback" }]) {
      const { verifier, code } = await approvedCode();
      const answer = await exchangeCode({ code, verifier, clientId: cimdClientId(), ...change });
      expect(answer.body.error, JSON.stringify(change)).toBe("invalid_grant");
    }
    const { verifier, code } = await approvedCode();
    const wrongResource = await exchangeCode({ code, verifier, clientId: cimdClientId(), resource: "https://other.example/mcp" });
    expect(wrongResource.body.error).toBe("invalid_target");
  });

  test("a continue after the code was given out does not give a second code", async () => {
    const { handle } = await approvedCode();
    const again = await continueAuthorize(handle);
    expect(again.status).toBe(400);
    expect(again.location).toBeNull();
  });

  test("malformed token requests", async () => {
    const json = await fetch(`${site()}/oauth/token`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
    expect(json.status).toBe(400);
    const { postForm } = await import("./oauthClient");
    const secret = await postForm("/oauth/token", { grant_type: "authorization_code", client_id: "x", client_secret: "s", code: "c", redirect_uri: CLAUDE_CALLBACK });
    expect(secret.status).toBe(401);
    expect(secret.body.error).toBe("invalid_client");
    const grant = await postForm("/oauth/token", { grant_type: "client_credentials", client_id: "x" });
    expect(grant.body.error).toBe("unsupported_grant_type");
  });

  test("refresh rotates; a retry at once gets a new pair instead of revoking the connection", async () => {
    const { clientId, tokens } = await connect();
    const next = await refreshTokens(tokens.refresh_token, clientId);
    expect(next.status).toBe(200);
    expect(next.body.scope).toBe("tasks:read tasks:write");
    expect((await listTools(next.body.access_token)).status).toBe(200);
    expect((await refreshTokens(next.body.refresh_token, "helmc_other")).body.error).toBe("invalid_grant");

    // The client lost the answer and retries with the token it still has.
    const retry = await refreshTokens(tokens.refresh_token, clientId);
    expect(retry.status).toBe(200);
    expect((await listTools(retry.body.access_token)).status).toBe(200);
    expect((await refreshTokens(retry.body.refresh_token, clientId)).status).toBe(200);
  });

  test("reusing a refresh token rotated long ago revokes the connection", async () => {
    const { owner, clientId, tokens } = await connect();
    const [connection] = await owner.connections();
    const { createHash } = await import("node:crypto");
    const { importRows } = await import("./helpers");
    const selector = "R".repeat(21) + Math.floor(Math.random() * 10);
    const secret = "r".repeat(42) + Math.floor(Math.random() * 10);
    await importRows("oauthTokens", [
      {
        grantId: connection.id,
        kind: "refresh",
        selector,
        secretHash: createHash("sha256").update(secret).digest("hex"),
        createdAt: Date.now() - 120_000,
        expiresAt: Date.now() + 60_000,
        rotatedAt: Date.now() - 60_000,
      },
    ]);
    const replay = await refreshTokens(`helmrt_${selector}.${secret}`, clientId);
    expect(replay.body.error).toBe("invalid_grant");
    expect((await listTools(tokens.access_token)).status).toBe(401);
    expect((await refreshTokens(tokens.refresh_token, clientId)).body.error).toBe("invalid_grant");
    expect((await owner.connections())[0].active).toBe(false);
  });

  test("a refresh may narrow the scopes, the narrowing sticks, and it cannot widen them", async () => {
    const read = await connect({ grant: ["tasks:read"] });
    const wider = await refreshTokens(read.tokens.refresh_token, read.clientId, { scope: "tasks:read tasks:write" });
    expect(wider.body.error).toBe("invalid_scope");

    const both = await connect();
    const narrowed = await refreshTokens(both.tokens.refresh_token, both.clientId, { scope: "tasks:read" });
    expect(narrowed.body.scope).toBe("tasks:read");
    const tools = (await (await listTools(narrowed.body.access_token)).json()).result.tools.map((t: { name: string }) => t.name);
    expect(tools).toContain("list_today");
    expect(tools).not.toContain("add_task");
    expect((await callToolRaw(narrowed.body.access_token, "add_task", { title: "x" })).status).toBe(403);
    const later = await refreshTokens(narrowed.body.refresh_token, both.clientId);
    expect(later.body.scope).toBe("tasks:read");
    const back = await refreshTokens(later.body.refresh_token, both.clientId, { scope: "tasks:read tasks:write" });
    expect(back.body.error).toBe("invalid_scope");
  });

  test("failed code exchanges do not lock the token endpoint for anyone", async () => {
    for (let i = 0; i < 35; i++) {
      const wrong = await exchangeCode({ code: `helmac_${"x".repeat(43)}${i}`, verifier: pkce().verifier, clientId: cimdClientId() });
      expect(wrong.status).toBe(400);
    }
    const { verifier, code } = await approvedCode();
    expect((await exchangeCode({ code, verifier, clientId: cimdClientId() })).status).toBe(200);
  });
});

describe("tokens at the protected resource", () => {
  async function insertToken(grantId: string, fields: Record<string, unknown>) {
    const { importRows } = await import("./helpers");
    const { createHash } = await import("node:crypto");
    // Random enough that two tokens of one run never share a selector (lookups use .unique()).
    const selector = "S".repeat(16) + String(Math.floor(Math.random() * 1e6)).padStart(6, "0");
    const secret = "s".repeat(37) + String(Math.floor(Math.random() * 1e6)).padStart(6, "0");
    await importRows("oauthTokens", [
      {
        grantId,
        kind: "access",
        selector,
        secretHash: createHash("sha256").update(secret).digest("hex"),
        createdAt: Date.now(),
        expiresAt: Date.now() + 60_000,
        ...fields,
      },
    ]);
    return `helmat_${selector}.${secret}`;
  }

  test("an expired access token gets 401", async () => {
    const { owner } = await connect();
    const [connection] = await owner.connections();
    const expired = await insertToken(connection.id, { expiresAt: Date.now() - 1000 });
    const response = await listTools(expired);
    expect(response.status).toBe(401);
    expect(response.headers.get("www-authenticate")).toContain('error="invalid_token"');
    expect((await listTools(await insertToken(connection.id, {}))).status).toBe(200);
  });

  test("a token issued for another resource (audience) gets 401", async () => {
    const { importRows } = await import("./helpers");
    const owner = await phone();
    await importRows("oauthGrants", [
      {
        userId: owner.userId,
        clientId: cimdClientId(),
        clientType: "cimd",
        clientName: "Elsewhere",
        redirectUri: CLAUDE_CALLBACK,
        scopes: ["tasks:read", "tasks:write"],
        resource: "https://other.example/mcp",
        createdAt: Date.now(),
        refreshExpiresAt: Date.now() + 60_000,
      },
    ]);
    const [grant] = await owner.connections();
    expect((await listTools(await insertToken(grant.id, {}))).status).toBe(401);
  });

  test("revoking a connection on the phone or with dayhand stops its tokens at once", async () => {
    const first = await connect();
    const [connection] = await first.owner.connections();
    await first.owner.revoke(connection.id);
    expect((await listTools(first.tokens.access_token)).status).toBe(401);
    expect((await refreshTokens(first.tokens.refresh_token, first.clientId)).body.error).toBe("invalid_grant");

    // The CLI side: /connections with the owner's API key.
    const second = await connect();
    const key = await createKey(second.owner.userId, "macbook", "cli");
    const headers = { Authorization: `Bearer ${key}`, "Content-Type": "application/json" };
    const listed = await (await fetch(`${site()}/connections`, { headers })).json();
    expect(listed.connections).toHaveLength(1);
    expect(listed.connections[0]).not.toHaveProperty("secretHash");
    const revoked = await fetch(`${site()}/connections/revoke`, { method: "POST", headers, body: JSON.stringify({ connectionId: listed.connections[0].id }) });
    expect(revoked.status).toBe(200);
    expect((await listTools(second.tokens.access_token)).status).toBe(401);
  });

  test("the RFC 7009 endpoint revokes the connection", async () => {
    const { clientId, tokens } = await connect();
    const { postForm } = await import("./oauthClient");
    expect((await postForm("/oauth/revoke", { token: tokens.access_token, client_id: clientId })).status).toBe(200);
    expect((await listTools(tokens.access_token)).status).toBe(401);
    expect((await postForm("/oauth/revoke", { token: "nonsense", client_id: clientId })).status).toBe(200);
  });

  test("OAuth tokens cannot manage devices or connections; API keys still work on /mcp", async () => {
    const { owner, tokens } = await connect();
    const bearer = { Authorization: `Bearer ${tokens.access_token}` };
    expect((await fetch(`${site()}/devices`, { headers: bearer })).status).toBe(401);
    expect((await fetch(`${site()}/connections`, { headers: bearer })).status).toBe(401);
    const key = await createKey(owner.userId, "claude-code");
    expect((await listTools(key)).status).toBe(200);
    expect((await (await listTools(key)).json()).result.tools).toHaveLength(32);
  });
});
