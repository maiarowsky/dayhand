// The pure OAuth rules (convex/lib/oauthRules.ts): redirect URIs, scopes, PKCE
// formats and client metadata, including the documents Claude publishes.
import { describe, expect, test } from "vitest";
import {
  checkGranted,
  checkMetadataDocument,
  checkRegistration,
  cimdUrlProblem,
  cleanName,
  isCodeChallenge,
  isCodeVerifier,
  parseScopes,
  redirectKind,
  redirectMatches,
  resourceMatches,
} from "../convex/lib/oauthRules";

const CLAUDE_APP = "https://claude.ai/oauth/mcp-oauth-client-metadata";
const CLAUDE_CODE = "https://claude.ai/oauth/claude-code-client-metadata";
const CALLBACK = "https://claude.ai/api/mcp/auth_callback";

describe("Claude's published client metadata", () => {
  test("the Claude apps' document, as served by claude.ai, is accepted", () => {
    // Copied verbatim from CLAUDE_APP (fetched 2026-10-23); it also lists the JWT bearer grant.
    const doc = {
      client_id: CLAUDE_APP,
      client_name: "Claude",
      client_uri: "https://claude.ai",
      redirect_uris: [CALLBACK],
      grant_types: ["authorization_code", "refresh_token", "urn:ietf:params:oauth:grant-type:jwt-bearer"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
    };
    expect(cimdUrlProblem(CLAUDE_APP, ["https://claude.ai"])).toBeNull();
    expect(checkMetadataDocument(CLAUDE_APP, doc)).toEqual({ ok: true, client: { name: "Claude", redirectUris: [CALLBACK] } });
  });

  test("Claude Code's loopback redirect URIs are accepted", () => {
    const doc = {
      client_id: CLAUDE_CODE,
      client_name: "Claude Code",
      redirect_uris: ["http://localhost/callback", "http://127.0.0.1/callback"],
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
    };
    expect(checkMetadataDocument(CLAUDE_CODE, doc).ok).toBe(true);
  });

  test("documents Helm must not trust", () => {
    const base = { client_id: CLAUDE_APP, redirect_uris: [CALLBACK] };
    expect(checkMetadataDocument(CLAUDE_APP, { ...base, client_id: CLAUDE_CODE }).ok).toBe(false);
    expect(checkMetadataDocument(CLAUDE_APP, { ...base, client_secret: "x" }).ok).toBe(false);
    expect(checkMetadataDocument(CLAUDE_APP, { ...base, token_endpoint_auth_method: "client_secret_basic" }).ok).toBe(false);
    expect(checkMetadataDocument(CLAUDE_APP, { ...base, grant_types: ["client_credentials"] }).ok).toBe(false);
    expect(checkMetadataDocument(CLAUDE_APP, { ...base, response_types: ["token"] }).ok).toBe(false);
    expect(checkMetadataDocument(CLAUDE_APP, { ...base, redirect_uris: ["https://evil.example/cb"] }).ok).toBe(false);
    expect(checkMetadataDocument(CLAUDE_APP, { ...base, redirect_uris: [] }).ok).toBe(false);
    expect(checkMetadataDocument(CLAUDE_APP, [base]).ok).toBe(false);
  });

  test("only metadata URLs on the allowed origins", () => {
    const allowed = ["https://claude.ai"];
    expect(cimdUrlProblem("https://evil.example/oauth/meta", allowed)).toMatch(/not accepted/);
    expect(cimdUrlProblem("http://claude.ai/oauth/meta", allowed)).toMatch(/not accepted/);
    expect(cimdUrlProblem("https://claude.ai.evil.example/meta", allowed)).toMatch(/not accepted/);
    expect(cimdUrlProblem("https://user@claude.ai/meta", allowed)).not.toBeNull();
    expect(cimdUrlProblem("https://claude.ai/", allowed)).not.toBeNull();
    expect(cimdUrlProblem("https://claude.ai/meta#x", allowed)).not.toBeNull();
    expect(cimdUrlProblem("helmc_abc", allowed)).not.toBeNull();
  });
});

describe("redirect URIs", () => {
  test("only Claude's callbacks", () => {
    expect(redirectKind(CALLBACK)).toBe("app");
    expect(redirectKind("http://localhost:53682/callback")).toBe("loopback");
    expect(redirectKind("http://127.0.0.1/callback")).toBe("loopback");
    for (const uri of [
      "https://claude.ai/api/mcp/auth_callback/",
      "https://claude.ai/api/mcp/auth_callback?x=1",
      "https://claude.ai.evil.example/api/mcp/auth_callback",
      "https://claude.com/api/mcp/auth_callback",
      "http://claude.ai/api/mcp/auth_callback",
      "https://localhost/callback",
      "http://localhost/callback/",
      "http://localhost/callback?x=1",
      "http://localhost/callback#x",
      "http://user@localhost/callback",
      "http://[::1]/callback",
      "http://127.1/callback",
      "http://0x7f000001/callback",
      "http://localhost.evil.example/callback",
      "http://LOCALHOST/callback",
      "javascript:alert(1)",
      "",
    ]) {
      expect(redirectKind(uri), uri).toBeNull();
    }
  });

  test("a loopback URI matches a registered one on any port, the app callback only exactly", () => {
    expect(redirectMatches("http://localhost:4000/callback", ["http://localhost/callback"])).toBe(true);
    expect(redirectMatches("http://127.0.0.1:4000/callback", ["http://localhost/callback"])).toBe(false);
    expect(redirectMatches(CALLBACK, ["http://localhost/callback"])).toBe(false);
    expect(redirectMatches(CALLBACK, [CALLBACK])).toBe(true);
    expect(redirectMatches("https://evil.example/cb", ["https://evil.example/cb"])).toBe(false);
  });
});

describe("scopes, PKCE and the resource", () => {
  test("scopes", () => {
    expect(parseScopes(undefined)).toEqual({ ok: true, scopes: ["tasks:read"] });
    expect(parseScopes("offline_access")).toEqual({ ok: true, scopes: ["tasks:read"] });
    expect(parseScopes("tasks:write tasks:read")).toEqual({ ok: true, scopes: ["tasks:read", "tasks:write"] });
    expect(parseScopes("tasks:read admin").ok).toBe(false);
    expect(checkGranted(["tasks:read"], ["tasks:read", "tasks:write"])).toBeNull();
    expect(checkGranted(["tasks:read", "tasks:write"], [])).toBeNull();
    expect(checkGranted(["tasks:read", "tasks:write"], ["tasks:write"])).toEqual(["tasks:write"]);
  });

  test("PKCE formats", () => {
    expect(isCodeVerifier("a".repeat(42))).toBe(false);
    expect(isCodeVerifier("a".repeat(43))).toBe(true);
    expect(isCodeVerifier("a".repeat(129))).toBe(false);
    expect(isCodeChallenge("A".repeat(43))).toBe(true);
    expect(isCodeChallenge("A".repeat(42) + "=")).toBe(false);
  });

  test("the resource indicator", () => {
    const resource = "https://helm.example/mcp";
    expect(resourceMatches(undefined, resource)).toBe(true);
    expect(resourceMatches("https://helm.example/mcp/", resource)).toBe(true);
    expect(resourceMatches("https://helm.example", resource)).toBe(false);
    expect(resourceMatches("https://other.example/mcp", resource)).toBe(false);
  });

  test("client names are printable and short", () => {
    expect(cleanName("Cla‮ude\u0000", "x")).toBe("Claude");
    expect(cleanName("   ", "fallback")).toBe("fallback");
    expect(cleanName(42, "fallback")).toBe("fallback");
    expect(cleanName("x".repeat(100), "f")).toHaveLength(60);
    expect(checkRegistration({ redirect_uris: [CALLBACK] })).toEqual({ ok: true, client: { name: "Unnamed client", redirectUris: [CALLBACK] } });
  });
});
