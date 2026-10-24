// Your own Dayhand server: `dayhand server deploy` puts it on your free Convex
// account, `dayhand server start` runs it on this computer. Both run the
// backend's setup script (backend/scripts/setup.mjs, also `npm run setup`)
// from a copy of the Dayhand repository, because deploying needs the backend's
// code and the Convex CLI that dayhand does not carry, and then sign dayhand in with
// the CLI key the script made, like `dayhand login --url`. The key is read from
// the script's private folder and never printed.
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import qrcode from "qrcode-terminal";
import type { Env } from "../config/env.js";
import { saveProfileUrl } from "../config/file.js";
import { normalizeUrl } from "../config/url.js";
import { CliError, usageError } from "../core/exit.js";
import { PROFILE, storeKey } from "./auth.js";
import type { CommandSpec, Opts, Outcome, RunContext } from "./types.js";

const SCRIPT = path.join("scripts", "setup.mjs");
const BACKEND_NAMES = ["dayhand-backend", "helm-backend"];

/** A Dayhand backend folder: its package.json names dayhand-backend (helm-backend before the rename) and it has the setup script. */
function isBackend(dir: string): boolean {
  try {
    return existsSync(path.join(dir, SCRIPT)) && BACKEND_NAMES.includes(JSON.parse(readFileSync(path.join(dir, "package.json"), "utf8")).name);
  } catch {
    return false;
  }
}

/**
 * backend/ of a Dayhand checkout: --backend, DAYHAND_BACKEND_DIR, the one next to this dayhand when it
 * runs from the repository, else the current folder or one above it (or its backend/). The
 * script found is run, so a checkout of your own wins over whatever folder you stand in.
 */
export function findBackend(given: string | undefined, env: Env, cwd: string, beside = fileURLToPath(new URL("../../../backend", import.meta.url))): string | null {
  const explicit = given ?? env.DAYHAND_BACKEND_DIR;
  if (explicit) {
    const dir = path.resolve(cwd, explicit);
    return isBackend(dir) ? dir : null;
  }
  if (isBackend(beside)) return beside;
  for (let dir = path.resolve(cwd); ; dir = path.dirname(dir)) {
    if (isBackend(dir)) return dir;
    if (isBackend(path.join(dir, "backend"))) return path.join(dir, "backend");
    if (path.dirname(dir) === dir) return null;
  }
}

type Engine = { result: Record<string, any>; child: ChildProcess; exited: Promise<number | null> };

/** Runs the setup script with --json: progress goes to stderr as it comes, the result is its first JSON line. */
function runEngine(backend: string, args: string[], env: Env): Promise<Engine> {
  const child = spawn(process.execPath, [path.join(backend, SCRIPT), ...args, "--json"], {
    cwd: backend,
    env: env as NodeJS.ProcessEnv,
    stdio: ["inherit", "pipe", "inherit"],
    windowsHide: true,
  });
  const exited = new Promise<number | null>((resolve) => child.on("close", resolve));
  return new Promise((resolve, reject) => {
    let buffer = "";
    let found = false;
    child.on("error", (error) => reject(new CliError("internal", `Cannot run ${SCRIPT}: ${error.message}`)));
    child.stdout!.on("data", (chunk) => {
      buffer += chunk;
      let newline: number;
      while (!found && (newline = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, newline).trim();
        buffer = buffer.slice(newline + 1);
        if (!line.startsWith("{")) continue;
        found = true;
        resolve({ result: JSON.parse(line), child, exited });
      }
    });
    void exited.then((code) => {
      if (found) return;
      // The script has already said why on stderr; 2 is a mistake in the options.
      const message = `The server setup stopped (exit ${code}); see the messages above`;
      reject(code === 2 ? usageError(message) : new CliError("internal", message));
    });
  });
}

const ENGINE_FLAGS: Record<string, string> = {
  team: "--team",
  project: "--project",
  deployment: "--deployment",
  issuer: "--issuer",
  port: "--port",
  sitePort: "--site-port",
  publicUrl: "--public-url",
  publicApiUrl: "--public-api-url",
};

function engineArgs(opts: Opts, local: boolean, dryRun: boolean): string[] {
  const args = local ? ["--local"] : [];
  for (const [option, flag] of Object.entries(ENGINE_FLAGS)) {
    if (opts[option] !== undefined) args.push(flag, String(opts[option]));
  }
  if (dryRun) args.push("--dry-run");
  return args;
}

/** Stores the script's CLI key for the server URL and remembers the URL as a profile. */
async function signIn(ctx: RunContext, result: Record<string, any>, local: boolean) {
  const url = normalizeUrl(result.url);
  const key = readFileSync(result.key.file, "utf8").trim();
  const settings = (await ctx.clientFor(url, key).callTool("get_settings")).structured as { timezone?: string };
  const used = await storeKey(ctx, url, key, undefined);
  const config = ctx.config();
  const profile = ctx.flags.profile ?? (local ? "local" : (config.defaultProfile ?? "default"));
  if (!PROFILE.test(profile)) throw usageError("Profile names use letters, digits, - and _");
  const before = config.profiles[profile]?.url;
  const change = saveProfileUrl(config, profile, url);
  if (before && before !== url) {
    ctx.out.warn({ code: "profile_in_use", message: `Profile ${profile} already points at ${before} and is unchanged; use dayhand --profile <name> server …` });
  }
  return { profile, store: used.name, location: used.location, config: change, timezone: settings.timezone ?? null };
}

async function summary(result: Record<string, any>, login: { profile: string; location: string }): Promise<string> {
  const { url, pairing, files, server } = result;
  const until = new Date(pairing.expiresAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  const qr = await new Promise<string>((resolve) => qrcode.generate(pairing.link, { small: true }, resolve));
  const local = result.mode === "local";
  return [
    `Dayhand is ready: ${url} (${server.name} ${server.version})`,
    `dayhand is signed in (profile ${login.profile}, key in ${login.location}); try: dayhand add "First task" --due today`,
    "",
    `Pair the phone (code valid until ${until}, once):`,
    qr,
    `  Server address  ${url}`,
    `  Pairing code    ${pairing.code}`,
    `  Or open         ${pairing.link}`,
    "",
    `Keys and settings stay in ${files.dir} (readable only by you).`,
    ...(local
      ? [`Claude Code: an agent key (dayhand key create claude --scope write) in the Authorization header of ${url}/mcp (docs/mcp.md).`, "The Claude apps need a public HTTPS server: dayhand server deploy."]
      : [
          `Claude app: Settings → Connectors → Add custom connector, ${url}/mcp (docs/oauth.md).`,
          `Claude Code: claude mcp add --transport http dayhand ${url}/mcp, then /mcp to sign in; approve on the phone.`,
        ]),
    local ? "Stop with Ctrl+C; dayhand server start again keeps the data." : "Update later: dayhand server deploy again (keys and data are kept).",
  ].join("\n");
}

async function setup(ctx: RunContext, opts: Opts, local: boolean): Promise<Outcome> {
  const name = local ? "start" : "deploy";
  if (!ctx.interactive && !ctx.yes && !ctx.dryRun) {
    throw usageError(`dayhand server ${name} can ask questions${local ? "" : " and log in to Convex in a browser"}; without a terminal pass --yes (every question gets its safe answer)`);
  }
  const backend = findBackend(opts.backend as string | undefined, ctx.env, process.cwd());
  if (!backend) {
    throw usageError("dayhand server needs a copy of the Dayhand repository: it deploys the repository's backend/ folder", {
      hint: "git clone https://github.com/maiarowsky/helm.git && cd helm && dayhand server " + name + "   (or --backend <folder>)",
    });
  }
  ctx.io.stderr.write(`Using the Dayhand backend in ${backend}\n`);
  const engine = await runEngine(backend, engineArgs(opts, local, ctx.dryRun), ctx.env);
  if (ctx.dryRun) {
    await engine.exited;
    const plan = engine.result.plan as string[];
    return { value: engine.result, view: { kind: "text", text: ["Would do (nothing changes):", ...plan.map((step, i) => `  ${i + 1}. ${step}`)].join("\n") } };
  }
  let login;
  try {
    login = await signIn(ctx, engine.result, local);
  } catch (error) {
    engine.child.kill("SIGTERM");
    throw error;
  }
  const value = { ...engine.result, login };
  const text = await summary(engine.result, login);
  if (!engine.result.running) return { value, view: { kind: "text", text } };
  // The local server runs in the script until Ctrl+C (which reaches both) or a stop signal.
  if (ctx.format === "json") ctx.out.json(value);
  else ctx.out.text(text);
  const stop = () => engine.child.kill("SIGTERM");
  process.on("SIGINT", () => undefined);
  process.on("SIGTERM", stop);
  await engine.exited;
  return { value, view: { kind: "text", text }, printed: true };
}

const BACKEND_OPTION = { flags: "--backend <folder>", description: "The Dayhand repository's backend/ folder (default: found from here)" };

const server: CommandSpec = {
  name: "server",
  summary: "Your own Dayhand server: on your free Convex account, or on this computer",
  description:
    "Runs backend/scripts/setup.mjs from a copy of the Dayhand repository (npm run setup does the same without dayhand), " +
    "then signs dayhand in. Keys stay in a private folder (DAYHAND_SERVER_CONFIG_DIR) and are never printed. See docs/deploy.md.",
  tools: [],
  subcommands: [
    {
      name: "deploy",
      schema: ["server.schema.json", "server-plan.schema.json"],
      summary: "Set up or update your server on your own Convex account, sign dayhand in and make a pairing code",
      description:
        "Logs in to Convex in the browser, creates a project with a production deployment (or uses --deployment), " +
        "sets the app-signing key and DAYHAND_* variables, deploys, checks /api/v1/openapi.json, /auth/token and /mcp, " +
        "and makes a CLI key and a pairing code. Run it again to update: keys, the CLI key and the data are kept; " +
        "a different signing key is replaced only after a question, the issuer never. --dry-run shows the steps without network.",
      options: [
        { flags: "--team <slug>", description: "Convex team (default: your only team; asked when you have several)" },
        { flags: "--project <name>", description: "Name of the new Convex project (default: dayhand)" },
        { flags: "--deployment <name>", description: "Use this existing production deployment instead of a new project" },
        { flags: "--issuer <url>", description: "DAYHAND_JWT_ISSUER for a new server (default: the server's address)" },
        BACKEND_OPTION,
      ],
      tools: ["get_settings"],
      examples: ["dayhand server deploy", "dayhand server deploy --team my-team --project dayhand", "dayhand server deploy --dry-run"],
      run: (ctx, _args, opts) => setup(ctx, opts, false),
    },
    {
      name: "start",
      schema: ["server.schema.json", "server-plan.schema.json"],
      summary: "Run your server on this computer (Convex local backend, no account) until Ctrl+C, sign dayhand in",
      description:
        "macOS and Linux. Data and keys stay in DAYHAND_SERVER_CONFIG_DIR/local, so the same command starts the server again. " +
        "A phone with a release build needs HTTPS: put the ports behind tailscale serve and pass --public-url (docs/deploy.md). " +
        "With --json the result is printed when the server is ready.",
      options: [
        { flags: "--port <n>", description: "Convex API port (default: 3210)", kind: "int" },
        { flags: "--site-port <n>", description: "HTTP actions port (default: 3211)", kind: "int" },
        { flags: "--public-url <url>", description: "The HTTPS address phones use, e.g. https://<machine>.<tailnet>.ts.net" },
        { flags: "--public-api-url <url>", description: "The Convex API's HTTPS address (default: --public-url at port 8443)" },
        BACKEND_OPTION,
      ],
      tools: ["get_settings"],
      examples: ["dayhand server start", "dayhand server start --public-url https://laptop.tail1234.ts.net", "dayhand server start --json --yes"],
      run: (ctx, _args, opts) => setup(ctx, opts, true),
    },
  ],
};

export const serverCommands: CommandSpec[] = [server];
