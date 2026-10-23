#!/usr/bin/env node
// `npm run setup`: your own Helm server in one command (docs/deploy.md).
//   default  on your own free Convex account: log in in the browser, a new
//            project with a production deployment (or --deployment), the
//            app-signing key and the HELM_* variables, the functions
//            deployed and checked, a CLI key and a pairing code;
//   --local  the same on this computer with the Convex local backend and no
//            account; it runs until Ctrl+C, and the same command starts it again.
// Run it again to update the server: the keys, the CLI key and the data are
// kept, and nothing the deployment already has is replaced without asking.
// `hlm server deploy` and `hlm server start` run this script and sign hlm in.
// Only Node.js built-ins are imported up front: the script installs the
// backend's dependencies itself when they are missing.
import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { createServer } from "node:net";
import { dirname, join } from "node:path";
import { createInterface } from "node:readline/promises";
import { BACKEND_DIR, newInstanceSecret, startLocalBackend } from "./local-backend-lib.mjs";
import { checkMcp, checkOpenApi, checkSigning, commands, convex, hasConvexCli, parseRunOutput } from "./setup-convex.mjs";
import {
  configDir,
  deploymentUrls,
  envFileText,
  envPlan,
  FILES,
  LOCAL_ISSUER,
  ensurePrivateDir,
  loadOrCreateSigningKey,
  nodeProblem,
  pairingLink,
  parseOptions,
  parseProjectSlug,
  parseTeams,
  readState,
  serverDir,
  SUBJECT,
  USAGE,
  UsageError,
  writePrivate,
  writeState,
} from "./setup-lib.mjs";
import { dryRunPlan, humanSummary } from "./setup-output.mjs";

const log = (line = "") => process.stderr.write(`${line}\n`);

/** Asks a yes/no question on the terminal; without one the answer is no. */
async function confirm(question) {
  if (!process.stdin.isTTY) {
    log(`${question} [y/N] no (not a terminal)`);
    return false;
  }
  const rl = createInterface({ input: process.stdin, output: process.stderr });
  try {
    return /^y(es)?$/i.test((await rl.question(`${question} [y/N] `)).trim());
  } finally {
    rl.close();
  }
}

async function choose(question, choices) {
  const rl = createInterface({ input: process.stdin, output: process.stderr });
  try {
    choices.forEach((choice, i) => log(`  ${i + 1}. ${choice}`));
    for (;;) {
      const n = Number((await rl.question(`${question} [1-${choices.length}] `)).trim());
      if (Number.isInteger(n) && n >= 1 && n <= choices.length) return n - 1;
    }
  } finally {
    rl.close();
  }
}

/** npm's own script, found next to node (no shell, so the same on Windows). */
function npmCli() {
  const nodeDir = dirname(process.execPath);
  const candidates = [
    process.env.npm_execpath,
    join(nodeDir, "node_modules", "npm", "bin", "npm-cli.js"),
    join(nodeDir, "..", "lib", "node_modules", "npm", "bin", "npm-cli.js"),
  ];
  return candidates.find((file) => file && /npm-cli\.js$/.test(file) && existsSync(file));
}

async function ensureDependencies() {
  if (hasConvexCli()) return;
  const npm = npmCli();
  if (!npm) throw new Error(`Install the backend's dependencies first: cd ${BACKEND_DIR} && npm ci --ignore-scripts`);
  log("Installing the backend's dependencies from the lockfile (npm ci --ignore-scripts)…");
  await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [npm, "ci", "--ignore-scripts"], { cwd: BACKEND_DIR, stdio: ["ignore", 2, "inherit"] });
    child.on("error", reject);
    child.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`npm ci failed (exit ${code})`))));
  });
}

const target = (envFile) => ["--env-file", envFile];

async function readEnv(where) {
  const { stdout } = await convex(commands.envNames(where));
  const names = stdout.split(/\r?\n/).map((line) => line.trim()).filter((line) => /^[A-Z_][A-Z0-9_]*$/.test(line));
  const value = async (name) => (names.includes(name) ? (await convex(commands.envGet(where, name))).stdout.trim() : null);
  return { names, issuer: await value("HELM_JWT_ISSUER"), jwks: await value("HELM_JWKS") };
}

/** Sets a variable with its value on stdin, never on the command line. */
const setEnv = (where, name, value, secrets = []) => convex(commands.envSet(where, name), { input: value, secrets });

/** The signing key and HELM_* variables; returns the issuer in force and what was done with the keys. */
async function configureEnv(where, dir, wantedIssuer) {
  const signing = await loadOrCreateSigningKey(dir);
  const secret = JSON.stringify(signing.privateJwk);
  const plan = envPlan(await readEnv(where), { issuer: wantedIssuer, privateJwk: signing.privateJwk });
  let issuer = wantedIssuer;
  if (plan.issuer === "set") await setEnv(where, "HELM_JWT_ISSUER", issuer);
  if (plan.issuer === "adopt") {
    issuer = (await readEnv(where)).issuer;
    log(`HELM_JWT_ISSUER is already ${issuer}; keeping it (it is part of the user id, so a new one would hide the data).`);
  }
  let keys = plan.keys;
  if (keys === "differs") {
    const replace = await confirm(
      `The deployment already has another app-signing key. Replace it with ${signing.file}? ` +
        "Paired phones stay paired and fetch new tokens; tokens signed with the old key stop working.",
    );
    keys = replace ? "replaced" : "kept";
    if (!replace) log("Keeping the deployment's key. If pairing then fails with 503, see docs/deploy.md.");
  }
  if (keys === "set" || keys === "replaced") await setEnv(where, "HELM_JWKS", signing.jwksDataUri);
  if (keys === "set" || keys === "replaced" || keys === "complete") {
    await setEnv(where, "HELM_JWT_PRIVATE_JWK", secret, [secret, signing.privateJwk.d]);
  }
  return { issuer, issuerAction: plan.issuer, keys, signingKeyFile: signing.file };
}

/** A working CLI key: the saved one while the server accepts it, else a new one. */
async function cliKey(where, dir, checkUrl, userId) {
  const file = join(dir, FILES.cliKey);
  if (existsSync(file)) {
    const saved = readFileSync(file, "utf8").trim();
    try {
      await checkMcp(checkUrl, saved);
      return { key: saved, file, created: false };
    } catch (error) {
      if (error.status !== 401) throw error;
      log("The saved CLI key no longer works; making a new one.");
    }
  }
  const { stdout } = await convex(commands.run(where, "apiKeys:create", { userId, actor: "app", name: "hlm", kind: "cli" }));
  const key = parseRunOutput(stdout, "apiKeys:create").key;
  if (typeof key !== "string" || !key.startsWith("helm_")) throw new Error("apiKeys:create did not return a key");
  writePrivate(file, `${key}\n`);
  return { key, file, created: true };
}

/** Everything after the deployment is known: variables, deploy, checks, the CLI key, a pairing code. */
async function finish({ dir, envFile, wantedIssuer, siteUrl, checkUrl, convexUrl, mode, deployment, state }) {
  const where = target(envFile);
  log("Setting the app-signing key and HELM_* variables…");
  const env = await configureEnv(where, dir, wantedIssuer);
  const userId = `${env.issuer}|${SUBJECT}`;
  writeState(dir, { ...state, mode, deployment, url: siteUrl, convexUrl, issuer: env.issuer, userId, updatedAt: new Date().toISOString() });
  log("Deploying the backend…");
  await convex(commands.deploy(envFile), { show: true });
  log("Checking the server…");
  const openapi = await checkOpenApi(checkUrl);
  await checkSigning(checkUrl);
  const key = await cliKey(where, dir, checkUrl, userId);
  const server = await checkMcp(checkUrl, key.key);
  const pairing = parseRunOutput((await convex(commands.run(where, "devices:createPairingCode", { userId, actor: "app" }))).stdout, "devices:createPairingCode");
  return {
    mode,
    url: siteUrl,
    convexUrl,
    deployment: deployment ?? null,
    issuer: env.issuer,
    userId,
    server: { name: server.name, version: server.version, openapi },
    pairing: { code: pairing.code, expiresAt: pairing.expiresAt, link: pairingLink(siteUrl, pairing.code) },
    key: { file: key.file, created: key.created },
    env: { issuer: env.issuerAction, keys: env.keys },
    files: { dir, state: join(dir, FILES.state), signingKey: env.signingKeyFile, cliKey: key.file },
  };
}

async function chooseTeam() {
  const { stdout, stderr } = await convex(commands.loginStatus());
  const teams = parseTeams(`${stdout}\n${stderr}`);
  if (teams.length === 1) return teams[0].slug;
  if (teams.length === 0) throw new Error("Your Convex account has no team yet: open https://dashboard.convex.dev once, then run this again");
  const list = teams.map((team) => `${team.name} (${team.slug})`);
  if (!process.stdin.isTTY) throw new UsageError(`You are in several Convex teams; choose one with --team: ${teams.map((t) => t.slug).join(", ")}`);
  return teams[await choose("Which Convex team?", list)].slug;
}

/** A new project and its default production deployment; saved at once so a second run reuses them. */
async function createDeployment(options, dir, state) {
  let { team, project } = state ?? {};
  if (!project) {
    team = options.team ?? (await chooseTeam());
    log(`Creating the Convex project "${options.project}" in team ${team}…`);
    const made = await convex(commands.projectCreate(options.project, team));
    project = parseProjectSlug(`${made.stderr}\n${made.stdout}`);
    if (!project) {
      throw new Error(
        "The Convex CLI did not say which project it created. Create a production deployment in the dashboard " +
          "(https://dashboard.convex.dev) and run this again with --deployment <its name>.",
      );
    }
    writeState(dir, { mode: "cloud", team, project, createdAt: new Date().toISOString() });
  }
  const selector = ["--deployment", `${team}:${project}:prod`];
  try {
    return { team, project, urls: await readUrls(selector) };
  } catch {
    log(`Creating the production deployment of ${team}:${project}…`);
    await convex(commands.deploymentCreate(team, project), { show: true });
    return { team, project, urls: await readUrls(selector) };
  }
}

const readUrls = async (where) => deploymentUrls(parseRunOutput((await convex(commands.urls(where))).stdout, "the deployment"));

async function setupCloud(options, dir) {
  ensurePrivateDir(dir);
  const state = readState(dir);
  if (state?.deployment && options.deployment && state.deployment !== options.deployment) {
    throw new UsageError(`${dir} belongs to ${state.deployment}; set HELM_SERVER_CONFIG_DIR to another folder for a second server`);
  }
  log("Logging in to Convex (a browser opens the first time)…");
  await convex(commands.login(), { interactive: true });
  const envFile = join(dir, FILES.convexEnv);
  let deployment = state?.deployment ?? options.deployment;
  let next = state ?? {};
  let urls;
  if (deployment) {
    writePrivate(envFile, envFileText({ CONVEX_DEPLOYMENT: `prod:${deployment}` }));
    urls = await readUrls(target(envFile));
  } else {
    const made = await createDeployment(options, dir, state);
    urls = made.urls;
    deployment = urls.name;
    next = { ...readState(dir), team: made.team, project: made.project };
    writePrivate(envFile, envFileText({ CONVEX_DEPLOYMENT: `prod:${deployment}` }));
  }
  const wantedIssuer = state?.issuer ?? options.issuer ?? urls.siteUrl;
  writeState(dir, { mode: "cloud", ...next, deployment, url: urls.siteUrl, convexUrl: urls.cloudUrl, createdAt: next.createdAt ?? new Date().toISOString() });
  const result = await finish({
    dir,
    envFile,
    wantedIssuer,
    siteUrl: urls.siteUrl,
    checkUrl: urls.siteUrl,
    convexUrl: urls.cloudUrl,
    mode: "cloud",
    deployment,
    state: readState(dir),
  });
  return { ...result, running: false };
}

function portFree(port) {
  return new Promise((resolve) => {
    const server = createServer();
    server.once("error", () => resolve(false));
    server.listen(port, "127.0.0.1", () => server.close(() => resolve(true)));
  });
}

const LOCAL_PLATFORMS = ["darwin-arm64", "darwin-x64", "linux-arm64", "linux-x64"];

async function setupLocal(options, dir) {
  const platform = `${process.platform}-${process.arch}`;
  if (!LOCAL_PLATFORMS.includes(platform)) {
    throw new UsageError(`--local needs macOS or Linux on x64 or arm64 (this is ${platform}); run the setup without --local to use a free Convex account`);
  }
  for (const port of [options.port, options.sitePort]) {
    if (!(await portFree(port))) throw new UsageError(`Port ${port} is in use (is npm run backend:start running?); stop it or choose --port and --site-port`);
  }
  ensurePrivateDir(dir);
  const state = readState(dir);
  const secretFile = join(dir, FILES.instanceSecret);
  if (!existsSync(secretFile)) writePrivate(secretFile, JSON.stringify(newInstanceSecret()));
  log("Starting the Convex local backend…");
  const backend = await startLocalBackend({
    dataDir: join(dir, FILES.data),
    port: options.port,
    sitePort: options.sitePort,
    instanceName: "helm-local",
    instanceSecret: JSON.parse(readFileSync(secretFile, "utf8")),
    convexOrigin: options.publicApiUrl,
    convexSite: options.publicUrl,
  });
  try {
    const envFile = join(dir, FILES.convexEnv);
    writePrivate(envFile, envFileText({ CONVEX_SELF_HOSTED_URL: backend.url, CONVEX_SELF_HOSTED_ADMIN_KEY: backend.adminKey }));
    const result = await finish({
      dir,
      envFile,
      wantedIssuer: state?.issuer ?? LOCAL_ISSUER,
      siteUrl: options.publicUrl ?? backend.siteUrl,
      checkUrl: backend.siteUrl,
      convexUrl: options.publicApiUrl ?? backend.url,
      mode: "local",
      deployment: null,
      state: { createdAt: new Date().toISOString(), ...state },
    });
    return { ...result, running: true, local: { url: backend.siteUrl, convexUrl: backend.url }, stop: backend.stop };
  } catch (error) {
    await backend.stop();
    throw error;
  }
}

async function main() {
  const options = parseOptions(process.argv.slice(2));
  if (options.help) return console.log(USAGE);
  const problem = nodeProblem();
  if (problem) throw new UsageError(problem);
  const dir = serverDir(configDir(), options.local);
  if (options.dryRun) {
    const plan = dryRunPlan(options, dir, { state: readState(dir), dependencies: hasConvexCli() });
    if (options.json) console.log(JSON.stringify({ dryRun: true, mode: options.local ? "local" : "cloud", plan }));
    else console.log(["Would do (nothing changes, nothing goes over the network):", ...plan.map((step, i) => `  ${i + 1}. ${step}`)].join("\n"));
    return;
  }
  await ensureDependencies();
  const { stop, ...result } = options.local ? await setupLocal(options, dir) : await setupCloud(options, dir);
  if (options.json) console.log(JSON.stringify(result));
  else console.log(await humanSummary(result));
  if (!stop) return;
  log("The server runs until Ctrl+C. The same command starts it again; data and keys are kept.");
  const quit = async () => {
    await stop();
    process.exit(0);
  };
  process.on("SIGINT", quit);
  process.on("SIGTERM", quit);
}

main().catch((error) => {
  log(error instanceof UsageError ? error.message : `Setup failed: ${error.message}`);
  process.exit(error instanceof UsageError ? 2 : 1);
});
