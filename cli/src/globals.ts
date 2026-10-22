// Options every command accepts, before or after the command name.
import type { OptSpec } from "./registry/types.js";

/** Global options: valid before or after the command. Value-taking ones are listed for argv scanning. */
export const GLOBAL_OPTIONS: OptSpec[] = [
  { flags: "--json", description: "Print the tool's structuredContent as JSON; errors as JSON on stderr" },
  { flags: "--plain", description: "Tab-separated text without headers (for scripts)" },
  { flags: "--fields <names>", description: "Comma-separated task (or settings) fields for JSON and columns" },
  { flags: "--client-id <id>", description: "Operation id for safe retries (default: generated, shown on errors)" },
  { flags: "-y, --yes", description: `Confirm changing many tasks at once` },
  { flags: "--no-input", description: "Never prompt (also HLM_NO_INPUT=1); prompts need a terminal anyway" },
  { flags: "--dry-run", description: "Show the changes a command would send (dates resolved) and send nothing" },
  { flags: "--url <url>", description: "Deployment HTTP actions URL (default: HLM_URL, then config.toml)" },
  { flags: "--profile <name>", description: "Profile from config.toml (default: HLM_PROFILE, then default_profile)" },
  { flags: "--color <when>", description: "Colors in the human format", choices: ["auto", "always", "never"] },
  { flags: "--no-color", description: "Same as --color never (NO_COLOR=1 works too)" },
];
export const VALUE_OPTIONS = new Set(["--fields", "--client-id", "--url", "--profile", "--color"]);
