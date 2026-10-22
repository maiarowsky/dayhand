// Help text from the registry. The same tables go into docs/cli.md (docs.ts),
// so `--help` and the documentation cannot drift apart.
import type { CommandSpec } from "./registry/types.js";

export const EXIT_CODES: [number, string][] = [
  [0, "Success, including a change that was already applied (no-op)"],
  [1, "Other error (internal)"],
  [2, "Usage: unknown command or flag, bad value or date, --yes missing, broken config.toml"],
  [3, "Authentication: no key (hlm login or HLM_API_KEY), or a wrong or revoked one"],
  [4, "Not found: no such task (#n), device or now task"],
  [5, "Server unavailable (network, timeout, HTTP 5xx or 429): the change may have been applied; retry with the same --client-id"],
  [130, "Interrupted (Ctrl-C)"],
];

export const ENVIRONMENT: [string, string][] = [
  ["HLM_URL", "Deployment HTTP actions URL, e.g. https://<deployment>.convex.site (wins over config.toml)"],
  ["HLM_API_KEY", "API key; wins over the key stored by hlm login (give agents and CI their own, kind agent)"],
  ["HLM_PROFILE", "Profile from config.toml (--profile wins)"],
  ["HLM_FORMAT", "json, plain or human: default output format (flags win)"],
  ["HLM_NO_INPUT", "1 to never prompt"],
  ["HLM_CONFIG_DIR", "Folder of config.toml and credentials.json (default: the system's config folder)"],
  ["HLM_CACHE_DIR", "Folder of the completion cache (default: the system's cache folder)"],
  ["HLM_CREDENTIAL_STORE", "keychain or file: where hlm login keeps keys (default: keychain, else file)"],
  ["NO_COLOR, FORCE_COLOR", "Turn colors off or on when neither --color nor config.toml decides"],
  ["VISUAL, EDITOR", "Editor for hlm note <ref> and hlm edit <ref> on a terminal (default: vi, notepad on Windows)"],
  ["HELM_URL, HELM_API_KEY", "Old names, still read when the HLM_* name is unset (deprecated, with a warning)"],
];

const table = (rows: [string | number, string][]) => {
  const width = Math.max(...rows.map(([k]) => String(k).length));
  return rows.map(([k, v]) => `  ${String(k).padEnd(width)}  ${v}`).join("\n");
};

export const ROOT_HELP = `
Task references: #42 or 42 (the task number), now (the now task) or the task id.
Without a command, hlm shows Today. Dates: tomorrow, fri 14:00, in 3 days … (hlm help dates).
Help topics: hlm help dates | config | login | completion.

Output:
  --json prints exactly the MCP tool's structuredContent (schemas: docs/schemas);
  fields may be added, never removed or retyped within a major version.
  Errors with --json: one line {"error":{"code","message","exitCode","retryable","clientId",…}} on stderr.

Exit codes:
${table(EXIT_CODES)}

Environment:
${table(ENVIRONMENT)}
`;

export function commandHelp(spec: CommandSpec): string {
  const parts = [""];
  if (spec.description) parts.push(spec.description, "");
  if (spec.examples?.length) parts.push("Examples:", ...spec.examples.map((e) => `  ${e}`), "");
  const tools = spec.tools.filter((t) => t !== "*");
  if (tools.length) parts.push(`Calls: ${tools.join(", ")}`);
  return parts.join("\n");
}
