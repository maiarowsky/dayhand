// Pure tests of the signing configuration and of the code and token formats.
import { webcrypto } from "node:crypto";
import { afterEach, describe, expect, test } from "vitest";
import { appSubject, signAppToken, signingConfig, SigningConfigError } from "../convex/lib/appToken";
import { newDeviceToken, newPairingCode, parseDeviceToken, parsePairingCode, timingSafeEqual } from "../convex/lib/secrets";
import { generateSigningKey } from "../scripts/jwt.mjs";

const ENV = ["HELM_JWT_ISSUER", "HELM_JWT_PRIVATE_JWK", "HELM_JWKS"] as const;
const saved = Object.fromEntries(ENV.map((name) => [name, process.env[name]]));

afterEach(() => {
  for (const name of ENV) {
    if (saved[name] === undefined) delete process.env[name];
    else process.env[name] = saved[name];
  }
});

async function configure() {
  const signing = await generateSigningKey();
  process.env.HELM_JWT_ISSUER = "https://helm.test";
  process.env.HELM_JWT_PRIVATE_JWK = JSON.stringify(signing.privateJwk);
  process.env.HELM_JWKS = signing.jwksDataUri;
  return signing;
}

describe("signing configuration", () => {
  test("signs a token the published public key verifies", async () => {
    const signing = await configure();
    const { token, expiresAt } = await signAppToken(signingConfig(), "owner", Date.UTC(2026, 9, 22, 12));
    expect(expiresAt).toBe(Date.UTC(2026, 9, 22, 13));
    const [header, payload, signature] = token.split(".");
    const { kty, crv, x, y } = signing.privateJwk;
    const publicKey = await webcrypto.subtle.importKey("jwk", { kty, crv, x, y }, { name: "ECDSA", namedCurve: "P-256" }, false, [
      "verify",
    ]);
    const valid = await webcrypto.subtle.verify(
      { name: "ECDSA", hash: "SHA-256" },
      publicKey,
      Buffer.from(signature, "base64url"),
      Buffer.from(`${header}.${payload}`),
    );
    expect(valid).toBe(true);
  });

  test("a missing variable or a private key that does not match HELM_JWKS is a configuration error", async () => {
    await configure();
    const other = await generateSigningKey();
    process.env.HELM_JWT_PRIVATE_JWK = JSON.stringify({ ...other.privateJwk, kid: JSON.parse(process.env.HELM_JWT_PRIVATE_JWK!).kid });
    expect(() => signingConfig()).toThrow(SigningConfigError);
    process.env.HELM_JWT_PRIVATE_JWK = JSON.stringify(other.privateJwk);
    expect(() => signingConfig()).toThrow(/does not match/);
    process.env.HELM_JWT_PRIVATE_JWK = "not json";
    expect(() => signingConfig()).toThrow(/not JSON/);
    delete process.env.HELM_JWT_PRIVATE_JWK;
    expect(() => signingConfig()).toThrow(/must all be set/);
  });

  test("only <issuer>|<subject> user ids are app users", () => {
    expect(appSubject("https://helm.test|owner", "https://helm.test")).toBe("owner");
    expect(appSubject("https://helm.test|", "https://helm.test")).toBeNull();
    expect(appSubject("local|me", "https://helm.test")).toBeNull();
  });
});

describe("codes and tokens", () => {
  test("pairing codes normalize case, dashes and look-alike letters", () => {
    const code = newPairingCode();
    expect(code).toMatch(/^[0-9A-HJKMNP-TV-Z]{12}$/);
    expect(parsePairingCode(` ${code.toLowerCase().replace(/(.{4})/g, "$1-")} `)).toEqual({
      selector: code.slice(0, 4),
      secret: code.slice(4),
    });
    expect(parsePairingCode("OIL0-0000-0000")).toEqual({ selector: "0110", secret: "00000000" });
    expect(parsePairingCode("UUUU-0000-0000")).toBeNull();
    expect(parsePairingCode("0000-0000")).toBeNull();
  });

  test("device tokens round-trip; constant-time comparison", () => {
    const device = newDeviceToken();
    expect(parseDeviceToken(device.token)).toEqual({ selector: device.selector, secret: device.secret });
    expect(parseDeviceToken(device.token + "x")).toBeNull();
    expect(timingSafeEqual("abc", "abc")).toBe(true);
    expect(timingSafeEqual("abc", "abd")).toBe(false);
    expect(timingSafeEqual("abc", "abcd")).toBe(false);
  });
});
