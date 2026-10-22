# Phone pairing and app sign-in

The phone app never holds a signing key. It is paired once with a one-time code and then
asks the backend for short-lived app tokens.

```
helm pair (API key) ──> code XXXX-XXXX-XXXX, valid 10 min, single use
phone: POST /auth/pair  {code}         ──> deviceToken (long-lived, revocable)
phone: POST /auth/token {deviceToken}  ──> app JWT (ES256, 1 hour)
phone: Convex client with that JWT     ──> app.* queries and mutations as the owner
```

All endpoints are HTTP actions on the deployment's HTTP actions URL (`https://<name>.convex.site`,
locally `http://127.0.0.1:3211`). Requests and responses are JSON (`Content-Type:
application/json`); token responses carry `Cache-Control: no-store`.

## Pairing link

`helm pair` prints the code, a deep link and the same link as a QR code:

```
helm://pair?url=<URL-encoded HTTP actions URL>&code=<XXXX-XXXX-XXXX>
```

The app reads `url` (the HTTP actions URL, where `/auth/pair` and `/auth/token` live) and
`code` from it. Typed codes may be lower case and may omit the dashes; `O` is read as `0`,
`I` and `L` as `1`.

## POST /auth/pair

Request:

```json
{ "code": "E6M8-FE02-XSNT", "deviceName": "Pixel 9" }
```

`deviceName` is optional (1 to 100 characters, default `"Phone"`); it is shown by `helm devices`.

| Status | Body | Meaning |
|---|---|---|
| 200 | `{ "deviceId": "jd7…", "deviceName": "Pixel 9", "deviceToken": "helmdev_…", "convexUrl": "https://<name>.convex.cloud" }` | Paired. Store `deviceToken` in encrypted storage; it is shown only now. `convexUrl` is the URL for the Convex client. |
| 400 | `{ "error": "invalid_request", "error_description": "…" }` | Body is not JSON, `code` is not a string, or `deviceName` is invalid. |
| 401 | `{ "error": "invalid_grant", "error_description": "The code or token is not valid" }` | Wrong, unknown, malformed, expired, already used or burned code. The answer is the same for all of them. |
| 429 | `{ "error": "rate_limited", … }`, header `Retry-After: <seconds>` | Too many failed attempts on this deployment; codes are not checked until the window ends. |

## POST /auth/token

Request:

```json
{ "deviceToken": "helmdev_<22 chars>.<43 chars>" }
```

| Status | Body | Meaning |
|---|---|---|
| 200 | `{ "token": "<JWT>", "tokenType": "Bearer", "expiresIn": 3600, "expiresAt": 1792691766000 }` | App JWT; `expiresAt` is Unix ms. |
| 400 | `{ "error": "invalid_request", … }` | Body is not JSON or `deviceToken` is not a string. |
| 401 | `{ "error": "invalid_grant", "error_description": "The code or token is not valid" }` | Unknown, malformed or revoked device token. Drop the token and pair again. |
| 503 | `{ "error": "not_configured", … }` | The deployment cannot sign tokens (configuration problem on the server). Retry later; do not drop the device token. |

The JWT has header `{ "alg": "ES256", "typ": "JWT", "kid": … }` and claims `iss`
(`HELM_JWT_ISSUER`), `sub` (the owner, e.g. `owner`), `aud: "helm"`, `iat`, `exp` (`iat` + 3600).

## Using the token in the Android app

- Give the Convex client an auth callback (`ConvexClientWithAuth` / `setAuth` with a token
  fetcher) that calls `POST /auth/token` and returns `token`. Fetch a new token before
  `expiresAt` (for example when less than 5 minutes are left) and whenever the client asks
  for a refresh.
- `convexUrl` is the deployment's own view of its address. On a local backend it is
  `http://127.0.0.1:3210`, which an emulator cannot reach: there, keep the port and use the
  host of the pairing link's `url` (e.g. `10.0.2.2`).
- Network errors and `503` are temporary: keep the device token and retry with backoff.
- `401` from `/auth/token` means the device was revoked (or the token is corrupt): delete the
  device token and show the pairing screen.
- Revoking a device stops new tokens at once; a JWT it already holds stays valid until its
  `exp` (at most one hour).

## Managing devices (CLI)

```sh
helm pair            # code + link + QR; --no-qr for text only, --json for scripts
helm devices         # name, paired when and by which key, last used, revoked
helm revoke <deviceId>
```

They call `POST /devices/pairing-code`, `GET /devices` and `POST /devices/revoke`
(`{ "deviceId": … }`) with `Authorization: Bearer <personal API key>`. Pairing codes and
revocations are recorded in the history under the key's kind and name (`cli`, or
`agent: <name>`; see [mcp.md](mcp.md#keys-and-actors)). The deployment admin can do the same
without an API key:

```sh
npx convex run devices:createPairingCode '{"userId":"<issuer>|owner","actor":"app"}'
npx convex run devices:list '{"userId":"<issuer>|owner","actor":"app"}'
npx convex run devices:revoke '{"userId":"<issuer>|owner","actor":"app","deviceId":"<id>"}'
npx convex run devices:resetPairLimit     # after someone exhausted the failed-attempt limit
```

Only an app user can pair: the API key's user id must be `<HELM_JWT_ISSUER>|<subject>`, because
the phone's JWT gives exactly that identity. A key of another user gets an error from `helm pair`.

## Security notes

- Codes: 12 Crockford base32 characters (60 random bits). The first 4 select the code, the
  other 8 are stored as SHA-256 only. A code dies after one use, after 10 minutes, or after 5
  wrong secrets for its selector.
- `/auth/pair` allows 10 failed attempts per 10 minutes for the whole deployment (the endpoint
  is unauthenticated, so there is no user to count per). Over the limit it answers `429`
  without checking the code. Someone can therefore block pairing for 10 minutes, but cannot
  guess a code; the admin can clear the counter with `devices:resetPairLimit`.
- Device tokens: a 16-byte selector and a 32-byte secret; the secret is stored as SHA-256
  only and compared in constant time. `/auth/token` has no attempt limit on purpose: 256-bit
  secrets cannot be guessed, and a limit would let anyone lock the real phone out.
- Error answers never tell whether a code or token existed, was used, expired or revoked.
- The signing key (`HELM_JWT_PRIVATE_JWK`) lives only in the deployment environment and is
  never returned. See [deploy.md](deploy.md).
- A personal API key can pair a device, and that device keeps working after the key is
  revoked. If a key may have leaked, revoke it and check `helm devices` as well.
