// Starts the Convex local backend binary and deploys this project's functions
// to it. Used by the test suite and by `npm run backend:start`.
import { execFile, spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdirSync, openSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { fetchLocalBackend } from "./fetch-local-backend.mjs";

const execFileAsync = promisify(execFile);
export const BACKEND_DIR = join(dirname(fileURLToPath(import.meta.url)), "..");
const CONVEX_BIN = join(BACKEND_DIR, "node_modules", ".bin", "convex");

export function newInstanceSecret() {
  return randomBytes(32).toString("hex");
}

async function waitForVersion(url, child, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`Local backend exited early with code ${child.exitCode}`);
    }
    try {
      const response = await fetch(`${url}/version`);
      if (response.ok) return;
    } catch {
      // Not listening yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`Local backend did not start within ${timeoutMs} ms`);
}

/**
 * @param {{ dataDir: string, port: number, sitePort: number,
 *           instanceName: string, instanceSecret: string }} options
 */
export async function startLocalBackend(options) {
  const { dataDir, port, sitePort, instanceName, instanceSecret } = options;
  const bin = await fetchLocalBackend();
  mkdirSync(dataDir, { recursive: true });
  const { stdout } = await execFileAsync(bin, [
    "keygen",
    "admin-key",
    "--instance-name",
    instanceName,
    "--instance-secret",
    instanceSecret,
  ]);
  const adminKey = stdout.trim();
  const log = openSync(join(dataDir, "backend.log"), "a");
  const child = spawn(
    bin,
    [
      "--instance-name",
      instanceName,
      "--instance-secret",
      instanceSecret,
      "--port",
      String(port),
      "--site-proxy-port",
      String(sitePort),
      "--interface",
      "127.0.0.1",
      "--local-storage",
      join(dataDir, "storage"),
      "--disable-beacon",
      join(dataDir, "db.sqlite3"),
    ],
    { cwd: dataDir, stdio: ["ignore", log, log] },
  );
  const url = `http://127.0.0.1:${port}`;
  const siteUrl = `http://127.0.0.1:${sitePort}`;
  try {
    await waitForVersion(url, child);
  } catch (error) {
    child.kill("SIGKILL");
    throw error;
  }
  const stop = () =>
    new Promise((resolve) => {
      if (child.exitCode !== null) return resolve();
      child.once("exit", () => resolve());
      child.kill("SIGTERM");
    });
  return { url, siteUrl, adminKey, child, stop };
}

/** Environment for the Convex CLI talking to a self-hosted backend. */
export function convexCliEnv({ url, adminKey, home }) {
  return {
    ...process.env,
    ...(home ? { HOME: home } : {}),
    CONVEX_SELF_HOSTED_URL: url,
    CONVEX_SELF_HOSTED_ADMIN_KEY: adminKey,
    CONVEX_DEPLOYMENT: "",
  };
}

export async function runConvexCli(args, env) {
  return execFileAsync(CONVEX_BIN, args, {
    cwd: BACKEND_DIR,
    env,
    maxBuffer: 10 * 1024 * 1024,
  });
}

/** Sets deployment environment variables, then pushes the functions. */
export async function deployFunctions({ url, adminKey, home, envVars = {} }) {
  const env = convexCliEnv({ url, adminKey, home });
  for (const [name, value] of Object.entries(envVars)) {
    await runConvexCli(["env", "set", name, value], env);
  }
  await runConvexCli(["deploy", "--yes", "--typecheck", "disable", "--codegen", "enable"], env);
}
