// Signs the app's ES256 JWT inside the deployment. The private key is the
// deployment environment variable HELM_JWT_PRIVATE_JWK (a JWK with `kid`);
// its public half must be the key with the same `kid` in HELM_JWKS, which
// auth.config.ts trusts. The private key is never returned to any client.
import { bytesToBase64url } from "./secrets";

export const APP_TOKEN_TTL_SECONDS = 3600;
const AUDIENCE = "helm";
const ALGORITHM = { name: "ECDSA", namedCurve: "P-256" };

export type SigningConfig = { issuer: string; privateJwk: JsonWebKey & { kid: string } };

export class SigningConfigError extends Error {}

function decodeJwks(dataUri: string): { keys: (JsonWebKey & { kid?: string })[] } {
  const match = /^data:application\/json;base64,(.+)$/.exec(dataUri);
  if (!match) throw new SigningConfigError("HELM_JWKS is not a base64 JSON data URI");
  return JSON.parse(atob(match[1]));
}

/** Reads and cross-checks the signing configuration; throws SigningConfigError when unusable. */
export function signingConfig(): SigningConfig {
  const issuer = process.env.HELM_JWT_ISSUER;
  const rawKey = process.env.HELM_JWT_PRIVATE_JWK;
  const jwks = process.env.HELM_JWKS;
  if (!issuer || !rawKey || !jwks) {
    throw new SigningConfigError("HELM_JWT_ISSUER, HELM_JWT_PRIVATE_JWK and HELM_JWKS must all be set");
  }
  let privateJwk: JsonWebKey & { kid?: string };
  try {
    privateJwk = JSON.parse(rawKey);
  } catch {
    throw new SigningConfigError("HELM_JWT_PRIVATE_JWK is not JSON");
  }
  const { kty, crv, d, x, y, kid } = privateJwk;
  if (kty !== "EC" || crv !== "P-256" || !d || !x || !y || !kid) {
    throw new SigningConfigError("HELM_JWT_PRIVATE_JWK must be a P-256 EC private JWK with a kid");
  }
  const published = decodeJwks(jwks).keys.find((k) => k.kid === kid);
  if (!published || published.x !== x || published.y !== y) {
    throw new SigningConfigError("HELM_JWT_PRIVATE_JWK does not match the key with its kid in HELM_JWKS");
  }
  return { issuer, privateJwk: { ...privateJwk, kid } };
}

/** The JWT subject for a Helm user id `<issuer>|<subject>`; null for any other user id. */
export function appSubject(userId: string, issuer: string): string | null {
  const prefix = `${issuer}|`;
  return userId.startsWith(prefix) && userId.length > prefix.length ? userId.slice(prefix.length) : null;
}

const encodeJson = (value: unknown) => bytesToBase64url(new TextEncoder().encode(JSON.stringify(value)));

export async function signAppToken(config: SigningConfig, subject: string, nowMs = Date.now()) {
  const { kty, crv, d, x, y } = config.privateJwk;
  const key = await crypto.subtle.importKey("jwk", { kty, crv, d, x, y }, ALGORITHM, false, ["sign"]);
  const iat = Math.floor(nowMs / 1000);
  const exp = iat + APP_TOKEN_TTL_SECONDS;
  const header = encodeJson({ alg: "ES256", typ: "JWT", kid: config.privateJwk.kid });
  const payload = encodeJson({ iss: config.issuer, sub: subject, aud: AUDIENCE, iat, exp });
  const signature = await crypto.subtle.sign(
    { name: "ECDSA", hash: "SHA-256" },
    key,
    new TextEncoder().encode(`${header}.${payload}`),
  );
  return { token: `${header}.${payload}.${bytesToBase64url(new Uint8Array(signature))}`, expiresAt: exp * 1000 };
}
