// Minimal ES256 JWT helpers for local development and tests: a key pair
// whose public half goes into the deployment as a JWKS data URI (DAYHAND_JWKS)
// and whose private half is DAYHAND_JWT_PRIVATE_JWK, and app tokens signed with
// the private half. Deployed, the backend itself signs tokens for paired
// phones (convex/lib/appToken.ts).
import { randomUUID, webcrypto } from "node:crypto";

const { subtle } = webcrypto;
const ALGORITHM = { name: "ECDSA", namedCurve: "P-256" };

const base64url = (input) => Buffer.from(input).toString("base64url");

export async function generateSigningKey() {
  const pair = await subtle.generateKey(ALGORITHM, true, ["sign", "verify"]);
  const kid = randomUUID();
  const publicJwk = { ...(await subtle.exportKey("jwk", pair.publicKey)), kid, alg: "ES256", use: "sig" };
  const privateJwk = { ...(await subtle.exportKey("jwk", pair.privateKey)), kid };
  const jwks = JSON.stringify({ keys: [publicJwk] });
  return { kid, privateJwk, jwksDataUri: `data:application/json;base64,${Buffer.from(jwks).toString("base64")}` };
}

/** The private JWK in a key file's content: the JWK itself or `{ privateJwk }`. */
export function privateJwkOf(content) {
  const jwk = content?.privateJwk ?? content;
  if (jwk?.kty !== "EC" || jwk.crv !== "P-256" || !jwk.d || !jwk.kid) {
    throw new Error("not a P-256 private JWK with a kid");
  }
  return jwk;
}

/**
 * DAYHAND_JWKS for a key: its public half as a JWKS data URI.
 * @param {JsonWebKey & { kid: string }} jwk
 */
export function jwksDataUri({ kty, crv, x, y, kid }) {
  const jwks = JSON.stringify({ keys: [{ kty, crv, x, y, kid, alg: "ES256", use: "sig" }] });
  return `data:application/json;base64,${Buffer.from(jwks).toString("base64")}`;
}

/**
 * Whether a DAYHAND_JWKS value publishes this key's public half under its kid.
 * @param {string} dataUri
 * @param {JsonWebKey & { kid: string }} jwk
 */
export function publishesKey(dataUri, jwk) {
  const match = /^data:application\/json;base64,(.+)$/.exec(String(dataUri).trim());
  if (!match) return false;
  let keys;
  try {
    keys = JSON.parse(Buffer.from(match[1], "base64").toString()).keys;
  } catch {
    return false;
  }
  const published = Array.isArray(keys) ? keys.find((k) => k?.kid === jwk.kid) : undefined;
  return Boolean(published && published.x === jwk.x && published.y === jwk.y);
}

export async function signAppToken({ privateJwk, issuer, subject, ttlSeconds = 3600 }) {
  const key = await subtle.importKey("jwk", privateJwk, ALGORITHM, false, ["sign"]);
  const now = Math.floor(Date.now() / 1000);
  const header = base64url(JSON.stringify({ alg: "ES256", typ: "JWT", kid: privateJwk.kid }));
  const payload = base64url(
    JSON.stringify({ iss: issuer, sub: subject, aud: "helm", iat: now, exp: now + ttlSeconds }),
  );
  const signature = await subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, Buffer.from(`${header}.${payload}`));
  return `${header}.${payload}.${base64url(new Uint8Array(signature))}`;
}
