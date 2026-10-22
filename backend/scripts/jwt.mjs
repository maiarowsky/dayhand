// Minimal ES256 JWT helpers for local development and tests: a key pair
// whose public half goes into the deployment as a JWKS data URI, and app
// tokens signed with the private half. Production pairing is a later step.
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
