// Pure tests of `npm run setup` (scripts/setup*.mjs): options, the private
// folder, the signing key, what an already configured deployment keeps, the
// readers of the Convex CLI's answers, and a --dry-run of the cloud setup that
// runs with every network connection and child process refused. The setup
// itself, end to end on a local backend, is tested in cli/tests/server.test.ts.
import { execFile } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { afterAll, describe, expect, test } from "vitest";
import { generateSigningKey, jwksDataUri, privateJwkOf, publishesKey } from "../scripts/jwt.mjs";
import {
  checkIssuer,
  configDir,
  envName,
  deploymentUrls,
  envFileText,
  envPlan,
  oldEnvNames,
  resolveConfigDir,
  loadOrCreateSigningKey,
  loggedIn,
  nodeProblem,
  pairingLink,
  parseOptions,
  parseProjectSlug,
  parseTeams,
  redact,
  stripAnsi,
  UsageError,
  writePrivate,
} from "../scripts/setup-lib.mjs";

const run = promisify(execFile);
const TMP = mkdtempSync(join(process.env.DAYHAND_TEST_TMPDIR ?? tmpdir(), "helm-setup-"));
afterAll(() => rmSync(TMP, { recursive: true, force: true }));
const fresh = (name: string) => join(TMP, `${name}-${Math.random().toString(36).slice(2)}`);
const mode = (file: string) => statSync(file).mode & 0o777;

describe("options", () => {
  test("defaults: the cloud setup of a project named dayhand", () => {
    expect(parseOptions([])).toMatchObject({ local: false, project: "dayhand", port: 3210, sitePort: 3211, dryRun: false, json: false });
  });

  test("checks every value and refuses mixtures that cannot work", () => {
    const bad: [string[], RegExp][] = [
      [["--team", "My Team"], /team slug/],
      [["--project", "-x"], /--project/],
      [["--deployment", "prod"], /like happy-otter-123/],
      [["--issuer", "http://helm.example"], /https URL without path/],
      [["--issuer", "https://helm.example/x"], /https URL without path/],
      [["--local", "--team", "t"], /leave out --team/],
      [["--local", "--project", "p"], /leave out --project/],
      [["--local", "--port", "3210", "--site-port", "3210"], /must differ/],
      [["--local", "--port", "70000"], /1 to 65535/],
      [["--port", "4000"], /for --local only/],
      [["--public-url", "https://a.example"], /for --local only/],
      [["--local", "--public-api-url", "https://a.example:8443"], /needs --public-url/],
      [["--deployment", "happy-otter-123", "--team", "t"], /leave out --team and --project/],
      [["--what"], /Unknown option/],
    ];
    for (const [argv, message] of bad) {
      expect(() => parseOptions(argv), argv.join(" ")).toThrow(UsageError);
      expect(() => parseOptions(argv), argv.join(" ")).toThrow(message);
    }
  });

  test("--public-url puts the Convex API on the same host at port 8443 unless told otherwise", () => {
    expect(parseOptions(["--local", "--public-url", "https://laptop.tail1.ts.net/"])).toMatchObject({
      publicUrl: "https://laptop.tail1.ts.net",
      publicApiUrl: "https://laptop.tail1.ts.net:8443",
    });
    expect(parseOptions(["--local", "--public-url", "https://a.example", "--public-api-url", "https://api.a.example"]).publicApiUrl).toBe("https://api.a.example");
  });

  test("the issuer is an https origin", () => {
    expect(checkIssuer("https://helm.example/")).toBe("https://helm.example");
    expect(() => checkIssuer("https://user@helm.example")).toThrow(UsageError);
  });

  test("Node.js 22 or newer", () => {
    expect(nodeProblem("22.12.0")).toBeNull();
    expect(nodeProblem("20.19.0")).toMatch(/Node.js 22 or newer/);
  });
});

describe("the private folder", () => {
  test("each system's config folder, or DAYHAND_SERVER_CONFIG_DIR", () => {
    expect(configDir({ DAYHAND_SERVER_CONFIG_DIR: "/x" }, "linux", "/home/a")).toBe("/x");
    expect(configDir({}, "darwin", "/Users/a")).toBe("/Users/a/Library/Application Support/dayhand-server");
    expect(configDir({}, "linux", "/home/a")).toBe("/home/a/.config/dayhand-server");
    expect(configDir({ XDG_CONFIG_HOME: "/xdg" }, "linux", "/home/a")).toBe("/xdg/dayhand-server");
    expect(configDir({ XDG_CONFIG_HOME: "relative" }, "linux", "/home/a")).toBe("/home/a/.config/dayhand-server");
    expect(configDir({ APPDATA: "C:\\Users\\a\\AppData\\Roaming" }, "win32", "C:\\Users\\a")).toBe("C:\\Users\\a\\AppData\\Roaming\\dayhand-server");
  });

  test("the names from before the rename still work, with a warning", () => {
    const none = () => false;
    expect(resolveConfigDir({ HELM_SERVER_CONFIG_DIR: "/old" }, "linux", "/home/a", none)).toEqual({
      dir: "/old",
      warning: "HELM_SERVER_CONFIG_DIR is deprecated; set DAYHAND_SERVER_CONFIG_DIR instead",
    });
    expect(resolveConfigDir({ DAYHAND_SERVER_CONFIG_DIR: "/new", HELM_SERVER_CONFIG_DIR: "/old" }, "linux", "/home/a", none)).toEqual({ dir: "/new" });
    // A helm-server folder is used while there is no dayhand-server, so the keys and data in it stay in use.
    const onlyOld = (dir: unknown) => dir === "/home/a/.config/helm-server";
    expect(resolveConfigDir({}, "linux", "/home/a", onlyOld)).toEqual({
      dir: "/home/a/.config/helm-server",
      warning: "Using /home/a/.config/helm-server from before the rename; move it to /home/a/.config/dayhand-server to keep the new name",
    });
    const both = (dir: unknown) => String(dir).endsWith("-server");
    expect(resolveConfigDir({}, "darwin", "/Users/a", both)).toEqual({ dir: "/Users/a/Library/Application Support/dayhand-server" });
  });

  test.skipIf(process.platform === "win32")("files are written whole and readable only by the owner, also over a wider file", () => {
    const dir = fresh("private");
    mkdirSync(dir);
    const file = join(dir, "secret");
    writeFileSync(file, "old", { mode: 0o644 });
    chmodSync(file, 0o644);
    writePrivate(file, "new");
    expect(readFileSync(file, "utf8")).toBe("new");
    expect(mode(file)).toBe(0o600);
  });

  test("the signing key is made once, mode 600, and then only read", async () => {
    const dir = fresh("key");
    mkdirSync(dir);
    const first = await loadOrCreateSigningKey(dir);
    expect(first.created).toBe(true);
    if (process.platform !== "win32") expect(mode(first.file)).toBe(0o600);
    expect(publishesKey(first.jwksDataUri!, first.privateJwk!)).toBe(true);
    const content = readFileSync(first.file, "utf8");
    const second = await loadOrCreateSigningKey(dir);
    expect(second).toMatchObject({ created: false, file: first.file });
    expect(second.privateJwk).toEqual(first.privateJwk);
    expect(readFileSync(first.file, "utf8")).toBe(content);
    expect((await loadOrCreateSigningKey(fresh("none"), { create: false })).privateJwk).toBeNull();
    writeFileSync(first.file, "{}");
    await expect(loadOrCreateSigningKey(dir)).rejects.toThrow(/does not hold a signing key/);
  });
});

describe("keys", () => {
  test("DAYHAND_JWKS publishes exactly the key with its kid and coordinates", async () => {
    const { privateJwk } = await generateSigningKey();
    const other = (await generateSigningKey()).privateJwk;
    expect(privateJwkOf({ privateJwk })).toBe(privateJwk);
    expect(() => privateJwkOf({ kty: "EC" })).toThrow(/P-256 private JWK/);
    expect(publishesKey(jwksDataUri(privateJwk), privateJwk)).toBe(true);
    expect(publishesKey(jwksDataUri(other), privateJwk)).toBe(false);
    expect(publishesKey(jwksDataUri({ ...other, kid: privateJwk.kid }), privateJwk)).toBe(false);
    expect(publishesKey("not a data uri", privateJwk)).toBe(false);
    expect(publishesKey("data:application/json;base64,!!!", privateJwk)).toBe(false);
    expect(JSON.parse(Buffer.from(jwksDataUri(privateJwk).split(",")[1], "base64").toString()).keys[0]).not.toHaveProperty("d");
  });

  test("what an existing deployment keeps: never the issuer, another key only when asked", async () => {
    const { privateJwk } = await generateSigningKey();
    const ours = jwksDataUri(privateJwk);
    const theirs = jwksDataUri((await generateSigningKey()).privateJwk);
    const wanted = { issuer: "https://a.convex.site", privateJwk };
    const all = ["DAYHAND_JWT_ISSUER", "DAYHAND_JWKS", "DAYHAND_JWT_PRIVATE_JWK"];
    expect(envPlan({ names: [], issuer: null, jwks: null }, wanted)).toEqual({ issuer: "set", keys: "set" });
    expect(envPlan({ names: all, issuer: wanted.issuer, jwks: ours }, wanted)).toEqual({ issuer: "keep", keys: "keep" });
    expect(envPlan({ names: all, issuer: "https://helm.example", jwks: ours }, wanted)).toEqual({ issuer: "adopt", keys: "keep" });
    expect(envPlan({ names: all, issuer: wanted.issuer, jwks: theirs }, wanted).keys).toBe("differs");
    expect(envPlan({ names: ["DAYHAND_JWKS"], issuer: null, jwks: ours }, wanted)).toEqual({ issuer: "set", keys: "complete" });
    expect(envPlan({ names: ["DAYHAND_JWT_PRIVATE_JWK"], issuer: null, jwks: null }, wanted).keys).toBe("differs");
    expect(envPlan({ names: ["HELM_JWKS"], issuer: null, jwks: theirs }, wanted).keys).toBe("differs");
    // A deployment from before the rename: its HELM_* variables count, and are kept.
    const old = ["HELM_JWT_ISSUER", "HELM_JWKS", "HELM_JWT_PRIVATE_JWK"];
    expect(envPlan({ names: old, issuer: wanted.issuer, jwks: ours }, wanted)).toEqual({ issuer: "keep", keys: "keep" });
    expect(envPlan({ names: ["HELM_JWT_ISSUER", "HELM_JWKS"], issuer: wanted.issuer, jwks: ours }, wanted)).toEqual({ issuer: "keep", keys: "complete" });
    expect(envName(["HELM_JWKS", "DAYHAND_JWKS"], "JWKS")).toBe("DAYHAND_JWKS");
    expect(envName(["HELM_JWKS"], "JWKS")).toBe("HELM_JWKS");
    expect(envName([], "JWKS")).toBeNull();
    expect(oldEnvNames(["HELM_JWT_ISSUER", "DAYHAND_JWKS", "HELM_JWKS", "HELM_JWT_PRIVATE_JWK"])).toEqual(["HELM_JWT_ISSUER", "HELM_JWT_PRIVATE_JWK"]);
  });
});

describe("reading the Convex CLI", () => {
  test("teams, login status and the new project's slug, with or without colours", () => {
    const status = "Convex account token found in: ~/.convex/config.json\nStatus: Logged in\nTeams: 2 teams accessible\n  - Ada Lovelace (ada-lovelace)\n  - \u001b[1mWork\u001b[22m (work-team)\n";
    expect(parseTeams(status)).toEqual([
      { name: "Ada Lovelace", slug: "ada-lovelace" },
      { name: "Work", slug: "work-team" },
    ]);
    expect(loggedIn(status)).toBe(true);
    expect(loggedIn("Status: Not logged in")).toBe(false);
    expect(parseProjectSlug("\u001b[32m✔\u001b[39m Created project \u001b[1mhelm-2\u001b[22m in team \u001b[1mada\u001b[22m, manage it at https://dashboard.convex.dev/t/ada/helm-2")).toBe("helm-2");
    expect(parseProjectSlug("Error: no")).toBeNull();
    expect(stripAnsi("\u001b]8;;https://x\u0007link\u001b]8;;\u0007")).toBe("link");
  });

  test("the deployment's URLs and name, also in a region", () => {
    expect(deploymentUrls({ cloud: "https://happy-otter-123.eu-west-1.convex.cloud", site: "https://happy-otter-123.eu-west-1.convex.site/" })).toEqual({
      cloudUrl: "https://happy-otter-123.eu-west-1.convex.cloud",
      siteUrl: "https://happy-otter-123.eu-west-1.convex.site",
      name: "happy-otter-123",
    });
    expect(() => deploymentUrls({ cloud: null })).toThrow(/did not report its URLs/);
  });

  test("secrets are hidden in shown output; env files are one variable per line", () => {
    expect(redact("key helm_abcdefgh and d=xyz", ["helm_abcdefgh", "xyz"])).toBe("key [hidden] and d=xyz");
    expect(envFileText({ CONVEX_DEPLOYMENT: "prod:happy-otter-123" })).toBe("CONVEX_DEPLOYMENT=prod:happy-otter-123\n");
    expect(() => envFileText({ A: "x\nB=y" })).toThrow(/one line/);
    // M-02: custom URI handlers must never receive the pairing credential.
    expect(pairingLink("https://a.convex.site")).toBe("dayhand://pair?url=https%3A%2F%2Fa.convex.site");
  });
});

describe("--dry-run", () => {
  const script = fileURLToPath(new URL("../scripts/setup.mjs", import.meta.url));
  const blocker = fileURLToPath(new URL("./fixtures/no-network.mjs", import.meta.url));
  const dryRun = (configDirPath: string, args: string[]) =>
    run(process.execPath, ["--import", blocker, script, "--dry-run", "--json", ...args], {
      env: { PATH: process.env.PATH ?? "", HOME: join(configDirPath, "home"), DAYHAND_SERVER_CONFIG_DIR: configDirPath },
    });

  test("the cloud setup: every step, no network, no child process, nothing written", async () => {
    const dir = fresh("dry");
    const { stdout } = await dryRun(dir, ["--team", "my-team", "--project", "My Helm"]);
    const { dryRun: flag, mode: kind, plan } = JSON.parse(stdout);
    expect({ flag, kind }).toEqual({ flag: true, kind: "cloud" });
    const text = plan.join("\n");
    for (const step of [
      "npx convex login",
      'npx convex project create "My Helm" --team my-team',
      'npx convex deployment create "my-team:<project>:production" --type prod --default',
      "--inline-query",
      "generate an ES256 app-signing key",
      "DAYHAND_JWT_ISSUER (https://<deployment>.convex.site, the server's address)",
      "npx convex deploy --yes --typecheck disable --codegen enable --env-file",
      "/api/v1/openapi.json",
      "apiKeys:create",
      "devices:createPairingCode",
    ]) {
      expect(text).toContain(step);
    }
    expect(existsSync(dir)).toBe(false);
  });

  test("a second run reuses the saved deployment and keys", async () => {
    const dir = fresh("dry-again");
    mkdirSync(join(dir, "cloud"), { recursive: true });
    writeFileSync(join(dir, "cloud", "server.json"), JSON.stringify({ deployment: "happy-otter-123", issuer: "https://helm.example" }));
    await loadOrCreateSigningKey(join(dir, "cloud"));
    writeFileSync(join(dir, "cloud", "cli-key"), "helm_x\n");
    const text = JSON.parse((await dryRun(dir, [])).stdout).plan.join("\n");
    expect(text).toContain("use the deployment happy-otter-123");
    expect(text).not.toContain("project create");
    expect(text).toContain("reuse the app-signing key");
    expect(text).toContain("DAYHAND_JWT_ISSUER (https://helm.example)");
    expect(text).toContain("keep the CLI key");
  });

  test("a mistake in the options exits 2 before anything runs", async () => {
    await expect(dryRun(fresh("bad"), ["--local", "--team", "x"])).rejects.toMatchObject({ code: 2 });
  });
});
