# Deploying Helm

Helm deploys the `backend/` folder to a Convex deployment (Convex Cloud or self-hosted). The
repository holds no secrets: everything below goes into the deployment's environment.

## Environment variables

| Variable | Value | Read by |
|---|---|---|
| `HELM_JWT_ISSUER` | Issuer of app tokens, e.g. `https://helm.example` | `auth.config.ts`, token signing |
| `HELM_JWKS` | Public key(s) as a JWKS data URI (`data:application/json;base64,…`) | `auth.config.ts` (Convex verifies app JWTs) |
| `HELM_JWT_PRIVATE_JWK` | Private ES256 key as a JWK with `kid`; its public half must be in `HELM_JWKS` under the same `kid` | `POST /auth/token` only; never returned |
| `HELM_MCP_ALLOWED_ORIGINS` | Optional. Comma-separated browser origins allowed to call `/mcp`, e.g. `https://inspector.example`. Unset: any request with an `Origin` header gets `403` | `POST /mcp` |
| `HELM_PUBLIC_URL` | Optional. The URL users add in Claude, without `/mcp`, when it is not the Convex site URL (a custom domain). Unset: `CONVEX_SITE_URL` | OAuth issuer and resource ([oauth.md](oauth.md#configuration)) |
| `HELM_OAUTH_CIMD_ORIGINS` | Optional. Comma-separated origins whose OAuth client metadata documents are fetched. Unset: `https://claude.ai`; production should leave it unset | `GET /oauth/authorize` |

App users are `<HELM_JWT_ISSUER>|<subject>` (single-user deployments use `owner` as subject).
Personal API keys for the CLI and agent should belong to that same user, so the phone, the CLI
and the agent see one task list.

## First deployment

```sh
cd backend
node scripts/signing-key.mjs new ~/helm-signing-key.json       # mode 600, keep it out of the repo
npx convex env set HELM_JWT_ISSUER https://helm.example
npx convex env set HELM_JWKS "$(node scripts/signing-key.mjs jwks ~/helm-signing-key.json)"
node scripts/signing-key.mjs private ~/helm-signing-key.json | npx convex env set HELM_JWT_PRIVATE_JWK
npx convex deploy
npx convex run apiKeys:create '{"userId":"https://helm.example|owner","actor":"app","name":"cli","kind":"cli"}'
```

`signing-key.mjs private` refuses to print to a terminal; piping into `npx convex env set NAME`
(no value argument) keeps the key out of shell history and process lists.

## Upgrading to 0.5.0

0.5.0 adds OAuth for the Claude apps ([oauth.md](oauth.md)): the tables `oauthClients`,
`oauthRequests`, `oauthGrants` and `oauthTokens`, the optional field `connectionId` in
`taskEvents` and `callLimits` (where `keyId` becomes optional), and a daily cron
(`oauth.purgeExpired`, 04:00 UTC). Existing rows stay valid, so there is no migration and no
new secret: `npx convex deploy` is enough. API keys, the app and `hlm` 0.4 keep working; the
only visible change for them is a longer `WWW-Authenticate` header on `401` from `/mcp`.
Connecting the Claude app afterwards is a manual step done once on the phone
([oauth.md](oauth.md#connecting-the-claude-app-manual-procedure)). The Android app needs 0.6.0
for Settings → Agent connections; older apps keep working without it.

Rollback: revoke the connections first (`hlm connection revoke <id>`), then deploy 0.4.0
again. Its schema has no OAuth tables and no `connectionId`; if Convex refuses the push because
of rows in them, empty the four `oauth*` tables and `callLimits` the same way as below. History
entries written through a connection keep their `connectionId` and would block the push too;
they are rare enough to delete by hand (`npx convex data taskEvents`), or stay on 0.5.0.

## Upgrading to 0.4.0

0.4.0 adds the table `callLimits` (MCP calls per key and minute) and changes nothing in the
existing tables, so there is no migration: `npx convex deploy` is enough, and 0.3 clients (the
app, `hlm` 0.3, agents) keep working. Calls are now limited per key (120 reads and 60 changes a
minute), and `/mcp` refuses requests with a browser `Origin` that is not in
`HELM_MCP_ALLOWED_ORIGINS`; MCP clients outside a browser send no `Origin`.

Rollback: deploy 0.3.0 again. Its schema does not define `callLimits`; if Convex refuses the
push because that table holds rows, empty it first (`npx convex import --table callLimits
--replace --yes empty.jsonl` with an empty file). The rows only count calls, so nothing is lost.

## Upgrading to 0.3.0

0.3.0 adds task numbers (`tasks.ref`, new table `taskCounters`) and key kinds (`apiKeys.kind`,
`taskEvents.keyId` and `actorName`). All new fields are optional in the schema, so the deploy
accepts existing data, and the app, the agent and old API keys keep working before the
migration runs. Until then, tasks created before the upgrade have no number (`#n` does not
find them) and old keys count as `agent` keys.

0. Take a snapshot to roll back to: `npx convex export --path helm-before-0.3.0.zip` (it holds
   the user's tasks; keep it out of the repository).
1. Deploy: `npx convex deploy`.
2. Right after, number the existing tasks (oldest first, per user; runs in batches of 200 and
   schedules itself until done) and mark the existing keys as `agent` keys:

   ```sh
   npx convex run migrations:backfillTaskRefs
   npx convex run migrations:backfillKeyKinds
   ```

   Run it right away: tasks added between the deploy and the migration get numbers first, so
   older tasks get the numbers after them. Both migrations are idempotent and can be run again.
3. Check that nothing is left: `npx convex run migrations:status` must print
   `{ "keysWithoutKind": 0, "tasksWithoutRef": 0 }`. If `tasksWithoutRef` is not 0 yet, the
   scheduled batches are still running; check again after a few seconds.
4. If the key the user types commands with is a CLI key, make a new one with
   `"kind": "cli"` (see [mcp.md](mcp.md#keys-and-actors)), switch the CLI to it and revoke the
   old one, so the history shows `cli` instead of `agent: <name>`. Kinds cannot be changed on
   an existing key.

Rollback: deploying 0.2.0 again over migrated data fails schema validation (`ref`, `kind`,
`actor: "cli"`, `keyId` and `actorName` are unknown to it). Roll forward with a fix instead, or
restore the snapshot from step 0 (`npx convex import --replace-all helm-before-0.3.0.zip`,
which drops changes made since) and deploy 0.2.0.

## Moving an existing key from disk into the deployment

For a deployment that already trusts a key pair kept on a computer (the private half was used
to sign app tokens locally):

1. Check that the deployment publishes the key you hold:

   ```sh
   npx convex env get HELM_JWKS | node scripts/signing-key.mjs check /path/to/key.json
   ```

   It must print `OK: HELM_JWKS publishes this key (kid …)`. The file may hold the private JWK
   itself or `{ "privateJwk": … }`, as written by `npm run app-token -- --generate` and
   `scripts/signing-key.mjs new`.

2. Set the private key, then deploy the code with pairing:

   ```sh
   node scripts/signing-key.mjs private /path/to/key.json | npx convex env set HELM_JWT_PRIVATE_JWK
   npx convex deploy
   ```

3. Check the configuration without a real device: a bogus device token must get `401`
   (configured), not `503` (not configured):

   ```sh
   curl -s -X POST https://<name>.convex.site/auth/token \
     -H 'Content-Type: application/json' -d '{"deviceToken":"helmdev_x.y"}'
   # {"error":"invalid_grant",…}
   ```

   On `503`, `npx convex logs` shows the reason (missing variable, or a key that does not
   match `HELM_JWKS`).

4. Check that the CLI's API key belongs to the app user: `npx convex data apiKeys` must show
   `userId` = `<HELM_JWT_ISSUER>|owner`. Then `helm pair` works and the phone sees the same tasks.

5. Paste-in tokens issued earlier with `npm run app-token` keep working until they expire
   (same key). Pair the phone instead, then stop issuing them.

6. Move the key file off the disk into an offline backup (a password manager), or delete it.
   The deployment environment is now the only place that needs it. Anyone with admin access to
   the deployment can read its environment variables.

## Rotating the signing key

1. `node scripts/signing-key.mjs new new-key.json`.
2. Publish both public keys for an hour: set `HELM_JWKS` to a data URI whose `keys` array holds
   the old and the new key, and deploy (`auth.config.ts` is read at deploy time).
3. Pipe the new private key into `HELM_JWT_PRIVATE_JWK`; new tokens are signed with it.
4. After an hour (the token lifetime), set `HELM_JWKS` to the new key only and deploy again.

Paired devices keep working through a rotation: their device tokens do not depend on the key.
