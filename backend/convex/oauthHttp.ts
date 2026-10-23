// HTTP endpoints of Helm's OAuth 2.1 authorization server (protocol: docs/oauth.md).
//   GET  /.well-known/oauth-protected-resource[/mcp]  RFC 9728 metadata of /mcp
//   GET  /.well-known/oauth-authorization-server      RFC 8414 metadata
//   GET  /oauth/authorize            check the request, show the code to approve on the phone
//   POST /oauth/authorize/status     the page polls whether the phone decided
//   POST /oauth/authorize/continue   send the browser back with a code (or access_denied)
//   POST /oauth/token                authorization_code (PKCE S256) and refresh_token grants
//   POST /oauth/register             Dynamic Client Registration (public clients only)
//   POST /oauth/revoke               RFC 7009
// Nothing here logs a code, token or handle.
import { internal } from "./_generated/api";
import { httpAction, type ActionCtx } from "./_generated/server";
import { fetchClientMetadata } from "./lib/cimd";
import { errorResponse, json, readJsonBody } from "./lib/http";
import { ACCESS_TOKEN_TTL_MS, publicUrl, resourceFor, resourceMetadataFor, SCOPES, type Scope } from "./lib/oauthConfig";
import { errorPage, pageLang, waitingPage, type Lang } from "./lib/oauthPage";
import {
  checkRegistration,
  formatScopes,
  isCodeChallenge,
  isCodeVerifier,
  isState,
  parseScopes,
  redirectHost,
  redirectKind,
  redirectMatches,
  resourceMatches,
  type ClientInfo,
} from "./lib/oauthRules";
import {
  bytesToBase64url,
  newAuthorizationCode,
  newSelectorToken,
  newUserCode,
  normalizeUserCode,
  parseSelectorToken,
  randomBase64url,
  sha256Hex,
} from "./lib/secrets";

const MAX_FORM_BYTES = 8 * 1024;
const noStore = { "Cache-Control": "no-store", Pragma: "no-cache" };
const notConfigured = () => errorResponse(503, "not_configured", "The deployment's public URL is not known");

/** An application/x-www-form-urlencoded body, or null when it is something else or too large. */
async function readForm(request: Request): Promise<URLSearchParams | null> {
  const type = request.headers.get("Content-Type") ?? "";
  if (!/^application\/x-www-form-urlencoded\b/i.test(type)) return null;
  const text = await request.text();
  return text.length > MAX_FORM_BYTES ? null : new URLSearchParams(text);
}

async function s256(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  return bytesToBase64url(new Uint8Array(digest));
}

// ---- Discovery ----

export const protectedResourceMetadata = httpAction(async () => {
  const base = publicUrl();
  if (!base) return notConfigured();
  return json({
    resource: resourceFor(base),
    authorization_servers: [base],
    scopes_supported: SCOPES,
    bearer_methods_supported: ["header"],
    resource_name: "Helm",
  });
});

export const authorizationServerMetadata = httpAction(async () => {
  const base = publicUrl();
  if (!base) return notConfigured();
  return json({
    issuer: base,
    authorization_endpoint: `${base}/oauth/authorize`,
    token_endpoint: `${base}/oauth/token`,
    registration_endpoint: `${base}/oauth/register`,
    revocation_endpoint: `${base}/oauth/revoke`,
    scopes_supported: SCOPES,
    response_types_supported: ["code"],
    response_modes_supported: ["query"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    token_endpoint_auth_methods_supported: ["none"],
    revocation_endpoint_auth_methods_supported: ["none"],
    code_challenge_methods_supported: ["S256"],
    client_id_metadata_document_supported: true,
    authorization_response_iss_parameter_supported: true,
  });
});

// ---- Authorization endpoint ----

const MESSAGES = {
  en: {
    noClient: "The request names no client (client_id).",
    unknownClient: "Unknown client.",
    badRedirect: "The redirect URI is not one this client registered, or not one of Claude's.",
    limited: (minutes: number) => `Too many connection requests. Try again in ${minutes} min.`,
    expired: "This request has expired or was already used. Start connecting again.",
  },
  pl: {
    noClient: "Żądanie nie wskazuje klienta (client_id).",
    unknownClient: "Nieznany klient.",
    badRedirect: "Adres powrotu nie jest zarejestrowany przez tego klienta albo nie jest adresem Claude.",
    limited: (minutes: number) => `Za dużo prób połączenia. Spróbuj ponownie za ${minutes} min.`,
    expired: "Ta prośba wygasła albo została już użyta. Zacznij łączenie od nowa.",
  },
};

function redirectWith(redirectUri: string, params: Record<string, string | null>): Response {
  const url = new URL(redirectUri);
  for (const [key, value] of Object.entries(params)) if (value !== null) url.searchParams.set(key, value);
  return new Response(null, { status: 303, headers: { Location: url.toString(), ...noStore, "Referrer-Policy": "no-referrer" } });
}

async function resolveClient(ctx: ActionCtx, clientId: string): Promise<{ type: "cimd" | "dcr"; client: ClientInfo } | null> {
  if (/^https?:\/\//i.test(clientId)) {
    const checked = await fetchClientMetadata(clientId);
    if (!checked.ok) console.warn(`Client metadata refused: ${checked.error}`);
    return checked.ok ? { type: "cimd", client: checked.client } : null;
  }
  const client = await ctx.runQuery(internal.oauth.getClient, { clientId });
  return client ? { type: "dcr", client } : null;
}

export const authorize = httpAction(async (ctx, request) => {
  const lang: Lang = pageLang(request);
  const text = MESSAGES[lang];
  const base = publicUrl();
  if (!base) return errorPage(lang, "Not configured", 503);
  const params = new URL(request.url).searchParams;
  const clientId = params.get("client_id");
  if (!clientId) return errorPage(lang, text.noClient);
  const resolved = await resolveClient(ctx, clientId);
  if (!resolved) return errorPage(lang, text.unknownClient);
  const redirectUri = params.get("redirect_uri") ?? "";
  if (!redirectMatches(redirectUri, resolved.client.redirectUris)) return errorPage(lang, text.badRedirect);

  // From here on, errors go back to the client (RFC 6749 section 4.1.2.1).
  const rawState = params.get("state");
  const state = rawState !== null && isState(rawState) ? rawState : null;
  const fail = (error: string, description: string) =>
    redirectWith(redirectUri, { error, error_description: description, state, iss: base });
  if (rawState !== null && state === null) return fail("invalid_request", "state is too long or not printable");
  if (params.get("response_type") !== "code") return fail("unsupported_response_type", "Only response_type=code is supported");
  const challenge = params.get("code_challenge") ?? "";
  if (params.get("code_challenge_method") !== "S256" || !isCodeChallenge(challenge)) {
    return fail("invalid_request", "PKCE with code_challenge_method=S256 is required");
  }
  const scopes = parseScopes(params.get("scope"));
  if (!scopes.ok) return fail("invalid_scope", scopes.error);
  const resource = resourceFor(base);
  if (!resourceMatches(params.get("resource"), resource)) return fail("invalid_target", `The only resource is ${resource}`);

  const handle = newSelectorToken("helmrq_");
  for (let attempt = 0; attempt < 5; attempt++) {
    const userCode = newUserCode();
    const created = await ctx.runMutation(internal.oauth.createRequest, {
      selector: handle.selector,
      secretHash: await sha256Hex(handle.secret),
      userCodeHash: await sha256Hex(normalizeUserCode(userCode)!),
      clientId,
      clientType: resolved.type,
      clientName: resolved.client.name,
      redirectUri,
      state: state ?? undefined,
      codeChallenge: challenge,
      scopes: scopes.scopes,
      resource,
    });
    if (created.ok) {
      return waitingPage({
        lang,
        clientName: resolved.client.name,
        userCode,
        scopes: scopes.scopes,
        redirectHost: redirectHost(redirectUri),
        redirectOrigin: new URL(redirectUri).origin,
        loopback: redirectKind(redirectUri) === "loopback",
        handle: handle.token,
      });
    }
    if (created.reason === "rate_limited") {
      return errorPage(lang, text.limited(Math.max(1, Math.ceil(created.retryAfterMs / 60_000))), 429);
    }
  }
  throw new Error("Could not draw an unused approval code");
});

function parseHandle(form: URLSearchParams | null) {
  return parseSelectorToken("helmrq_", form?.get("request") ?? "");
}

export const authorizeStatus = httpAction(async (ctx, request) => {
  const handle = parseHandle(await readForm(request));
  if (!handle) return json({ status: "unknown" }, 400, noStore);
  const status = await ctx.runQuery(internal.oauth.requestStatus, {
    selector: handle.selector,
    secretHash: await sha256Hex(handle.secret),
  });
  return json({ status: status ?? "unknown" }, 200, noStore);
});

export const authorizeContinue = httpAction(async (ctx, request) => {
  const lang = pageLang(request);
  const base = publicUrl();
  if (!base) return errorPage(lang, "Not configured", 503);
  const form = await readForm(request);
  const handle = parseHandle(form);
  if (!handle) return errorPage(lang, MESSAGES[lang].expired);
  const code = newAuthorizationCode();
  const finished = await ctx.runMutation(internal.oauth.finishRequest, {
    selector: handle.selector,
    secretHash: await sha256Hex(handle.secret),
    codeHash: await sha256Hex(code),
  });
  if (finished.status === "approved") return redirectWith(finished.redirectUri, { code, state: finished.state, iss: base });
  if (finished.status === "denied") {
    return redirectWith(finished.redirectUri, {
      error: "access_denied",
      error_description: "The owner refused the connection",
      state: finished.state,
      iss: base,
    });
  }
  if (finished.status === "pending") {
    const userCode = normalizeUserCode(form?.get("code") ?? "");
    return waitingPage({
      lang,
      clientName: finished.clientName,
      userCode: userCode ? `${userCode.slice(0, 4)}-${userCode.slice(4)}` : "",
      scopes: finished.scopes,
      redirectHost: redirectHost(finished.redirectUri),
      redirectOrigin: new URL(finished.redirectUri).origin,
      loopback: redirectKind(finished.redirectUri) === "loopback",
      handle: form!.get("request")!,
      notYet: true,
    });
  }
  return errorPage(lang, MESSAGES[lang].expired);
});

// ---- Token endpoint ----

const tokenError = (status: number, error: string, description: string, headers: Record<string, string> = {}) =>
  errorResponse(status, error, description, { ...noStore, ...headers });

function newTokenPair() {
  return { access: newSelectorToken("helmat_"), refresh: newSelectorToken("helmrt_") };
}

async function tokenHashes(pair: ReturnType<typeof newTokenPair>) {
  return {
    accessSelector: pair.access.selector,
    accessHash: await sha256Hex(pair.access.secret),
    refreshSelector: pair.refresh.selector,
    refreshHash: await sha256Hex(pair.refresh.secret),
  };
}

type GrantResult = { ok: true; scopes: Scope[] } | { ok: false; error: string; description: string };

function tokenAnswer(result: GrantResult, pair: ReturnType<typeof newTokenPair>): Response {
  if (result.ok) {
    return json(
      {
        access_token: pair.access.token,
        token_type: "Bearer",
        expires_in: ACCESS_TOKEN_TTL_MS / 1000,
        refresh_token: pair.refresh.token,
        scope: formatScopes(result.scopes),
      },
      200,
      noStore,
    );
  }
  return tokenError(400, result.error, result.description);
}

export const token = httpAction(async (ctx, request) => {
  const base = publicUrl();
  if (!base) return notConfigured();
  const form = await readForm(request);
  if (!form) return tokenError(400, "invalid_request", "The body must be application/x-www-form-urlencoded");
  if (form.has("client_secret") || /^Basic\s/i.test(request.headers.get("Authorization") ?? "")) {
    return tokenError(401, "invalid_client", "Only public clients are supported; send no client secret");
  }
  const clientId = form.get("client_id");
  if (!clientId) return tokenError(400, "invalid_request", "client_id is required");
  const resourceParam = form.get("resource");
  const resource = resourceFor(base);
  if (!resourceMatches(resourceParam, resource)) return tokenError(400, "invalid_target", `The only resource is ${resource}`);
  const pair = newTokenPair();
  const grantType = form.get("grant_type");

  if (grantType === "authorization_code") {
    const code = form.get("code");
    const verifier = form.get("code_verifier") ?? "";
    const redirectUri = form.get("redirect_uri");
    if (!code || !redirectUri) return tokenError(400, "invalid_request", "code and redirect_uri are required");
    if (!isCodeVerifier(verifier)) return tokenError(400, "invalid_request", "A PKCE code_verifier is required");
    const result = await ctx.runMutation(internal.oauth.exchangeCode, {
      codeHash: await sha256Hex(code),
      clientId,
      redirectUri,
      challenge: await s256(verifier),
      resource,
      ...(await tokenHashes(pair)),
    });
    return tokenAnswer(result, pair);
  }

  if (grantType === "refresh_token") {
    const parsed = parseSelectorToken("helmrt_", form.get("refresh_token") ?? "");
    if (!parsed) return tokenError(400, "invalid_grant", "The code or token is not valid");
    const scope = form.get("scope");
    const scopes = scope ? parseScopes(scope) : null;
    if (scopes && !scopes.ok) return tokenError(400, "invalid_scope", scopes.error);
    const result = await ctx.runMutation(internal.oauth.refresh, {
      selector: parsed.selector,
      secretHash: await sha256Hex(parsed.secret),
      clientId,
      resource,
      scopes: scopes?.scopes,
      ...(await tokenHashes(pair)),
    });
    return tokenAnswer(result, pair);
  }

  return tokenError(400, "unsupported_grant_type", "grant_type must be authorization_code or refresh_token");
});

// ---- Registration and revocation ----

export const register = httpAction(async (ctx, request) => {
  const body = await readJsonBody(request);
  if (!body) return errorResponse(400, "invalid_client_metadata", "The body must be a JSON object of at most 4 KB");
  const checked = checkRegistration(body);
  if (!checked.ok) {
    const error = /redirect/i.test(checked.error) ? "invalid_redirect_uri" : "invalid_client_metadata";
    return errorResponse(400, error, checked.error);
  }
  const clientId = `helmc_${randomBase64url(16)}`;
  const created = await ctx.runMutation(internal.oauth.registerClient, { clientId, ...checked.client });
  if (!created.ok) {
    return errorResponse(429, "rate_limited", "Too many registrations; try again later", {
      "Retry-After": String(Math.ceil(created.retryAfterMs / 1000)),
    });
  }
  return json(
    {
      client_id: clientId,
      client_id_issued_at: Math.floor(created.createdAt / 1000),
      client_name: checked.client.name,
      redirect_uris: checked.client.redirectUris,
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
    },
    201,
    noStore,
  );
});

export const revoke = httpAction(async (ctx, request) => {
  const form = await readForm(request);
  const value = form?.get("token");
  const clientId = form?.get("client_id");
  if (!value || !clientId) return errorResponse(400, "invalid_request", "token and client_id are required");
  const parsed = parseSelectorToken("helmat_", value) ?? parseSelectorToken("helmrt_", value);
  if (parsed) {
    await ctx.runMutation(internal.oauth.revokeToken, {
      selector: parsed.selector,
      secretHash: await sha256Hex(parsed.secret),
      clientId,
    });
  }
  return new Response(null, { status: 200, headers: noStore });
});
