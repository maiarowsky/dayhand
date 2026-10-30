#!/usr/bin/env node
// The Dayhand plugin for Herdr: one script behind every entry in herdr-plugin.toml.
// It talks to Herdr through HERDR_BIN_PATH and to Dayhand through the dayhand command.
import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createInterface } from "node:readline/promises";

const HERDR = process.env.HERDR_BIN_PATH || "herdr";
const PLUGIN_ID = process.env.HERDR_PLUGIN_ID || "dayhand";
const STATE_FILE = join(process.env.HERDR_PLUGIN_STATE_DIR || ".", "assignments.json");
const ENV_FILE = process.env.HERDR_PLUGIN_CONFIG_DIR ? join(process.env.HERDR_PLUGIN_CONFIG_DIR, ".env") : null;
const ASK_EXPIRES = "2h";

class PluginError extends Error {}

function readJson(text, fallback) {
  try {
    return text ? JSON.parse(text) : fallback;
  } catch {
    return fallback;
  }
}

// DAYHAND_* lines from the plugin's .env (for example DAYHAND_API_KEY of a key of kind agent).
function pluginEnv() {
  let text = "";
  try {
    text = ENV_FILE ? readFileSync(ENV_FILE, "utf8") : "";
  } catch (err) {
    if (err.code !== "ENOENT") throw new PluginError(`Cannot read ${ENV_FILE}`, { cause: err });
  }
  const env = {};
  for (const line of text.split(/\r?\n/)) {
    const match = /^\s*(DAYHAND_[A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line);
    if (match) env[match[1]] = match[2].replace(/^(["'])(.*)\1$/, "$2");
  }
  return env;
}

function dayhand(args, { inherit = false, env = pluginEnv() } = {}) {
  const result = spawnSync("dayhand", args, {
    encoding: "utf8",
    env: { ...process.env, ...env, ...(inherit ? {} : { DAYHAND_NO_INPUT: "1" }) },
    stdio: inherit ? "inherit" : ["ignore", "pipe", "pipe"],
  });
  if (result.error) throw new PluginError("Cannot run dayhand: is it installed and on PATH?", { cause: result.error });
  if (result.status !== 0) {
    const reason = inherit ? `exit ${result.status}` : result.stderr.trim() || `exit ${result.status}`;
    throw new PluginError(`dayhand ${args[0]} failed: ${reason}`);
  }
  return result.stdout;
}

function herdr(args) {
  const result = spawnSync(HERDR, args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  if (result.error) throw new PluginError("Cannot run herdr", { cause: result.error });
  if (result.status !== 0) throw new PluginError(`herdr ${args.join(" ")} failed: ${result.stderr.trim()}`);
  return result.stdout;
}

function loadAssignments() {
  try {
    return readJson(readFileSync(STATE_FILE, "utf8"), {});
  } catch (err) {
    if (err.code === "ENOENT") return {};
    throw new PluginError(`Cannot read ${STATE_FILE}`, { cause: err });
  }
}

function saveAssignments(assignments) {
  mkdirSync(join(STATE_FILE, ".."), { recursive: true });
  const temp = `${STATE_FILE}.${process.pid}`;
  writeFileSync(temp, `${JSON.stringify(assignments, null, 2)}\n`);
  renameSync(temp, STATE_FILE);
}

// Read the file again just before writing, so changes other panes made meanwhile are kept.
function updateAssignment(paneId, change) {
  const { [paneId]: current, ...rest } = loadAssignments();
  const next = change(current);
  saveAssignments(next ? { ...rest, [paneId]: next } : rest);
}

function invocationContext() {
  return readJson(process.env.HERDR_PLUGIN_CONTEXT_JSON, {});
}

function openPane(entrypoint, env = {}) {
  const envArgs = Object.entries(env).flatMap(([key, value]) => ["--env", `${key}=${value}`]);
  herdr(["plugin", "pane", "open", "--plugin", PLUGIN_ID, "--entrypoint", entrypoint, ...envArgs]);
}

// Action: open the task picker for the focused pane.
function assign() {
  const context = invocationContext();
  const paneId = process.env.HERDR_PANE_ID || context.focused_pane_id;
  if (!paneId) throw new PluginError("No focused pane to give a task to");
  openPane("picker", { DAYHAND_HERDR_PANE: paneId, DAYHAND_HERDR_AGENT: context.focused_pane_agent || "" });
}

function today() {
  openPane("ui");
}

// Overlay pane: dayhand ui as the owner, with the key from dayhand login; .env gives only the deployment and profile.
function ui() {
  const { DAYHAND_URL, DAYHAND_PROFILE } = pluginEnv();
  dayhand(["ui"], { inherit: true, env: { DAYHAND_URL, DAYHAND_PROFILE } });
}

function label(task) {
  return task.ref ? `#${task.ref}` : task.id;
}

// Popup pane: show Today, read a task number, remember it for the pane.
async function pick() {
  const paneId = process.env.DAYHAND_HERDR_PANE;
  if (!paneId) throw new PluginError("Open this from the Dayhand: give this agent a task action");
  const agent = process.env.DAYHAND_HERDR_AGENT || "the agent";
  const current = loadAssignments()[paneId];
  dayhand(["today"], { inherit: true });
  if (current) console.log(`\nPane ${paneId} has ${label(current)} ${current.title}`);
  const prompt = createInterface({ input: process.stdin, output: process.stdout });
  const answer = (await prompt.question(`\nTask for ${agent} (#42; - to remove; Enter to cancel): `)).trim();
  prompt.close();
  if (!answer) return;
  if (answer === "-") {
    updateAssignment(paneId, () => null);
    return;
  }
  const { task } = readJson(dayhand(["show", answer, "--json"]), {});
  if (!task?.id) throw new PluginError(`dayhand show ${answer} printed no task`);
  updateAssignment(paneId, () => ({ id: task.id, ref: task.ref, title: task.title, agent }));
  dayhand(["note", task.id, `Herdr: given to ${agent} in pane ${paneId}`]);
}

function approvalPending(approvalId) {
  return Boolean(approvalId) && readJson(dayhand(["approval", approvalId, "--json"]), {}).status === "pending";
}

const NOTES = {
  blocked: (agent, paneId) => `Herdr: ${agent} is waiting for you in pane ${paneId}`,
  done: (agent, paneId) => `Herdr: ${agent} finished in pane ${paneId}; check its work`,
};

// Write the agent's state into the task; returns what to remember: the last state noted, the open approval request.
function recordStatus(assignment, paneId, status, agent) {
  if (status === "working") {
    dayhand(["start", assignment.id]);
    return {};
  }
  const recorded = {};
  if (NOTES[status] && status !== assignment.noted) {
    dayhand(["note", assignment.id, NOTES[status](agent, paneId)]);
    recorded.noted = status;
  }
  if (status === "blocked" && pluginEnv().DAYHAND_HERDR_ASK === "1" && !approvalPending(assignment.approvalId)) {
    const approval = readJson(dayhand([
      "ask", `${agent} in Herdr is waiting for you`,
      "--task", assignment.id,
      "--detail", `Pane ${paneId}. Answer it in Herdr.`,
      "--option", "Seen: I will answer it in Herdr",
      "--option", "Later: it keeps waiting",
      "--reversible",
      "--expires", ASK_EXPIRES,
      "--json",
    ]), {});
    recorded.approvalId = approval.id;
  }
  return recorded;
}

// Event hook: keep the pane's task in step with its agent; forget the task when the pane closes or the task is finished.
function event() {
  const { data = {} } = readJson(process.env.HERDR_PLUGIN_EVENT_JSON, {});
  const paneId = data.pane_id;
  const assignment = paneId && loadAssignments()[paneId];
  if (!assignment) return;
  if (process.env.HERDR_PLUGIN_EVENT === "pane.closed") {
    updateAssignment(paneId, () => null);
    return;
  }
  const status = data.agent_status;
  if (!status || status === assignment.status) return;
  const { task } = readJson(dayhand(["show", assignment.id, "--json"]), {});
  if (!task?.id) throw new PluginError(`dayhand show ${assignment.id} printed no task`);
  if (task.status === "done" || task.deletedAt || task.archivedAt) {
    updateAssignment(paneId, () => null);
    return;
  }
  const agent = data.display_agent || data.agent || assignment.agent;
  const recorded = recordStatus(assignment, paneId, status, agent);
  updateAssignment(paneId, (current) => (current?.id === assignment.id ? { ...current, ...recorded, status } : current));
}

const COMMANDS = { assign, today, ui, pick, event };

try {
  const command = COMMANDS[process.argv[2]];
  if (!command) throw new PluginError(`Unknown command ${process.argv[2] ?? ""}; use ${Object.keys(COMMANDS).join(", ")}`);
  await command();
} catch (err) {
  if (!(err instanceof PluginError)) throw err;
  console.error(`dayhand plugin: ${err.message}`);
  process.exitCode = 1;
  // The popup closes when the picker exits; keep the message on screen until Enter.
  if (process.argv[2] === "pick" && process.stdin.isTTY) {
    const prompt = createInterface({ input: process.stdin, output: process.stdout });
    await prompt.question("Press Enter to close. ");
    prompt.close();
  }
}
