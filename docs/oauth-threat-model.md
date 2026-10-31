# OAuth threat model

What the OAuth server ([oauth.md](oauth.md)) protects, from whom, how, and what is left. It
covers `/.well-known/*`, `/oauth/*`, `/connections*`, the OAuth path of `/mcp` and the approval
in the Android app. API keys, pairing and app JWTs are described in
[architecture.md](architecture.md#authentication) and [pairing.md](pairing.md).

## Assets

- The owner's plan: tasks, history and settings, read and changed through `/mcp`.
- Access and refresh tokens of agent connections, authorization codes, and the codes shown on
  the sign-in page.
- The owner's decision: only the owner, on the paired phone, may let an agent in, and only with
  the scopes the owner chose.

## Actors and trust boundaries

| Actor | Trusted with |
|---|---|
| Owner with the paired phone | Every decision; the app talks to `app.*` with its JWT |
| Owner with an API key (`dayhand`) | Listing and revoking connections (`/connections*`) |
| Claude app, Claude Code | Its own tokens after approval; nothing more. Its name comes from its metadata document on `https://claude.ai` |
| Any other MCP client | Same as Claude once approved, but its name is self-asserted (Dynamic Client Registration) |
| Anyone on the internet | Nothing: every `/oauth/*` endpoint is open to them by design |

The browser that opens the sign-in page is not trusted: it proves nothing about who uses it. The
phone is what makes a request legitimate.

## Threats and controls

| # | Threat | Control | Test |
|---|---|---|---|
| T1 | **Code interception**: an attacker gets an authorization code (a log, a redirect) and exchanges it | PKCE S256 required (no `plain`, no request without it); the code is bound to client, redirect URI and resource, lives 2 minutes and dies on its first presentation, right or wrong | `oauth.test.ts`: wrong verifier burns the code; code bound to client, redirect URI and resource |
| T2 | **Code replay**: the same code is exchanged twice | A second presentation fails and revokes the connection the first one created | "a code used twice fails and revokes the connection" |
| T3 | **Open redirect / code theft by redirect URI**: a client registers `https://evil/cb` and gets the owner's code | Only Claude's documented callbacks are accepted, at registration and in metadata documents: `https://claude.ai/api/mcp/auth_callback` exactly, and `http://localhost` / `http://127.0.0.1` with path `/callback` on any port; no other host, scheme, path, query, fragment, credentials or IP spelling. Before the redirect URI is checked, errors are an error page, never a redirect | `oauthRules.test.ts` (17 refused spellings), "a wrong redirect URI gets an error page" |
| T4 | **Impersonation of Claude**: a client calls itself "Claude" | The phone says *Identified by claude.ai* only for a metadata document fetched from an allowed origin (default `https://claude.ai` only); a self-registered client is shown as *Registered itself (its name is not verified)*. Names are cleaned of control and bidi characters and cut to 60 | Instrumented `ConnectionsScreenTest`, `cleanName` tests |
| T5 | **Consent phishing**: an attacker opens the sign-in page with their own client and sends the owner the code ("type this in Dayhand") | The code works only on the owner's phone and shows who asks and where the answer goes; a request older than 3 minutes gets a red warning; an answer to a program on the computer (loopback) gets a warning; the page and the app tell the owner to approve only a page they opened themselves. The approved code still goes to the page that asked, so the attacker must also hold the redirect URI: Claude's own callback, or a loopback on the attacker's machine | `ConnectionsViewModelTest` ("a request minutes old is flagged"), instrumented consent tests |
| T6 | **Guessing the code typed on the phone** | 8 Crockford base32 characters (40 bits), valid 10 minutes, at most 5 waiting per client; 10 wrong codes per user per 10 minutes, then the app refuses | "wrong codes are limited per user" |
| T7 | **Token theft or guessing** | Tokens are a selector plus 256 random bits, stored as SHA-256 only, compared in constant time, never logged or shown. Access tokens last one hour | — (format and storage by construction) |
| T8 | **Refresh token theft** | Rotation on every refresh; a rotated token used again more than 30 seconds later revokes the connection (both parties lose it, the owner sees it on the phone) | "reusing a refresh token rotated long ago revokes the connection" |
| T9 | **Token for another server (confused deputy)** | Every token is bound to `<issuer>/mcp` (RFC 8707); `/mcp` refuses a token bound to anything else; `resource` must name `/mcp` when sent | "a token issued for another resource (audience) gets 401" |
| T10 | **More access than granted** | Scopes `tasks:read` and `tasks:write` only; no broad default (a request without `scope` gets reading only); the phone may grant a part, never more; `tools/list` is filtered and other tools, user resources and prompts get `403 insufficient_scope`; a refresh can only narrow | "a read-only connection…", "a write-only connection…", "a refresh may narrow the scopes" |
| T11 | **Escalation from a connection**: an agent mints API keys, pairs phones or approves itself | OAuth tokens work only on `/mcp`; `/devices*` and `/connections*` take API keys only; the approval needs the app's JWT; identity fields in tool arguments are refused | "OAuth tokens cannot manage devices or connections" |
| T12 | **Revocation that does not bite** | A revoked connection's access and refresh tokens are refused on their next use, not when they expire | "revoking a connection on the phone or with dayhand stops its tokens at once", RFC 7009 test |
| T13 | **SSRF through metadata URLs** | Only URLs on `DAYHAND_OAUTH_CIMD_ORIGINS` (default `https://claude.ai`) are fetched; no redirects, 16 KB, 5 seconds | `cimdUrlProblem` tests, "metadata documents that are not acceptable…" |
| T14 | **XSS, clickjacking, CSRF on the sign-in page** | Every value is HTML-escaped; CSP `default-src 'none'` with a nonce for the one script and `connect-src 'self'`; `frame-ancestors 'none'`, `X-Frame-Options: DENY`, `form-action` limited to the page and the redirect origin; the page's forms carry a 256-bit request handle, so a cross-site form cannot continue someone else's request | "a client name is escaped on the page" |
| T15 | **Secrets in logs or answers** | No secret is logged; answers carry `Cache-Control: no-store`; connection views never contain hashes or tokens; errors are generic (`invalid_grant`) | "revoking a connection on the phone or with dayhand…" checks that `/connections` returns no hash |
| T16 | **Mix-up** between authorization servers | `iss` in every authorization response (RFC 9207) | Flow tests check `iss` |
| T17 | **Denial of service** by filling limits | Limits are per client where possible (waiting requests, request starts); global buckets are high flood guards; the token endpoint has no lockout. See residual risks | "too many waiting requests of one client…", "failed code exchanges do not lock the token endpoint" |
| T18 | **A runaway agent** | 120 reads and 60 changes a minute per connection, as per key; the owner disconnects it on the phone | "calls are limited per connection" |

## Residual risks

- **Blocking Claude's published identity.** The `client_id` of the Claude apps is public, so
  anyone can start 20 requests with it every 10 minutes and keep 5 waiting, which delays new
  Claude connections (not existing ones) for up to 10 minutes. The workaround is "Register
  automatically" (Dynamic Client Registration), whose `client_id` is private to that
  registration. The global flood guards (300 request starts per 10 minutes, 100 registrations
  per hour) can be filled the same way; `npx convex run oauth:resetLimits` clears them. Nobody
  gets access this way.
- **Consent phishing with a loopback client.** An attacker who persuades the owner to approve
  a code, despite the warnings, gets a connection through a loopback redirect on the attacker's
  own machine. The warnings and the request's age are the only defence; the owner sees the
  connection under Agent connections and can disconnect it.
- **A stolen refresh token used within 30 seconds** of the legitimate refresh is taken for a
  retry. The legitimate client's next refresh then fails, and a later use of an old token
  revokes the connection.
- **Metadata documents have no cache. Coming soon:** every authorization attempt counts
  before any metadata fetch (20 per client per 10 minutes, including malformed requests and
  failed fetches). Locally invalid parameters are rejected without a fetch or redirect,
  because the redirect has not yet been verified for the client. The global flood guard
  also counts these attempts. Targets remain restricted to the configured CIMD origins
  (`https://claude.ai` by default).
- **Self-asserted names** of registered clients can be anything printable; the app marks them as
  unverified.
- **Revoking an app JWT** (a lost phone) takes up to an hour ([pairing.md](pairing.md)); during
  that hour the phone could still approve requests. Revoke the device with `dayhand revoke`.
- **Not tested against the real Claude apps** before a production deployment: Claude reaches
  the server from Anthropic's network over public HTTPS. The flows are tested with a simulator
  (the MCP SDK's OAuth client and `tests/oauthClient.ts`) and on an emulator
  (`android/scripts/e2e-connections.py`).

## Out of scope

Client secrets, confidential clients, the JWT bearer and client credentials grants, token
introspection, OpenID Connect and sign-in on the web: Dayhand has no web accounts, and the paired
phone is the only way in.
