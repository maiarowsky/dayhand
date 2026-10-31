// Compatibility proof against actual backend 0.12.0 from git, not a fake MCP server.
import { execFile, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { afterAll, beforeAll, expect, test } from "vitest";
import { generateSigningKey } from "../../backend/scripts/jwt.mjs";
import { convexCliEnv, newInstanceSecret, startLocalBackend } from "../../backend/scripts/local-backend-lib.mjs";
import { freePort, ISSUER } from "./globalSetup.js";
import { dayhand, jsonError, schemaValidator, TEST_HOME } from "./helpers.js";

const exec = promisify(execFile);
const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const BACKEND_012_REVISION = "dd32213";
// Source tarballs and shallow release checkouts need not contain old history.
// Local/full-history runs execute the compatibility proof; never fetch implicitly.
const hasLegacySource = spawnSync("git", ["-C", ROOT, "cat-file", "-e", `${BACKEND_012_REVISION}:backend/package.json`]).status === 0;
const validate = schemaValidator();
let backend: Awaited<ReturnType<typeof startLocalBackend>> | undefined;
let key: string;

beforeAll(async () => {
  if (!hasLegacySource) return;
  const dir = mkdtempSync(join(TEST_HOME, "backend-012-"));
  const archive = join(dir, "backend.tar");
  const { stdout } = await exec("git", ["-C", ROOT, "archive", BACKEND_012_REVISION, "backend"], { encoding: "buffer", maxBuffer: 10 * 1024 * 1024 });
  writeFileSync(archive, stdout);
  await exec("tar", ["-xf", archive, "-C", dir]);
  const oldRoot = join(dir, "backend");
  expect(JSON.parse(readFileSync(join(oldRoot, "package.json"), "utf8")).version).toBe("0.12.0");
  // Reuse the packages installed with npm ci --ignore-scripts from the current lockfile.
  // Only body-parser and fast-uri differ after the security patches on 2026-10-31.
  const currentLock = JSON.parse(readFileSync(join(ROOT, "backend/package-lock.json"), "utf8"));
  const oldLock = JSON.parse(readFileSync(join(oldRoot, "package-lock.json"), "utf8"));
  const securityPatches = new Set(["node_modules/body-parser", "node_modules/fast-uri"]);
  const dependencies = (lock: any) => Object.entries(lock.packages)
    .filter(([path]) => path !== "" && !securityPatches.has(path));
  expect(dependencies(currentLock)).toEqual(dependencies(oldLock));
  symlinkSync(join(ROOT, "backend/node_modules"), join(oldRoot, "node_modules"), "dir");
  backend = await startLocalBackend({ dataDir: join(dir, "data"), port: await freePort(), sitePort: await freePort(), instanceName: "dayhand-projekty-t5-legacy", instanceSecret: newInstanceSecret() });
  const env = convexCliEnv({ url: backend.url, adminKey: backend.adminKey, home: join(dir, "home") });
  const signing = await generateSigningKey();
  const convex = join(ROOT, "backend/node_modules/.bin/convex");
  for (const [name, value] of Object.entries({ DAYHAND_JWT_ISSUER: ISSUER, DAYHAND_JWKS: signing.jwksDataUri, DAYHAND_JWT_PRIVATE_JWK: JSON.stringify(signing.privateJwk) })) {
    await exec(convex, ["env", "set", name, value], { cwd: oldRoot, env });
  }
  await exec(convex, ["deploy", "--yes", "--typecheck", "disable", "--codegen", "enable"], { cwd: oldRoot, env, maxBuffer: 10 * 1024 * 1024 });
  const response = await fetch(`${backend.url}/api/action`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Convex ${backend.adminKey}` }, body: JSON.stringify({ path: "apiKeys:create", args: { userId: `${ISSUER}|cli-project-legacy`, actor: "app", name: "legacy-test", kind: "cli" }, format: "json" }) });
  const result = await response.json() as any;
  expect(result.status).toBe("success");
  key = result.value.key;
}, 60_000);

afterAll(async () => { await backend?.stop(); });

test.skipIf(!hasLegacySource)("all project commands explain the minimum backend; ordinary task commands still work on 0.12.0 (needs git history)", async () => {
  const url = backend!.siteUrl;
  const version = await dayhand(key, ["version", "--json"], { url });
  expect(version.code).toBe(0);
  expect(JSON.parse(version.stdout)).toMatchObject({ server: { version: "0.12.0" }, compatible: true });
  const added = await dayhand(key, ["add", "Legacy task", "--json"], { url });
  expect(added.code, added.stderr).toBe(0);
  const cases = [
    ["project"], ["project", "list", "--archived"], ["project", "add", "Home"],
    ["project", "add", "Home", "--dry-run"],
    ["project", "edit", "Home", "--note", "Context"], ["project", "archive", "Home"],
    ["project", "unarchive", "Home"], ["project", "rm", "Home", "--move-tasks-to", "none"],
    ["project", "assign", "none", "1"], ["list", "-p", "none"], ["today", "-p", "Home"],
    ["board", "-p", "Home"], ["add", "X", "-p", "Home"], ["edit", "1", "--clear-project"],
  ];
  for (const args of cases) {
    const run = await dayhand(key, [...args, "--json"], { url });
    expect(run.code, args.join(" ")).toBe(2);
    expect(run.stdout).toBe("");
    const error = jsonError(run);
    expect(error.message).toContain("Needs backend 0.13.0 or later");
    expect(validate("error.schema.json", { error })).toEqual([]);
  }
  const human = await dayhand(key, ["project"], { url });
  expect(human.stderr).toContain("Needs backend 0.13.0 or later");
  const list = await dayhand(key, ["list"], { url });
  expect(list.code).toBe(0);
  expect(list.stdout).toContain("Legacy task");
}, 30_000);
