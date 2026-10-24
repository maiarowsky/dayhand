// Help text from the registry. The same tables go into docs/cli.md (docs.ts),
// so `--help` and the documentation cannot drift apart.
import type { CommandSpec } from "./registry/types.js";

export const EXIT_CODES: [number, string][] = [
  [0, "Success, including a change that was already applied (no-op)"],
  [1, "Other error (internal)"],
  [2, "Usage: unknown command or flag, bad value or date, --yes missing, broken config.toml"],
  [3, "Authentication: no key (dayhand login or DAYHAND_API_KEY), or a wrong or revoked one"],
  [4, "Not found: no such task (#n), device or now task"],
  [5, "Server unavailable (network, timeout, HTTP 5xx): the change may have been applied; retry with the same --client-id. Also too many calls with the key (rate_limited): nothing was applied; run it again after the wait the message names"],
  [6, "Refused by the task's state, nothing applied: another agent holds the task's claim (conflict), or its acceptance criteria are not met or the proof has no summary (precondition_failed)"],
  [7, "Refused by the owner, nothing applied: agents are paused (agents_paused), only the owner may do this or a tool policy denies it (forbidden), or the policy asks first (approval_required: wait for dayhand approval <approvalId>, then rerun with --approval <approvalId>)"],
  [130, "Interrupted (Ctrl-C)"],
];

export const ENVIRONMENT: [string, string][] = [
  ["DAYHAND_URL", "Deployment HTTP actions URL, e.g. https://<deployment>.convex.site (wins over config.toml)"],
  ["DAYHAND_API_KEY", "API key; wins over the key stored by dayhand login (give agents and CI their own, kind agent)"],
  ["DAYHAND_PROFILE", "Profile from config.toml (--profile wins)"],
  ["DAYHAND_FORMAT", "json, plain or human: default output format (flags win)"],
  ["DAYHAND_NO_INPUT", "1 to never prompt"],
  ["DAYHAND_CONFIG_DIR", "Folder of config.toml and credentials.json (default: the system's config folder)"],
  ["DAYHAND_CACHE_DIR", "Folder of the completion cache (default: the system's cache folder)"],
  ["DAYHAND_DATA_DIR", "Folder of the copy of the packaged server backend that dayhand server runs, one per version (default: the system's data folder)"],
  ["DAYHAND_CREDENTIAL_STORE", "keychain or file: where dayhand login keeps keys (default: keychain, else file)"],
  ["NO_COLOR, FORCE_COLOR", "Turn colors off or on when neither --color nor config.toml decides"],
  ["VISUAL, EDITOR", "Editor for dayhand note <ref> and dayhand edit <ref> on a terminal (default: vi, notepad on Windows)"],
  ["HLM_*, HELM_URL, HELM_API_KEY, HELM_BACKEND_DIR, HELM_SERVER_CONFIG_DIR", "Old names (the hlm and helm commands), still read when the DAYHAND_* name is unset, with a warning"],
];

const table = (rows: [string | number, string][]) => {
  const width = Math.max(...rows.map(([k]) => String(k).length));
  return rows.map(([k, v]) => `  ${String(k).padEnd(width)}  ${v}`).join("\n");
};

export const ROOT_HELP = `
dh is the same command (on Debian and Ubuntu with debhelper, type dayhand).
Task references: #42 or 42 (the task number), now (the now task) or the task id.
Without a command, dayhand shows Today. Dates: tomorrow, fri 14:00, in 3 days … (dayhand help dates).
Help topics: dayhand help dates | config | login | completion.

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
