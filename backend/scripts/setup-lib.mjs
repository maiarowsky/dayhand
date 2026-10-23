// The parts of `npm run setup` (scripts/setup.mjs) that need no network:
// options, the private folder with the server's state and keys, the
// signing key, what to change in a deployment that is already configured,
// and reading the Convex CLI's answers.
import { randomBytes } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { parseArgs } from "node:util";
import { generateSigningKey, jwksDataUri, privateJwkOf, publishesKey } from "./jwt.mjs";

export const MIN_NODE_MAJOR = 22;
export const DEFAULT_PROJECT = "helm";
/** Single-user deployments: the app user is <issuer>|owner (docs/deploy.md). */
export const SUBJECT = "owner";
export const LOCAL_ISSUER = "https://helm.local";
export const DEFAULT_PORT = 3210;
export const DEFAULT_SITE_PORT = 3211;
/** --local --public-url: the Convex API is expected on the same host at this port (docs/deploy.md, Tailscale). */
export const PUBLIC_API_PORT = 8443;
/** The deployment's environment that `npm run setup` manages. */
export const ENV_NAMES = ["HELM_JWT_ISSUER", "HELM_JWKS", "HELM_JWT_PRIVATE_JWK"];

export const FILES = {
  state: "server.json",
  signingKey: "signing-key.json",
  cliKey: "cli-key",
  convexEnv: "convex.env",
  instanceSecret: "instance-secret.json",
  data: "data",
};

export class UsageError extends Error {}

export const USAGE = `Usage: npm run setup [-- options]

Sets up your own Helm server on your own free Convex account, or with --local
on this computer without an account. Run it again to update the server; it
keeps its keys and data.

Options:
  --local               Run the server on this computer (Convex local backend), no account
  --team <slug>         Convex team (default: your only team; asked when you have several)
  --project <name>      Name of the new Convex project (default: ${DEFAULT_PROJECT})
  --deployment <name>   Use this existing production deployment instead of a new project
  --issuer <url>        HELM_JWT_ISSUER for a new server (default: the server's address)
  --port <n>            --local: Convex API port (default: ${DEFAULT_PORT})
  --site-port <n>       --local: HTTP actions port (default: ${DEFAULT_SITE_PORT})
  --public-url <url>    --local: the HTTPS address phones use (e.g. tailscale serve);
                        the Convex API is expected on the same host at port ${PUBLIC_API_PORT}
  --public-api-url <url> --local: the Convex API's HTTPS address, when not that port
  --dry-run             Show what would be done; change nothing, no network
  --json                Print the result as JSON on stdout (progress goes to stderr)
  -h, --help            Show this help

Secrets go only to a private folder (mode 600): HELM_SERVER_CONFIG_DIR, or
~/Library/Application Support/helm-server (macOS), $XDG_CONFIG_HOME/helm-server
or ~/.config/helm-server (Linux), %APPDATA%\\helm-server (Windows).`;

const TEAM = /^[a-z0-9][a-z0-9-]{0,63}$/;
const PROJECT = /^[A-Za-z0-9][A-Za-z0-9 _-]{0,63}$/;
/** Convex's generated deployment names: word-word-123. */
const DEPLOYMENT = /^[a-z]+-[a-z]+-\d+$/;

/** Parses and checks the command line; throws UsageError with a message for people. */
export function parseOptions(argv) {
  let values;
  try {
    ({ values } = parseArgs({
      args: argv,
      strict: true,
      allowPositionals: false,
      options: {
        local: { type: "boolean" },
        team: { type: "string" },
        project: { type: "string" },
        deployment: { type: "string" },
        issuer: { type: "string" },
        port: { type: "string" },
        "site-port": { type: "string" },
        "public-url": { type: "string" },
        "public-api-url": { type: "string" },
        "dry-run": { type: "boolean" },
        json: { type: "boolean" },
        help: { type: "boolean", short: "h" },
      },
    }));
  } catch (error) {
    throw new UsageError(error.message, { cause: error });
  }
  const options = {
    local: values.local ?? false,
    team: values.team,
    project: values.project ?? DEFAULT_PROJECT,
    deployment: values.deployment,
    issuer: values.issuer === undefined ? undefined : checkIssuer(values.issuer),
    port: port(values.port, DEFAULT_PORT, "--port"),
    sitePort: port(values["site-port"], DEFAULT_SITE_PORT, "--site-port"),
    publicUrl: values["public-url"] === undefined ? undefined : httpsOrigin(values["public-url"], "--public-url"),
    publicApiUrl: values["public-api-url"] === undefined ? undefined : httpsOrigin(values["public-api-url"], "--public-api-url"),
    dryRun: values["dry-run"] ?? false,
    json: values.json ?? false,
    help: values.help ?? false,
  };
  if (options.team !== undefined && !TEAM.test(options.team)) throw new UsageError(`--team ${options.team}: a team slug is lower case letters, digits and -`);
  if (!PROJECT.test(options.project)) throw new UsageError("--project: 1 to 64 letters, digits, spaces, _ and -, starting with a letter or digit");
  if (options.deployment !== undefined && !DEPLOYMENT.test(options.deployment)) {
    throw new UsageError(`--deployment ${options.deployment}: expected a deployment name like happy-otter-123`);
  }
  if (options.local) {
    const cloudOnly = ["team", "deployment", "issuer"].filter((name) => values[name] !== undefined);
    if (values.project !== undefined) cloudOnly.push("project");
    if (cloudOnly.length) throw new UsageError(`--local runs without an account; leave out ${cloudOnly.map((name) => `--${name}`).join(", ")}`);
    if (options.port === options.sitePort) throw new UsageError("--port and --site-port must differ");
    if (options.publicApiUrl && !options.publicUrl) throw new UsageError("--public-api-url needs --public-url");
    if (options.publicUrl && !options.publicApiUrl) {
      const api = new URL(options.publicUrl);
      api.port = String(PUBLIC_API_PORT);
      options.publicApiUrl = api.origin;
    }
    if (options.publicUrl && options.publicUrl === options.publicApiUrl) throw new UsageError("--public-url and --public-api-url must differ");
  } else {
    const localOnly = ["port", "site-port", "public-url", "public-api-url"].filter((name) => values[name] !== undefined);
    if (localOnly.length) throw new UsageError(`${localOnly.map((name) => `--${name}`).join(", ")}: for --local only`);
  }
  if (options.deployment !== undefined && (values.team !== undefined || values.project !== undefined)) {
    throw new UsageError("--deployment names an existing deployment; leave out --team and --project");
  }
  return options;
}

function port(value, fallback, flag) {
  if (value === undefined) return fallback;
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1 || n > 65535) throw new UsageError(`${flag} ${value}: a port is 1 to 65535`);
  return n;
}

/** An https URL without path, query or fragment, as its origin. */
function httpsOrigin(value, flag) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new UsageError(`${flag} ${value}: not a URL`);
  }
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash || (url.pathname !== "/" && url.pathname !== "")) {
    throw new UsageError(`${flag} ${value}: use an https URL without path, e.g. https://helm.example`);
  }
  return url.origin;
}

/** HELM_JWT_ISSUER: an https origin. It becomes part of every user id. */
export const checkIssuer = (value) => httpsOrigin(value, "--issuer");

/** Node.js new enough for hlm too (22.12+); returns an error message or null. */
export function nodeProblem(version = process.versions.node) {
  const major = Number(version.split(".")[0]);
  return major >= MIN_NODE_MAJOR ? null : `Node.js ${MIN_NODE_MAJOR} or newer is needed (this is ${version}); see https://nodejs.org`;
}

/** Where the server's private files live, following each system's convention (like hlm's own folder). */
export function configDir(env = process.env, platform = process.platform, home = homedir()) {
  if (env.HELM_SERVER_CONFIG_DIR) return env.HELM_SERVER_CONFIG_DIR;
  const join = platform === "win32" ? path.win32.join : path.posix.join;
  if (platform === "win32") return join(env.APPDATA || join(home, "AppData", "Roaming"), "helm-server");
  if (platform === "darwin") return join(home, "Library", "Application Support", "helm-server");
  const xdg = env.XDG_CONFIG_HOME && path.posix.isAbsolute(env.XDG_CONFIG_HOME) ? env.XDG_CONFIG_HOME : join(home, ".config");
  return join(xdg, "helm-server");
}

/** The folder of one server: `cloud` for the Convex account, `local` for --local. */
export const serverDir = (root, local) => path.join(root, local ? "local" : "cloud");

/** Creates the folder readable only by its owner (on Windows the profile folder's ACL does that). */
export function ensurePrivateDir(dir) {
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  if (process.platform !== "win32") chmodSync(dir, 0o700);
}

/** Writes a file readable only by its owner, replacing it in one step (no half-written keys). */
export function writePrivate(file, content) {
  const temp = `${file}.${randomBytes(4).toString("hex")}.tmp`;
  writeFileSync(temp, content, { mode: 0o600, flag: "wx" });
  if (process.platform !== "win32") chmodSync(temp, 0o600);
  renameSync(temp, file);
}

/** server.json: no secrets, only what identifies the server. */
export function readState(dir) {
  const file = path.join(dir, FILES.state);
  if (!existsSync(file)) return null;
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch (error) {
    throw new Error(`${file} is not valid JSON; fix or move it and run again`, { cause: error });
  }
}

export function writeState(dir, state) {
  writePrivate(path.join(dir, FILES.state), `${JSON.stringify({ version: 1, ...state }, null, 2)}\n`);
}

/** The signing key kept in the server's folder, made once and never overwritten. */
export async function loadOrCreateSigningKey(dir, { create = true } = {}) {
  const file = path.join(dir, FILES.signingKey);
  if (existsSync(file)) {
    let privateJwk;
    try {
      privateJwk = privateJwkOf(JSON.parse(readFileSync(file, "utf8")));
    } catch (error) {
      throw new Error(`${file} does not hold a signing key; move it away to make a new one`, { cause: error });
    }
    return { file, privateJwk, jwksDataUri: jwksDataUri(privateJwk), created: false };
  }
  if (!create) return { file, privateJwk: null, jwksDataUri: null, created: false };
  const { privateJwk } = await generateSigningKey();
  writePrivate(file, JSON.stringify({ privateJwk }));
  return { file, privateJwk, jwksDataUri: jwksDataUri(privateJwk), created: true };
}

/**
 * What to change in the deployment, given what it has (`names` set, the public values of
 * HELM_JWT_ISSUER and HELM_JWKS) and the local key.
 * issuer: "set" when unset, "keep" when equal, "adopt" when it differs: the issuer is never
 * replaced, it is part of every user id and a new one would hide the user's data.
 * keys (HELM_JWKS and HELM_JWT_PRIVATE_JWK, a pair): "set" both when neither is set, "keep"
 * when HELM_JWKS publishes the local key and the private key is set, "complete" when only
 * the private key is missing, "differs" when the deployment has another key (replaced only
 * when the user says so).
 */
export function envPlan(current, wanted) {
  const has = (name) => current.names.includes(name);
  const issuer = !has("HELM_JWT_ISSUER") ? "set" : current.issuer === wanted.issuer ? "keep" : "adopt";
  const jwksSet = has("HELM_JWKS");
  const privateSet = has("HELM_JWT_PRIVATE_JWK");
  const ours = jwksSet && publishesKey(current.jwks ?? "", wanted.privateJwk);
  const keys = !jwksSet && !privateSet ? "set" : ours ? (privateSet ? "keep" : "complete") : "differs";
  return { issuer, keys };
}

/** Hides each secret in a text before it is shown (errors of the Convex CLI). */
export function redact(text, secrets) {
  let out = String(text ?? "");
  for (const secret of secrets) if (secret && secret.length >= 8) out = out.split(secret).join("[hidden]");
  return out;
}

// Escape sequences: colours (CSI) and terminal links (OSC 8).
const ANSI = /\u001b\[[0-9;?]*[ -/]*[@-~]|\u001b\][^\u0007\u001b]*(?:\u0007|\u001b\\)/g;
export const stripAnsi = (text) => String(text ?? "").replace(ANSI, "");

/** Teams from `convex login status` (lines "  - Name (slug)"). */
export function parseTeams(output) {
  return stripAnsi(output)
    .split(/\r?\n/)
    .map((line) => /^\s+- (.*) \(([a-z0-9][a-z0-9-]*)\)\s*$/.exec(line))
    .filter(Boolean)
    .map(([, name, slug]) => ({ name, slug }));
}

/** Whether `convex login status` says the device is logged in. */
export const loggedIn = (output) => /Status: Logged in/.test(stripAnsi(output));

/** The project slug from `convex project create` ("Created project <slug> in team <team>"). */
export function parseProjectSlug(output) {
  return /Created project (\S+) in team \S+/.exec(stripAnsi(output))?.[1] ?? null;
}

/** The deployment's own URLs (from an inline query) and its name, the first label of its host. */
export function deploymentUrls(value) {
  const cloudUrl = typeof value?.cloud === "string" ? value.cloud : "";
  const siteUrl = typeof value?.site === "string" ? value.site : "";
  let host;
  try {
    host = new URL(cloudUrl).hostname;
    new URL(siteUrl);
  } catch {
    throw new Error(`The deployment did not report its URLs (got ${JSON.stringify(value)})`);
  }
  return { cloudUrl, siteUrl: siteUrl.replace(/\/+$/, ""), name: host.split(".")[0] };
}

/** The deep link the phone app reads (docs/pairing.md). */
export const pairingLink = (siteUrl, code) => `helm://pair?url=${encodeURIComponent(siteUrl)}&code=${code}`;

/** CONVEX_DEPLOYMENT and friends for the Convex CLI (`--env-file`), one variable per line. */
export function envFileText(vars) {
  return Object.entries(vars)
    .map(([name, value]) => {
      if (/[\r\n]/.test(value)) throw new Error(`${name} must be one line`);
      return `${name}=${value}\n`;
    })
    .join("");
}
