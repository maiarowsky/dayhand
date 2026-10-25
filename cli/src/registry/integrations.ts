// Integrations over the REST API (docs/api.md, backend 0.8.0): API keys with a
// scope and an expiry for other tools, webhooks (docs/webhooks.md), and
// importing a plan from Dayhand JSON, iCalendar or Todoist CSV. Each command is
// one /api/v1 request with the stored key, which must have scope full.
import { readFile } from "node:fs/promises";
import { usageError } from "../core/exit.js";
import { readStdin } from "../core/io.js";
import { requireProjects } from "../projects.js";
import { formatTimestamp } from "../render/format.js";
import type { CommandSpec, Outcome, RunContext } from "./types.js";

const API = "/api/v1";
const NEEDS = "Needs backend 0.8.0 or later and a key with scope full (dayhand version, dayhand key list).";
const DAY_MS = 24 * 60 * 60 * 1000;

type Key = { id: string; name: string; kind: string; scope: string; createdAt: number; expiresAt: number | null; revokedAt: number | null; createdWith: string | null };
type Webhook = {
  id: string;
  url: string;
  events: string[];
  description: string | null;
  enabled: boolean;
  disabledReason: string | null;
  failureStreak: number;
  lastSuccessAt: number | null;
};
type Delivery = { id: string; eventId: string; type: string; status: string; createdAt: number; attempts: { at: number; responseStatus: number | null; error: string | null }[] };

const api = async (ctx: RunContext, method: "GET" | "POST" | "DELETE", path: string, body?: unknown) =>
  (await ctx.client()).request(method, API + path, body);

const when = (ms: number | null, none = "never") => (ms === null ? none : formatTimestamp(ms));

/** "90d", "12w", "1y", "2027-01-31" (the start of that day, UTC) or "never", as Unix milliseconds or null. */
export function parseExpiry(text: string, now = Date.now()): number | null {
  const value = text.trim().toLowerCase();
  if (value === "never") return null;
  const span = /^(\d{1,4})([dwy])$/.exec(value);
  if (span) {
    const days = Number(span[1]) * { d: 1, w: 7, y: 365 }[span[2] as "d" | "w" | "y"];
    if (days > 0) return now + days * DAY_MS;
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const at = Date.parse(`${value}T00:00:00Z`);
    if (Number.isFinite(at) && at > now) return at;
  }
  throw usageError(`--expires must be like 90d, 12w, 1y, a future YYYY-MM-DD or never, got "${text}"`);
}

/** Changes that break something for good ask first; --yes skips the question, and without a terminal it is required. */
async function confirm(ctx: RunContext, question: string, refusal: string): Promise<void> {
  if (ctx.yes || ctx.dryRun) return;
  if (!ctx.interactive) throw usageError(`Refusing without --yes: ${refusal}`, { hint: "add --yes" });
  if (!(await ctx.confirm(question))) throw usageError("Cancelled; nothing was changed");
}

// ---- Keys ----

function keyLine(key: Key): string {
  const state = key.revokedAt !== null ? "revoked" : key.expiresAt !== null && key.expiresAt <= Date.now() ? "expired" : "active";
  return `${key.id}  ${key.name}  ${key.kind}/${key.scope}  ${state}  expires ${when(key.expiresAt)}`;
}

const listKeys = async (ctx: RunContext): Promise<Outcome> => {
  const value = await api(ctx, "GET", "/keys");
  const keys = value.keys as Key[];
  const text = keys.length ? keys.map(keyLine).join("\n") : "No API keys.";
  return { value, view: { kind: "text", text } };
};

const KEY_ID = { name: "keyId", description: "Key id from dayhand key list", required: true };

const keyCommand: CommandSpec = {
  name: "key",
  schema: "api-key-list.schema.json",
  summary: "API keys for integrations: list, create with a scope and an expiry, revoke (same as dayhand key list)",
  description:
    "A key made here reads (scope read) or also changes tasks and settings (scope write), never more; it expires no later than the key that makes it " +
    `and stops working when that key is revoked. ${NEEDS}`,
  tools: ["/api/v1/keys"],
  examples: ["dayhand key list", "dayhand key create n8n --scope read --expires 90d", "dayhand key revoke <keyId> --yes"],
  run: listKeys,
  subcommands: [
    { name: "list", schema: "api-key-list.schema.json", summary: "Every API key with its kind, scope and expiry (never the key itself)", tools: ["/api/v1/keys"], examples: ["dayhand key list --json"], run: listKeys },
    {
      name: "create",
      schema: "api-key-created.schema.json",
      summary: "Create a key (printed once) that reads or writes, for an integration",
      args: [{ name: "name", description: "What the key is for, shown in history (e.g. n8n)", required: true }],
      options: [
        { flags: "--scope <scope>", description: "read (default) or write", choices: ["read", "write"] },
        { flags: "--kind <kind>", description: "agent (default) or cli: the actor of its changes", choices: ["agent", "cli"] },
        { flags: "--expires <when>", description: "90d (default), 12w, 1y, a date YYYY-MM-DD or never" },
      ],
      tools: ["/api/v1/keys"],
      examples: ["dayhand key create n8n", "dayhand key create shortcuts --scope write --expires 1y", "dayhand key create backup --expires never --json"],
      run: async (ctx, args, opts) => {
        const expiresAt = parseExpiry((opts.expires as string | undefined) ?? "90d");
        const body = {
          name: args.name,
          scope: (opts.scope as string | undefined) ?? "read",
          ...(opts.kind ? { kind: opts.kind } : {}),
          ...(expiresAt !== null ? { expiresAt } : {}),
        };
        const value = await api(ctx, "POST", "/keys", body);
        if (ctx.dryRun) return { value, view: { kind: "text", text: "" } };
        const text = [
          `Created ${value.name} (${value.kind}, scope ${value.scope}, expires ${when(value.expiresAt)}). Store the key now; it is not shown again:`,
          `  ${value.key}`,
        ].join("\n");
        return { value, view: { kind: "text", text } };
      },
    },
    {
      name: "revoke",
      schema: "api-key-revoke.schema.json",
      summary: "Revoke a key; the keys it created stop working too",
      args: [KEY_ID],
      tools: ["/api/v1/keys"],
      examples: ["dayhand key revoke <keyId> --yes"],
      run: async (ctx, args) => {
        await confirm(ctx, "Revoke this key? Whatever uses it stops working.", "revoking a key");
        const value = await api(ctx, "DELETE", `/keys/${encodeURIComponent(args.keyId as string)}`);
        return { value, view: { kind: "text", text: `Revoked ${args.keyId}; it and the keys it created stop working now` } };
      },
    },
  ],
};

// ---- Webhooks ----

function webhookLine(hook: Webhook): string {
  const state = hook.enabled ? "on" : `OFF: ${hook.disabledReason ?? "turned off"}`;
  const lines = [`${hook.id}  ${hook.url}  ${state}`, `    events: ${hook.events.join(", ")}`];
  if (hook.description) lines.push(`    ${hook.description}`);
  if (hook.failureStreak > 0) lines.push(`    ${hook.failureStreak} failed deliveries in a row`);
  return lines.join("\n");
}

const listWebhooks = async (ctx: RunContext): Promise<Outcome> => {
  const value = await api(ctx, "GET", "/webhooks");
  const hooks = value.webhooks as Webhook[];
  return { value, view: { kind: "text", text: hooks.length ? hooks.map(webhookLine).join("\n") : "No webhooks." } };
};

const WEBHOOK_ID = { name: "webhookId", description: "Webhook id from dayhand webhook list", required: true };
const EVENTS = ["task.created", "task.updated", "task.completed", "task.deleted", "task.restored", "now.changed"];
const hookPath = (args: Record<string, unknown>, rest = "") => `/webhooks/${encodeURIComponent(args.webhookId as string)}${rest}`;

function deliveryLine(delivery: Delivery): string {
  const attempts = delivery.attempts.map((a) => a.responseStatus ?? a.error ?? "?").join(", ");
  return `${formatTimestamp(delivery.createdAt)}  ${delivery.type}  ${delivery.status}  ${delivery.eventId}  attempts: ${attempts || "none yet"}`;
}

const webhookCommand: CommandSpec = {
  name: "webhook",
  schema: "webhook-list.schema.json",
  summary: "Webhooks: HTTPS addresses that get a signed message for every task change (same as dayhand webhook list)",
  description: `Messages follow Standard Webhooks (webhook-id, webhook-timestamp, webhook-signature); see docs/webhooks.md. ${NEEDS}`,
  tools: ["/api/v1/webhooks"],
  examples: ["dayhand webhook list", "dayhand webhook add https://n8n.example.com/webhook/dayhand --event task.completed", "dayhand webhook deliveries <webhookId>"],
  run: listWebhooks,
  subcommands: [
    { name: "list", schema: "webhook-list.schema.json", summary: "Every webhook, whether it is on, and why it was turned off", tools: ["/api/v1/webhooks"], examples: ["dayhand webhook list --json"], run: listWebhooks },
    {
      name: "add",
      schema: "webhook-created.schema.json",
      summary: "Add a webhook; prints its signing secret once",
      args: [{ name: "url", description: "HTTPS address on a public host", required: true }],
      options: [
        { flags: "-e, --event <type>", description: `Event to send (repeatable; default all): ${EVENTS.join(", ")}`, kind: "list", choices: EVENTS },
        { flags: "-d, --description <text>", description: "What it is for" },
      ],
      tools: ["/api/v1/webhooks"],
      examples: ["dayhand webhook add https://hooks.example.com/dayhand", "dayhand webhook add https://n8n.example.com/webhook/x -e task.completed -e task.created -d n8n"],
      run: async (ctx, args, opts) => {
        const events = opts.event as string[] | undefined;
        const body = { url: args.url, ...(events?.length ? { events } : {}), ...(opts.description ? { description: opts.description } : {}) };
        const value = await api(ctx, "POST", "/webhooks", body);
        if (ctx.dryRun) return { value, view: { kind: "text", text: "" } };
        const text = [webhookLine(value.webhook), "", "Signing secret (shown only now; verify webhook-signature with it):", `  ${value.secret}`].join("\n");
        return { value, view: { kind: "text", text } };
      },
    },
    {
      name: "rm",
      schema: "webhook-delete.schema.json",
      summary: "Remove a webhook and its delivery log",
      args: [WEBHOOK_ID],
      tools: ["/api/v1/webhooks"],
      examples: ["dayhand webhook rm <webhookId> --yes"],
      run: async (ctx, args) => {
        await confirm(ctx, "Remove this webhook? Its receiver gets no more messages.", "removing a webhook");
        const value = await api(ctx, "DELETE", hookPath(args));
        return { value, view: { kind: "text", text: `Removed ${args.webhookId}` } };
      },
    },
    {
      name: "test",
      schema: "webhook-test.schema.json",
      summary: "Send a webhook.test message now (also to a webhook that is off)",
      args: [WEBHOOK_ID],
      tools: ["/api/v1/webhooks"],
      examples: ["dayhand webhook test <webhookId>", "dayhand webhook deliveries <webhookId>"],
      run: async (ctx, args) => {
        const value = await api(ctx, "POST", hookPath(args, "/test"));
        return { value, view: { kind: "text", text: `Queued ${value.eventId}; dayhand webhook deliveries ${args.webhookId} shows how it went` } };
      },
    },
    {
      name: "enable",
      schema: "webhook-one.schema.json",
      summary: "Turn a webhook back on after it was turned off for failing",
      args: [WEBHOOK_ID],
      tools: ["/api/v1/webhooks"],
      examples: ["dayhand webhook enable <webhookId>"],
      run: async (ctx, args) => {
        const value = await api(ctx, "POST", hookPath(args, "/enable"));
        return { value, view: { kind: "text", text: ctx.dryRun ? "" : webhookLine(value.webhook) } };
      },
    },
    {
      name: "deliveries",
      schema: "webhook-delivery-list.schema.json",
      summary: "The delivery log: newest first, each attempt's HTTP status or error",
      args: [WEBHOOK_ID],
      options: [{ flags: "-n, --limit <n>", description: "How many (1 to 200, default 50)", kind: "int" }],
      tools: ["/api/v1/webhooks"],
      examples: ["dayhand webhook deliveries <webhookId>", "dayhand webhook deliveries <webhookId> -n 5 --json"],
      run: async (ctx, args, opts) => {
        const query = opts.limit !== undefined ? `?limit=${opts.limit}` : "";
        const value = await api(ctx, "GET", hookPath(args, `/deliveries${query}`));
        const deliveries = value.deliveries as Delivery[];
        return { value, view: { kind: "text", text: deliveries.length ? deliveries.map(deliveryLine).join("\n") : "No deliveries yet." } };
      },
    },
  ],
};

// ---- Import ----

// helm-json is the old name of dayhand-json; the server still takes it.
const FORMATS = ["auto", "dayhand-json", "helm-json", "ics", "todoist-csv"];

const importCommand: CommandSpec = {
  name: "import",
  schema: "import-result.schema.json",
  summary: "Import tasks from Dayhand's JSON export, an iCalendar file or a Todoist CSV export",
  description:
    "Each task is checked like dayhand add; one that fails is listed and the rest are imported. Importing the same file again imports nothing twice. " +
    `--dry-run asks the server what would happen without storing anything. ${NEEDS}`,
  args: [{ name: "file", description: "The file, or - for stdin", required: true }],
  options: [
    { flags: "--format <format>", description: "auto (default), dayhand-json, ics or todoist-csv", choices: FORMATS },
    { flags: "--project <name>", description: "Destination for tasks without a project in the file; must exist (backend 0.13.0)" },
  ],
  tools: ["/api/v1/import"],
  examples: ["dayhand export --format json -o dayhand.json && dayhand import dayhand.json --dry-run", "dayhand import todoist.csv", "dayhand import calendar.ics --format ics --json"],
  run: async (ctx, args, opts) => {
    const file = args.file as string;
    const content = file === "-" ? await readStdin(ctx.io.stdin) : await readFile(file, "utf8").catch(() => {
      throw usageError(`Cannot read ${file}`);
    });
    if (opts.project !== undefined) await requireProjects(ctx);
    const body = { content, format: (opts.format as string | undefined) ?? "auto", ...(opts.project === undefined ? {} : { projectId: opts.project }) };
    const value = await api(ctx, "POST", `/import${ctx.dryRun ? "?dryRun=true" : ""}`, body);
    const lines = [
      `${value.dryRun ? "Dry run: nothing was stored. Would import" : "Imported"} ${value.created} of ${value.total} task(s) (${value.format}).`,
      ...(value.skipped as { title: string; reason: string }[]).map((s) => `  skipped: ${s.title} (${s.reason})`),
      ...(value.failed as { title: string; message: string }[]).map((f) => `  failed: ${f.title}: ${f.message}`),
      ...(value.warnings as string[]).map((w) => `  note: ${w}`),
    ];
    return { value, view: { kind: "text", text: lines.join("\n") } };
  },
};

export const integrationCommands: CommandSpec[] = [keyCommand, webhookCommand, importCommand];
