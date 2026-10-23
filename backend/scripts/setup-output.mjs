// What `npm run setup` (scripts/setup.mjs) prints: the plan of --dry-run and
// the summary at the end. Neither ever contains a secret: keys are named by
// the file that holds them.
import { existsSync } from "node:fs";
import { join } from "node:path";
import { commands } from "./setup-convex.mjs";
import { FILES, LOCAL_ISSUER } from "./setup-lib.mjs";

const npx = (args) => `npx convex ${args.map((arg) => (/^[\w:./=@-]+$/.test(arg) ? arg : JSON.stringify(arg))).join(" ")}`;

/** The steps a run would take, from the options and the files already in `dir`; reads nothing else. */
export function dryRunPlan(options, dir, { state, dependencies }) {
  const envFile = join(dir, FILES.convexEnv);
  const where = ["--env-file", envFile];
  const keyFile = join(dir, FILES.signingKey);
  const cliKeyFile = join(dir, FILES.cliKey);
  const issuer = state?.issuer ?? (options.local ? LOCAL_ISSUER : options.issuer ?? "https://<deployment>.convex.site, the server's address");
  const userId = `${state?.issuer ?? (options.local ? LOCAL_ISSUER : "<issuer>")}|owner`;
  const steps = [];
  if (!dependencies) steps.push("install the backend's dependencies: npm ci --ignore-scripts (in backend/)");
  if (options.local) {
    steps.push(`start the Convex local backend on 127.0.0.1:${options.port} and :${options.sitePort}, data in ${join(dir, FILES.data)}`);
    if (options.publicUrl) steps.push(`announce ${options.publicUrl} (HTTP actions) and ${options.publicApiUrl} (Convex API) to clients`);
    steps.push(`write the backend's admin key to ${envFile} (mode 600)`);
  } else {
    steps.push(`log in to Convex in the browser (only the first time): ${npx(commands.login())}`);
    const deployment = state?.deployment ?? options.deployment;
    if (deployment) {
      steps.push(`use the deployment ${deployment} (${state?.deployment ? "saved in" : "named by --deployment, saved to"} ${join(dir, FILES.state)})`);
    } else {
      const team = options.team ?? "<your team>";
      if (!options.team) steps.push(`find your team: ${npx(commands.loginStatus())} (asks when you have several)`);
      steps.push(`create the project: ${npx(commands.projectCreate(options.project, team))}`);
      steps.push(`create its production deployment: ${npx(commands.deploymentCreate(team, "<project>"))}`);
    }
    steps.push(`read the deployment's address: ${npx(commands.urls(where))}`);
  }
  steps.push(
    existsSync(keyFile)
      ? `reuse the app-signing key ${keyFile}`
      : `generate an ES256 app-signing key into ${keyFile} (mode 600)`,
  );
  steps.push(
    `set HELM_JWT_ISSUER (${issuer}), HELM_JWKS and HELM_JWT_PRIVATE_JWK where the deployment has none, ` +
      `values on stdin (${npx(commands.envSet(where, "<name>"))}); a different key is replaced only after a question, the issuer never`,
  );
  steps.push(`deploy the backend: ${npx(commands.deploy(envFile))}`);
  steps.push("check GET /api/v1/openapi.json (200), POST /auth/token (401, so signing works) and POST /mcp (initialize)");
  steps.push(
    existsSync(cliKeyFile)
      ? `keep the CLI key in ${cliKeyFile} while the server accepts it`
      : `create a CLI key into ${cliKeyFile} (mode 600): ${npx(commands.run(where, "apiKeys:create", { userId, actor: "app", name: "hlm", kind: "cli" }))}`,
  );
  steps.push(`make a pairing code for the phone: ${npx(commands.run(where, "devices:createPairingCode", { userId, actor: "app" }))}`);
  if (options.local) steps.push("keep running until Ctrl+C");
  return steps;
}

async function qrCode(text) {
  try {
    const { default: qrcode } = await import("qrcode-terminal");
    return await new Promise((resolve) => qrcode.generate(text, { small: true }, resolve));
  } catch {
    return "";
  }
}

const time = (ms) => new Date(ms).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

/** The summary for people: where the server is, the pairing code, where the keys are, what next. */
export async function humanSummary(result) {
  const { url, pairing, files, key, server } = result;
  const local = result.mode === "local";
  const lines = [
    "",
    `Helm is ready: ${url} (${server.name} ${server.version})`,
    "",
    `Pair the phone (code valid until ${time(pairing.expiresAt)}, once):`,
    await qrCode(pairing.link),
    `  Server address  ${url}`,
    `  Pairing code    ${pairing.code}`,
    `  Or open         ${pairing.link}`,
    "",
    `Kept only on this computer, readable only by you (${files.dir}):`,
    `  ${FILES.cliKey.padEnd(17)} API key for hlm, kind cli (${key.created ? "new" : "kept"})`,
    `  ${FILES.signingKey.padEnd(17)} copy of the key that signs the app's tokens (a password manager is a good home)`,
    `  ${FILES.state.padEnd(17)} address and settings, no secrets`,
    "",
    "Next:",
    `  hlm      hlm login --url ${url} --with-key < "${files.cliKey}"`,
    "           (no hlm yet: cd cli && npm ci --ignore-scripts && npm run build && npm link)",
    ...(local
      ? [
          `  Claude   Claude Code: an agent key (hlm key create claude --scope write) as the`,
          `           Authorization header of ${url}/mcp (docs/mcp.md); the Claude apps need the cloud setup`,
        ]
      : [
          `  Claude   Claude app: Settings → Connectors → Add custom connector, ${url}/mcp (docs/oauth.md)`,
          `           Claude Code: claude mcp add --transport http helm ${url}/mcp, then /mcp to sign in`,
          "           Either way you approve the connection on the paired phone.",
        ]),
    `  Update   run the same command again; another phone: hlm pair`,
  ];
  if (local && !url.startsWith("https://")) {
    lines.push("", "  A release build of the app needs HTTPS: see “Phone and computer” in docs/deploy.md (Tailscale).");
  }
  return lines.join("\n");
}
