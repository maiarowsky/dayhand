# Deploying Helm

Helm deploys the `backend/` folder to a Convex deployment (Convex Cloud or self-hosted). The
repository holds no secrets: everything below goes into the deployment's environment.

## Environment variables

| Variable | Value | Read by |
|---|---|---|
| `HELM_JWT_ISSUER` | Issuer of app tokens, e.g. `https://helm.example` | `auth.config.ts`, token signing |
| `HELM_JWKS` | Public key(s) as a JWKS data URI (`data:application/json;base64,…`) | `auth.config.ts` (Convex verifies app JWTs) |
| `HELM_JWT_PRIVATE_JWK` | Private ES256 key as a JWK with `kid`; its public half must be in `HELM_JWKS` under the same `kid` | `POST /auth/token` only; never returned |

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
npx convex run apiKeys:create '{"userId":"https://helm.example|owner","actor":"app","name":"cli"}'
```

`signing-key.mjs private` refuses to print to a terminal; piping into `npx convex env set NAME`
(no value argument) keeps the key out of shell history and process lists.

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
