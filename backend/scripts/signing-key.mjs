#!/usr/bin/env node
// Prepares the app-signing key for a deployment (docs/deploy.md):
//   new <file>      write a new ES256 key pair to <file> (mode 600)
//   private <file>  print the private JWK, to pipe into
//                   `npx convex env set HELM_JWT_PRIVATE_JWK`
//   jwks <file>     print the public JWKS data URI for HELM_JWKS
//   check <file>    read a HELM_JWKS value on stdin and check that it
//                   publishes this key's public half under its kid
// <file> holds a private JWK, or an object with a `privateJwk` field (the
// format of `new` and of backend/.local-backend/app-signing-key.json).
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { generateSigningKey } from "./jwt.mjs";

const USAGE = "Usage: node scripts/signing-key.mjs new|private|jwks|check <file>";

function readPrivateJwk(file) {
  const content = JSON.parse(readFileSync(file, "utf8"));
  const jwk = content.privateJwk ?? content;
  if (jwk.kty !== "EC" || jwk.crv !== "P-256" || !jwk.d || !jwk.kid) {
    throw new Error(`${file} does not hold a P-256 private JWK with a kid`);
  }
  return jwk;
}

function jwksDataUri({ kty, crv, x, y, kid }) {
  const jwks = JSON.stringify({ keys: [{ kty, crv, x, y, kid, alg: "ES256", use: "sig" }] });
  return `data:application/json;base64,${Buffer.from(jwks).toString("base64")}`;
}

async function readStdin() {
  let input = "";
  for await (const chunk of process.stdin) input += chunk;
  return input.trim();
}

function checkPublished(dataUri, jwk) {
  const match = /^data:application\/json;base64,(.+)$/.exec(dataUri);
  if (!match) throw new Error("stdin is not a HELM_JWKS data URI");
  const published = JSON.parse(Buffer.from(match[1], "base64").toString()).keys.find((k) => k.kid === jwk.kid);
  if (!published || published.x !== jwk.x || published.y !== jwk.y) {
    throw new Error(`HELM_JWKS does not publish this key (kid ${jwk.kid})`);
  }
  console.log(`OK: HELM_JWKS publishes this key (kid ${jwk.kid})`);
}

async function main() {
  const [command, file] = process.argv.slice(2);
  if (!file) throw new Error(USAGE);
  switch (command) {
    case "new": {
      if (existsSync(file)) throw new Error(`${file} already exists; not overwriting it`);
      const { privateJwk } = await generateSigningKey();
      writeFileSync(file, JSON.stringify({ privateJwk }), { mode: 0o600, flag: "wx" });
      return console.error(`Wrote ${file} (kid ${privateJwk.kid})`);
    }
    case "private":
      if (process.stdout.isTTY) throw new Error("Refusing to print the private key to a terminal; pipe it instead");
      return process.stdout.write(JSON.stringify(readPrivateJwk(file)));
    case "jwks":
      return console.log(jwksDataUri(readPrivateJwk(file)));
    case "check":
      return checkPublished(await readStdin(), readPrivateJwk(file));
    default:
      throw new Error(USAGE);
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
