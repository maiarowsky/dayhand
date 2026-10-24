# OAuth: connecting the Claude apps and other MCP clients

The hosted Claude apps (claude.ai on the web, Claude Desktop, Claude for Android and iOS) add a
remote MCP server as a *custom connector* and sign in to it with OAuth; a fixed API key header
is only a beta for some organizations
([claude.com/docs, add-unlisted](https://claude.com/docs/connectors/custom/add-unlisted)).
Dayhand therefore runs a small OAuth 2.1 authorization server next to its MCP endpoint. Personal
API keys keep working unchanged for the CLI and for agents that can send a header
([mcp.md](mcp.md#keys-and-actors)).

**The owner approves every connection on the paired phone.** Dayhand has no web sign-in: the
authorization page in the browser shows a code, and the owner types that code into the Dayhand app
(Settings → Agent connections → Approve a connection), sees who asks for what, and approves or
refuses. The threat model is in [oauth-threat-model.md](oauth-threat-model.md).

```
Claude ──POST /mcp (no token)──────────────────────> 401, WWW-Authenticate: resource_metadata=…
Claude ──GET /.well-known/oauth-protected-resource/mcp, /.well-known/oauth-authorization-server
Claude ──(POST /oauth/register, or its client metadata URL as client_id)
browser ─GET /oauth/authorize?…&code_challenge=…(S256)&resource=…/mcp
         <── page: "Approve on your phone", code K7QF-M2XA
phone ───app.lookupConnectionRequest {code} ──> who, which scopes, where it returns
phone ───app.decideConnectionRequest {code, approve, scopes}
browser ─(page polls POST /oauth/authorize/status, then POST /oauth/authorize/continue)
         <── 303 https://claude.ai/api/mcp/auth_callback?code=…&state=…&iss=…
Claude ──POST /oauth/token (code + code_verifier) ──> access token (1 h) + refresh token (60 days)
Claude ──POST /mcp, Authorization: Bearer helmat_… ──> tools allowed by the scopes
```

## Endpoints

All on the deployment's HTTP actions URL (`https://<name>.convex.site`, locally
`http://127.0.0.1:3211`). That URL is the issuer; `<issuer>/mcp` is the protected resource.

| Endpoint | Purpose |
|---|---|
| `GET /.well-known/oauth-protected-resource` and `…/oauth-protected-resource/mcp` | [RFC 9728](https://www.rfc-editor.org/rfc/rfc9728) metadata: `resource` (`<issuer>/mcp`), `authorization_servers` (`[<issuer>]`), `scopes_supported` |
| `GET /.well-known/oauth-authorization-server` | [RFC 8414](https://www.rfc-editor.org/rfc/rfc8414) metadata: endpoints, `code_challenge_methods_supported: ["S256"]`, `token_endpoint_auth_methods_supported: ["none"]`, `client_id_metadata_document_supported: true`, `authorization_response_iss_parameter_supported: true` |
| `GET /oauth/authorize` | Checks the request and shows the page with the code (HTML, English or Polish by `Accept-Language`) |
| `POST /oauth/authorize/status` | The page polls whether the phone decided (form field `request`) |
| `POST /oauth/authorize/continue` | Sends the browser back to the client with a code, or with `error=access_denied` |
| `POST /oauth/token` | `authorization_code` and `refresh_token` grants, `application/x-www-form-urlencoded` |
| `POST /oauth/register` | Dynamic Client Registration ([RFC 7591](https://www.rfc-editor.org/rfc/rfc7591)), JSON, public clients only |
| `POST /oauth/revoke` | [RFC 7009](https://www.rfc-editor.org/rfc/rfc7009) revocation (form: `token`, `client_id`) |
| `GET /connections`, `POST /connections/revoke` | The owner's list and revocation with a personal API key (`dayhand connection`) |

`/mcp` answers a request without a valid credential with `401` and
`WWW-Authenticate: Bearer realm="dayhand", scope="tasks:read tasks:write", resource_metadata="<issuer>/.well-known/oauth-protected-resource/mcp"`
(plus `error="invalid_token"` when a token was sent but is not valid).

## Clients and redirect URIs

A client is identified in one of two ways:

- **Client ID Metadata Document** (Claude's "Use Claude's published identity"): `client_id` is
  an HTTPS URL that Dayhand fetches. The Claude apps use
  `https://claude.ai/oauth/mcp-oauth-client-metadata`, Claude Code
  `https://claude.ai/oauth/claude-code-client-metadata`. Only URLs on the allowed origins are
  fetched, by default only `https://claude.ai`; no redirects are followed, the answer is limited
  to 16 KB and 5 seconds. The document's `client_id` must equal its URL,
  `token_endpoint_auth_method` must be `none` (or absent), `grant_types` and `response_types`
  (when given) must include `authorization_code` and `code`, and its `redirect_uris` must all be
  Claude's (below). Other grant types the document lists, such as the JWT bearer grant in
  Claude's, are ignored: the token endpoint offers only `authorization_code` and
  `refresh_token`. Claude uses this method only because the metadata advertises
  `client_id_metadata_document_supported` and the auth method `none`.
- **Dynamic Client Registration** (Claude's "Register automatically"): `POST /oauth/register`
  with `redirect_uris` (Claude's only), optional `client_name`; no client secret is ever issued.
  Registrations nobody used are deleted after 7 days.

**Redirect URIs** are limited to the callbacks Claude documents
([authentication for connectors](https://claude.com/docs/connectors/building/authentication#callback-urls)):

- `https://claude.ai/api/mcp/auth_callback`: the hosted Claude apps (web, desktop, mobile,
  Cowork), matched exactly;
- `http://localhost/callback` and `http://127.0.0.1/callback` on any port: Claude Code's loopback
  redirect, as its own metadata document (`https://claude.ai/oauth/claude-code-client-metadata`)
  declares. The page and the phone show a warning for these.

The requested `redirect_uri` must also be one the client registered. A request with an unknown
client or a wrong redirect URI gets an error page and is never redirected.

## Requests, scopes and tokens

- **PKCE is required**: `code_challenge_method=S256` and a 43-character challenge; `plain` and
  requests without PKCE are refused with `error=invalid_request`.
- **Scopes**: `tasks:read` (`list_today`, `list_all`, `list_trash`, `board`, `get_task`,
  `export_plan`, `get_settings`) and `tasks:write` (every other tool). A request without `scope`
  asks for `tasks:read` only; unknown scopes are refused (`invalid_scope`); `offline_access` is
  ignored. The phone may grant a non-empty part of what was asked, never more. `tools/list`
  shows only the tools the token's scopes allow; calling another tool gets
  `403` with `WWW-Authenticate: Bearer error="insufficient_scope", scope="…"`. Reading the
  user's data through `resources/read` (all but `dayhand://guide` and `dayhand://workflow/…`) and `prompts/get` needs
  `tasks:read` the same way.
- **Resource indicators** ([RFC 8707](https://www.rfc-editor.org/rfc/rfc8707)): `resource`, when
  sent to `/oauth/authorize` or `/oauth/token`, must be `<issuer>/mcp`; every token is bound to
  it and `/mcp` refuses a token bound to anything else.
- **The request** waits 10 minutes for the phone; the code shown in the browser is 8 Crockford
  base32 characters, stored only as SHA-256.
- **The authorization code** is valid 2 minutes and dies on its first presentation, right or
  wrong. Presenting a used code again revokes the connection it created.
- **Access tokens** (`helmat_…`) last one hour; **refresh tokens** (`helmrt_…`) 60 days and are
  rotated on every refresh. Using a refresh token a second time revokes the whole connection,
  unless it comes back within 30 seconds of its first use: that is a client retrying after a
  lost answer, so it gets a new pair and the pair it never saw stops refreshing. A refresh may
  ask for fewer scopes (`scope`), and the narrower scopes stay with the tokens that follow; it
  can never ask for more (`invalid_scope`). Both tokens are a selector plus a 256-bit secret
  stored as SHA-256 only, like device tokens.
- The token answer carries `Cache-Control: no-store`. Errors follow RFC 6749 (`invalid_grant`,
  `invalid_request`, `invalid_client` for a client secret, `unsupported_grant_type`,
  `invalid_scope`, `invalid_target`).

## Connections, history and revocation

An approved request becomes a **connection** when the client exchanges its code. Changes made
through it are recorded as `actor: "agent"` with the client's name as `actorName`, so history
shows e.g. `agent: Claude` ([mcp.md](mcp.md#keys-and-actors)); the connection's id is stored with
each change. Approvals, refusals and revocations are recorded in history too.

- **Phone**: Settings → Agent connections lists the connected agents (where they come from, read
  only or read and change, last use); tapping one disconnects it.
- **CLI**: `dayhand connection list` (or `dayhand connections`) and `dayhand connection revoke <id>`
  ([cli.md](cli.md)).
- **Admin**: `npx convex run oauthOwner:list '{"userId":"<issuer>|owner","actor":"app"}'` and
  `npx convex run oauthOwner:revoke '{"userId":"<issuer>|owner","actor":"app","id":"<connectionId>"}'`.

Revocation takes effect on the next request: access and refresh tokens of a revoked connection
are refused at once (unlike a revoked phone's app JWT, which lives up to an hour).

## Limits

| What | Limit | Over the limit |
|---|---|---|
| Waiting requests per client (`client_id`) | 5 at a time, 20 started per 10 minutes | `429` page |
| Waiting requests, whole deployment | 300 started per 10 minutes (a flood guard) | `429` page |
| Registrations | 100 per hour, whole deployment | `429` (`rate_limited`) |
| Wrong codes typed on the phone | 10 per 10 minutes per user | the app says so |
| MCP calls per connection | 120 reads and 60 changes a minute, as for an API key ([mcp.md](mcp.md#limits)) | tool error `rate_limited` or `429` |

`npx convex run oauth:resetLimits` clears all OAuth counters. The token endpoint has no lockout:
codes and tokens carry 256 bits, so guessing is hopeless, and a lockout would only let anyone
block real clients. Someone who floods the authorization endpoint with Claude's own `client_id`
can delay new Claude connections for up to ten minutes, never get one; registering
automatically (Dynamic Client Registration) is the way around it. See
[oauth-threat-model.md](oauth-threat-model.md).

## Configuration

| Variable | Default | Meaning |
|---|---|---|
| `DAYHAND_PUBLIC_URL` | the Convex site URL (`CONVEX_SITE_URL`) | The issuer and the base of `/mcp`, for a custom domain. It must be exactly the URL users add in Claude, without `/mcp`. |
| `DAYHAND_OAUTH_CIMD_ORIGINS` | `https://claude.ai` | Comma-separated origins whose client metadata documents are fetched. Tests add a local origin; production should not change it. |

No secret is involved: tokens are random and stored hashed, and the app-signing key
(`DAYHAND_JWT_PRIVATE_JWK`) is not used by OAuth.

## Connecting the Claude app (manual procedure)

Done once by the owner after the backend with OAuth is deployed to production. It cannot be
tested against the real Claude apps before that, because Claude reaches the server from
Anthropic's network and needs public HTTPS.

1. **Check the deployment** from any terminal (no key needed):

   ```sh
   curl -si -X POST https://<name>.convex.site/mcp | grep -i www-authenticate
   # WWW-Authenticate: Bearer realm="dayhand", scope="tasks:read tasks:write", resource_metadata="https://<name>.convex.site/.well-known/oauth-protected-resource/mcp"
   curl -s https://<name>.convex.site/.well-known/oauth-protected-resource/mcp
   curl -s https://<name>.convex.site/.well-known/oauth-authorization-server
   ```

2. **Phone ready**: the Dayhand app is paired with this deployment (Settings → Server shows
   *Synced*) and updated to the version with Settings → Agent connections.
3. **Add the connector** in the Claude app: Settings (or Customize) → Connectors → **Add custom
   connector**. Name: `Dayhand`. URL: `https://<name>.convex.site/mcp`. Under the advanced or
   authentication settings choose **Sign in now** (or leave the default) and **Use Claude's
   published identity** for the OAuth client; leave client ID and secret empty. Add.
4. **Connect**: Claude opens Dayhand's page in a browser view. It shows a code like `K7QF-M2XA`.
5. **Approve on the phone**: switch to the Dayhand app → Settings → **Agent connections** →
   **Approve a connection** → type the code → check that it says *Identified by claude.ai* and
   *Answer goes to claude.ai*, that *Asked* is a moment ago and that there is no red warning →
   leave both permissions on (or switch off *Change tasks and settings* for read only) →
   **Approve**.
6. **Back to the browser view**: within two seconds it continues by itself (or tap
   **Continue**) and Claude shows Dayhand as connected.
7. **Try it**: ask Claude "What is on my Dayhand list today?" (it calls `list_today`), then "Add
   *test from Claude* to Dayhand for today" and check the task in the app; its history shows
   `agent: <the client's name>`. Delete the test task afterwards.
8. **If step 4 shows "Unknown client"**: Claude's published identity is served from an origin
   other than `https://claude.ai`. Remove the connector and add it again with **Register
   automatically** (Dynamic Client Registration), which needs no allowlist. Note the origin
   from the Convex logs (`Client metadata refused: …`) so it can be added to
   `DAYHAND_OAUTH_CIMD_ORIGINS` deliberately.
9. **To disconnect**: Settings → Agent connections → tap the connection → Disconnect, or
   `dayhand connection revoke <id>`. Removing the connector in Claude alone does not revoke it on
   Dayhand's side; unused connections end 60 days after their last refresh.

Claude refreshes the access token by itself (on `401` and shortly before it expires), so the
phone is needed only for the first approval and after a disconnection.
