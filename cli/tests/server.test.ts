// hlm server start end to end: the backend's setup script starts its own
// local backend (not the test run's), deploys, makes the keys, signs hlm in;
// then hlm adds a task, a phone pairs with the printed code and sees it, and
// a second start keeps keys, key and data. Nothing touches the real config:
// HOME, HLM_CONFIG_DIR and HELM_SERVER_CONFIG_DIR are private folders.
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, test } from "vitest";
import { freePort } from "./globalSetup.js";
import { schemaValidator } from "./helpers.js";

const BIN = fileURLToPath(new URL("../dist/bin/hlm.js", import.meta.url));
const HOME = mkdtempSync(join(process.env.HLM_TEST_TMPDIR ?? tmpdir(), "hlm-server-"));
afterAll(() => rmSync(HOME, { recursive: true, force: true }));

const env = {
  PATH: process.env.PATH ?? "",
  HOME,
  USERPROFILE: HOME,
  APPDATA: HOME,
  LOCALAPPDATA: HOME,
  HLM_CONFIG_DIR: join(HOME, "hlm"),
  HLM_CACHE_DIR: join(HOME, "cache"),
  HLM_CREDENTIAL_STORE: "file",
  HELM_SERVER_CONFIG_DIR: join(HOME, "helm-server"),
};
const validate = schemaValidator();

type Started = { child: ChildProcess; result: any; stdout: () => string; stderr: () => string };

/** Runs hlm server start --json and resolves with its result once the server is ready. */
function start(ports: { port: number; sitePort: number }): Promise<Started> {
  const child = spawn(process.execPath, [BIN, "server", "start", "--port", String(ports.port), "--site-port", String(ports.sitePort), "--json", "--yes"], {
    env,
    stdio: ["pipe", "pipe", "pipe"],
  });
  child.stdin!.end();
  let stdout = "";
  let stderr = "";
  child.stderr!.on("data", (d) => (stderr += d));
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`hlm server start did not get ready:\n${stderr}`));
    }, 150_000);
    child.stdout!.on("data", (d) => {
      stdout += d;
      const line = stdout.split("\n").find((l) => l.startsWith("{"));
      if (!line) return;
      clearTimeout(timer);
      resolve({ child, result: JSON.parse(line), stdout: () => stdout, stderr: () => stderr });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      reject(new Error(`hlm server start exited ${code}:\n${stderr}`));
    });
  });
}

function stop(child: ChildProcess): Promise<number | null> {
  return new Promise((resolve) => {
    child.once("close", resolve);
    child.kill("SIGTERM");
  });
}

/** hlm with the private config only: no HLM_URL, no HLM_API_KEY, so the stored profile and key are used. */
function hlm(args: string[]): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [BIN, ...args], { env, stdio: ["pipe", "pipe", "pipe"] });
    child.stdin!.end();
    let stdout = "";
    let stderr = "";
    child.stdout!.on("data", (d) => (stdout += d));
    child.stderr!.on("data", (d) => (stderr += d));
    child.on("error", reject);
    child.on("close", (code) => resolve({ code, stdout, stderr }));
  });
}

async function post(url: string, body: unknown) {
  const response = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  return { status: response.status, body: (await response.json()) as any };
}

const mode = (file: string) => statSync(file).mode & 0o777;

describe("hlm server", () => {
  test("deploy --dry-run lists the steps, writes nothing and needs no account", async () => {
    const run = await hlm(["server", "deploy", "--dry-run", "--json", "--team", "my-team"]);
    expect(run.code, run.stderr).toBe(0);
    const plan = JSON.parse(run.stdout);
    expect(validate("server-plan.schema.json", plan)).toEqual([]);
    expect(plan.plan.join("\n")).toContain("npx convex project create helm --team my-team");
    expect(existsSync(env.HELM_SERVER_CONFIG_DIR)).toBe(false);
  });

  test("without a terminal it refuses unless --yes", async () => {
    const run = await hlm(["server", "start", "--port", "1", "--site-port", "2"]);
    expect(run.code).toBe(2);
    expect(run.stderr).toMatch(/pass --yes/);
  });

  test("start: own server, hlm signed in, a phone pairs and sees hlm's task; a second start keeps everything", async () => {
    const ports = { port: await freePort(), sitePort: await freePort() };
    const first = await start(ports);
    const { result } = first;
    let key = "";
    let signingKey = "";
    try {
      expect(validate("server.schema.json", result)).toEqual([]);
      expect(result).toMatchObject({ mode: "local", url: `http://127.0.0.1:${ports.sitePort}`, issuer: "https://helm.local", userId: "https://helm.local|owner", running: true });
      expect(result).toMatchObject({ key: { created: true }, env: { issuer: "set", keys: "set" }, login: { profile: "local", store: "file", config: "created" } });

      // Secrets: private files only, never in any output.
      const dir = result.files.dir;
      key = readFileSync(result.files.cliKey, "utf8").trim();
      signingKey = readFileSync(result.files.signingKey, "utf8");
      const d = JSON.parse(signingKey).privateJwk.d;
      if (process.platform !== "win32") {
        expect(mode(dir)).toBe(0o700);
        for (const file of [result.files.cliKey, result.files.signingKey, join(dir, "convex.env"), join(dir, "instance-secret.json")]) expect(mode(file), file).toBe(0o600);
      }
      for (const output of [first.stdout(), first.stderr()]) {
        expect(output).not.toContain(key);
        expect(output).not.toContain(d);
      }

      // hlm uses the stored profile and key.
      const added = await hlm(["add", "Pay rent", "--due", "today", "--json"]);
      expect(added.code, added.stderr).toBe(0);
      expect(JSON.parse(added.stdout)).toMatchObject({ ref: 1, title: "Pay rent" });

      // The phone: pair with the code, get an app token, read Today as the same user.
      const paired = await post(`${result.url}/auth/pair`, { code: result.pairing.code, deviceName: "Test phone" });
      expect(paired.status).toBe(200);
      const token = await post(`${result.url}/auth/token`, { deviceToken: paired.body.deviceToken });
      expect(token.status).toBe(200);
      const today = await fetch(`${paired.body.convexUrl}/api/query`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token.body.token}` },
        body: JSON.stringify({ path: "app:listToday", args: {}, format: "json" }),
      });
      expect(JSON.stringify(await today.json())).toContain("Pay rent");
    } finally {
      expect(await stop(first.child)).toBe(0);
    }

    const second = await start(ports);
    try {
      expect(second.result).toMatchObject({ key: { created: false }, env: { issuer: "keep", keys: "keep" }, login: { config: "unchanged" } });
      expect(readFileSync(second.result.files.cliKey, "utf8").trim()).toBe(key);
      expect(readFileSync(second.result.files.signingKey, "utf8")).toBe(signingKey);
      const list = await hlm(["list", "--json"]);
      expect(JSON.parse(list.stdout).result.map((t: { title: string }) => t.title)).toEqual(["Pay rent"]);
      expect(second.result.pairing.code).not.toBe(result.pairing.code);
    } finally {
      expect(await stop(second.child)).toBe(0);
    }
  }, 400_000);
});
