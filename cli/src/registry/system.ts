// Everything that is not a task verb: settings, export, schema introspection,
// the raw `call` escape hatch, version and phone devices.
import { writeFile } from "node:fs/promises";
import qrcode from "qrcode-terminal";
import { CliError, usageError } from "../core/exit.js";
import { readStdin } from "../core/io.js";
import { CLI_VERSION, isCompatible, MIN_SERVER_VERSION } from "../core/version.js";
import type { Device } from "../render/model.js";
import { tool, userTimezone } from "./ops.js";
import { parseSettings } from "./parse.js";
import type { CommandSpec, Outcome, RunContext } from "./types.js";

const showSettings = async (ctx: RunContext): Promise<Outcome> => {
  const value = await tool(ctx, "get_settings");
  return { value, view: { kind: "pairs", pairs: Object.entries(value) } };
};

const listDevices = async (ctx: RunContext): Promise<Outcome> => {
  const [value, timezone] = await Promise.all([(await ctx.client()).request("GET", "/devices"), userTimezone(ctx)]);
  return { value, view: { kind: "devices", devices: value.devices as Device[], timezone } };
};

const revokeDevice = async (ctx: RunContext, deviceId: string): Promise<Outcome> => {
  const value = await (await ctx.client()).request("POST", "/devices/revoke", { deviceId });
  const text = `Revoked ${value.id}: it gets no new app tokens; its current one expires within an hour`;
  return { value, view: { kind: "text", text } };
};

const DEVICE_ID = { name: "deviceId", description: "Device id from hlm device list", required: true };

export const systemCommands: CommandSpec[] = [
  {
    name: "settings", schema: "settings.schema.json",
    summary: "Show settings (time zone, morning summary time, default reminders)",
    tools: ["get_settings"],
    fields: "settings",
    examples: ["hlm settings", "hlm settings --json"],
    run: showSettings,
    subcommands: [
      { name: "get", schema: "settings.schema.json", summary: "Show settings", tools: ["get_settings"], fields: "settings", examples: ["hlm settings get --fields timezone"], run: showSettings },
      {
        name: "set", schema: "settings.schema.json",
        summary: "Change settings: timezone, summaryTime (summary-time), defaultReminderMinutes (reminders)",
        args: [{ name: "pairs", description: "key=value pairs", required: true, variadic: true }],
        tools: ["update_settings"],
        fields: "settings",
        examples: ["hlm settings set timezone=Europe/London summary-time=05:00", "hlm settings set reminders=0,15"],
        run: async (ctx, args) => {
          const input = { ...parseSettings(args.pairs as string[]), clientId: ctx.clientId() };
          const value = await tool(ctx, "update_settings", input);
          return { value, view: { kind: "pairs", pairs: Object.entries(value) } };
        },
      },
    ],
  },
  {
    name: "export", schema: "export.schema.json",
    summary: "Export the whole plan as Markdown or JSON (with history)",
    options: [
      { flags: "--format <format>", description: "md or json (default: md, or json with --json)", choices: ["md", "markdown", "json"] },
      { flags: "-o, --output <file>", description: "Write to a file instead of stdout" },
    ],
    tools: ["export_plan"],
    examples: ["hlm export > plan.md", "hlm export --format json -o helm.json", "hlm export --json"],
    run: async (ctx, _args, opts) => {
      const format = opts.format === undefined ? (ctx.format === "json" ? "json" : "markdown") : opts.format === "json" ? "json" : "markdown";
      const result = await (await ctx.client()).callTool("export_plan", { format });
      // A Markdown export has no structured content; its JSON is { format, content } like the JSON export.
      const value = result.structured ?? { format: "markdown", content: result.text };
      const text = format === "json" ? JSON.stringify((value as { content: unknown }).content, null, 2) : result.text;
      if (opts.output) {
        await writeFile(opts.output as string, ctx.format === "json" ? JSON.stringify(value) : text + "\n");
        return { value: { written: opts.output, format }, view: { kind: "text", text: `Wrote ${opts.output}` } };
      }
      return { value, view: { kind: "text", text } };
    },
  },
  {
    name: "tools", schema: ["tools.schema.json", "tool.schema.json"],
    summary: "MCP tools and their input schemas (introspection)",
    args: [{ name: "name", description: "One tool, to print its schema" }],
    tools: ["tools/list"],
    examples: ["hlm tools", "hlm tools update_task --json"],
    run: async (ctx, args) => {
      const tools = await (await ctx.client()).listTools();
      const name = args.name as string | undefined;
      if (!name) {
        const width = Math.max(...tools.map((t) => t.name.length));
        const text = tools.map((t) => `${t.name.padEnd(width)}  ${t.description}`).join("\n");
        return { value: { tools }, view: { kind: "text", text } };
      }
      const found = tools.find((t) => t.name === name);
      if (!found) throw usageError("Unknown tool", { valid: tools.map((t) => t.name) });
      const text = `${found.name}: ${found.description}\n\nInput schema:\n${JSON.stringify(found.inputSchema, null, 2)}`;
      return { value: found, view: { kind: "text", text } };
    },
  },
  {
    name: "call",
    summary: "Call an MCP tool with JSON arguments, exactly as an MCP client would",
    description:
      "Prints the tool's structuredContent (or, for a Markdown export, its text). Errors and exit codes are the same as for the other commands.",
    args: [
      { name: "tool", description: "Tool name (see hlm tools)", required: true },
      { name: "json", description: "Arguments as a JSON object, or - to read them from stdin (default {})" },
    ],
    tools: ["*"],
    examples: [`hlm call get_task '{"taskId":"#42"}'`, `echo '{"format":"json"}' | hlm call export_plan -`],
    run: async (ctx, args) => {
      const raw = args.json === "-" ? await readStdin(ctx.io.stdin) : ((args.json as string | undefined) ?? "{}");
      let input: unknown;
      try {
        input = JSON.parse(raw);
      } catch {
        throw usageError("The arguments are not valid JSON");
      }
      if (typeof input !== "object" || input === null || Array.isArray(input)) throw usageError("The arguments must be a JSON object");
      const toolArgs = input as Record<string, unknown>;
      const result = await (await ctx.client())
        .callTool(args.tool as string, toolArgs)
        .catch((error: unknown) => {
          // A clientId in the arguments is reported like the other commands' own.
          throw error instanceof CliError && typeof toolArgs.clientId === "string" ? error.with({ clientId: toolArgs.clientId }) : error;
        });
      // A Markdown export reads as Markdown; with --json it is {format, content} (backend 0.4.0).
      if (result.structured?.format === "markdown") return { value: result.structured, view: { kind: "text", text: result.text } };
      if (result.structured) return { value: result.structured, view: { kind: "json" } };
      return { value: { content: result.content }, view: { kind: "text", text: result.text } };
    },
  },
  {
    name: "version", schema: "version.schema.json",
    summary: "CLI and server versions, and whether they are compatible",
    tools: ["initialize"],
    examples: ["hlm version --json", "hlm --version"],
    run: async (ctx) => {
      const server = await (await ctx.client()).initialize();
      const compatible = isCompatible(server.version);
      const value = { cli: CLI_VERSION, server, minServerVersion: MIN_SERVER_VERSION, compatible };
      const warning = compatible ? "" : `\nwarning: hlm ${CLI_VERSION} expects backend ${MIN_SERVER_VERSION} or a later version with the same major number`;
      return { value, view: { kind: "text", text: `hlm ${CLI_VERSION}\nserver ${server.name} ${server.version}${warning}` } };
    },
  },
  {
    name: "pair", schema: "pairing.schema.json",
    summary: "One-time code (10 minutes) that signs the phone app in as you",
    options: [{ flags: "--no-qr", description: "Do not draw the QR code" }],
    tools: ["/devices/pairing-code"],
    examples: ["hlm pair", "hlm pair --json"],
    run: async (ctx, _args, opts) => {
      const client = await ctx.client();
      const created = await client.request("POST", "/devices/pairing-code");
      const link = `helm://pair?url=${encodeURIComponent(client.baseUrl)}&code=${created.code}`;
      let text = `Pairing code (single use, valid 10 minutes):\n  ${created.code}\n\nOn the phone, scan the QR code or open:\n  ${link}`;
      if (opts.qr !== false && ctx.format === "human") {
        text += "\n" + (await new Promise<string>((resolve) => qrcode.generate(link, { small: true }, resolve)));
      }
      return { value: { ...created, link }, view: { kind: "text", text } };
    },
  },
  {
    name: "device",
    schema: "devices.schema.json",
    summary: "Paired phones (same as hlm device list); revoke one with hlm device revoke",
    tools: ["/devices"],
    examples: ["hlm device", "hlm device revoke <deviceId>"],
    run: listDevices,
    subcommands: [
      { name: "list", schema: "devices.schema.json", aliases: ["ls"], summary: "Paired phones", tools: ["/devices"], examples: ["hlm device list"], run: listDevices },
      {
        name: "revoke", schema: "device-revoke.schema.json",
        summary: "Sign a phone out: it gets no new app tokens",
        args: [DEVICE_ID],
        tools: ["/devices/revoke"],
        examples: ["hlm device revoke <deviceId>"],
        run: (ctx, args) => revokeDevice(ctx, args.deviceId as string),
      },
    ],
  },
  { name: "devices", schema: "devices.schema.json", summary: "Same as hlm device list", tools: ["/devices"], examples: ["hlm devices"], run: listDevices },
  {
    name: "revoke",
    schema: "device-revoke.schema.json",
    summary: "Same as hlm device revoke",
    args: [DEVICE_ID],
    tools: ["/devices/revoke"],
    examples: ["hlm revoke <deviceId>"],
    run: (ctx, args) => revokeDevice(ctx, args.deviceId as string),
  },
];

