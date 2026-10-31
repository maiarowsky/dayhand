// Runs the plugin launcher as Herdr does, with a stand-in dayhand that logs its arguments.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), "dayhand-herdr.sh");
const PANE = "w1:p1";
const TASK = { id: "t1", ref: 42, title: "Fix the login" };
const HERDR_PATH = "/usr/bin:/bin:/usr/sbin:/sbin";
const SYSTEM_NODE = HERDR_PATH.split(":").some((dir) => existsSync(join(dir, "node")));

const FAKE_DAYHAND = `#!/usr/bin/env node
const { appendFileSync } = require("node:fs");
const args = process.argv.slice(2);
const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => key.startsWith("DAYHAND_")));
appendFileSync(process.env.FAKE_LOG, JSON.stringify({ args, env }) + "\\n");
const replies = {
  show: { task: { ...${JSON.stringify(TASK)}, status: process.env.FAKE_TASK_STATUS } },
  ask: { id: "a" + Date.now(), status: "pending" },
  approval: { id: args[1], status: process.env.FAKE_APPROVAL_STATUS },
};
if (args.includes("--json")) process.stdout.write(JSON.stringify(replies[args[0]]));
`;

function setup({ taskStatus = "doing", approvalStatus = "pending", dotEnv = "DAYHAND_HERDR_ASK=1\n" } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "dayhand-herdr-"));
  const bin = join(dir, "dayhand");
  writeFileSync(bin, FAKE_DAYHAND);
  chmodSync(bin, 0o755);
  writeFileSync(join(dir, ".env"), dotEnv);
  writeFileSync(join(dir, "assignments.json"), JSON.stringify({ [PANE]: { ...TASK, agent: "claude" } }));
  const logFile = join(dir, "calls.log");
  writeFileSync(logFile, "");
  const env = {
    ...Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith("DAYHAND_"))),
    PATH: `${dir}:${process.env.PATH}`,
    HERDR_PLUGIN_STATE_DIR: dir,
    HERDR_PLUGIN_CONFIG_DIR: dir,
    FAKE_LOG: logFile,
    FAKE_TASK_STATUS: taskStatus,
    FAKE_APPROVAL_STATUS: approvalStatus,
  };
  const run = (command, extraEnv = {}) => {
    const result = spawnSync("/bin/sh", [SCRIPT, command], { encoding: "utf8", env: { ...env, ...extraEnv } });
    assert.equal(result.status, 0, result.stderr);
  };
  const log = () => readFileSync(logFile, "utf8").trim().split("\n").filter(Boolean).map((line) => JSON.parse(line));
  return {
    run,
    agentStatus(status) {
      run("event", {
        HERDR_PLUGIN_EVENT: "pane.agent_status_changed",
        HERDR_PLUGIN_EVENT_JSON: JSON.stringify({ event: "pane.agent_status_changed", data: { pane_id: PANE, agent_status: status, display_agent: "claude" } }),
      });
    },
    calls: () => log().map(({ args }) => args),
    envs: () => log().map(({ env }) => env),
    assignments: () => JSON.parse(readFileSync(join(dir, "assignments.json"), "utf8")),
  };
}

const changes = (calls) => calls.filter(([command]) => command !== "show" && command !== "approval").map(([command]) => command);

for (const [name, fnmDir] of [
  ["fnm on Linux", ".local/share/fnm/aliases/default/bin"],
  ["fnm on macOS", "Library/Application Support/fnm/aliases/default/bin"],
]) {
  test(`a minimal Herdr PATH finds Node and dayhand with ${name}`, (t) => {
    const home = mkdtempSync(join(tmpdir(), "dayhand herdr home "));
    t.after(() => rmSync(home, { recursive: true, force: true }));
    const bin = join(home, fnmDir);
    mkdirSync(bin, { recursive: true });
    const node = join(bin, "node");
    const dayhand = join(bin, "dayhand");
    writeFileSync(node, `#!/bin/sh\nprintf 'fnm\\n' >> "$FAKE_NODE_LOG"\nexec '${process.execPath.replaceAll("'", "'\\''")}' "$@"\n`);
    writeFileSync(dayhand, FAKE_DAYHAND);
    for (const file of [node, dayhand]) chmodSync(file, 0o755);
    const logFile = join(home, "calls.log");
    const nodeLog = join(home, "node.log");
    const result = spawnSync("/bin/sh", [SCRIPT, "ui"], {
      encoding: "utf8",
      env: {
        HOME: home,
        PATH: HERDR_PATH,
        HERDR_PLUGIN_CONFIG_DIR: home,
        FAKE_LOG: logFile,
        FAKE_NODE_LOG: nodeLog,
      },
    });
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(JSON.parse(readFileSync(logFile, "utf8")), { args: ["ui"], env: {} });
    assert.equal(
      existsSync(nodeLog) ? readFileSync(nodeLog, "utf8") : "",
      SYSTEM_NODE ? "" : "fnm\nfnm\n",
      "a system Node on Herdr's PATH comes first; otherwise the plugin and dayhand use fnm's Node",
    );
  });
}

test("an agent blocked again and again gets one note and one open approval request", () => {
  const plugin = setup();
  for (const status of ["blocked", "working", "blocked", "idle", "blocked", "working", "blocked"]) plugin.agentStatus(status);
  assert.deepEqual(changes(plugin.calls()), ["note", "ask", "start", "start"]);
  assert.equal(plugin.calls().find(([command]) => command === "note")[2], "Herdr: claude is waiting for you in pane w1:p1");
});

test("a new approval request goes out once the last one is no longer pending", () => {
  const plugin = setup({ approvalStatus: "expired" });
  for (const status of ["blocked", "working", "blocked"]) plugin.agentStatus(status);
  assert.deepEqual(changes(plugin.calls()), ["note", "ask", "start", "ask"]);
});

test("a finished agent adds one note until it is blocked in between", () => {
  const plugin = setup();
  for (const status of ["done", "working", "done", "working", "blocked", "working", "done"]) plugin.agentStatus(status);
  const notes = plugin.calls().filter(([command]) => command === "note").map(([, , text]) => text);
  assert.deepEqual(notes, [
    "Herdr: claude finished in pane w1:p1; check its work",
    "Herdr: claude is waiting for you in pane w1:p1",
    "Herdr: claude finished in pane w1:p1; check its work",
  ]);
});

test("a task already done is not started again and the pane forgets it", () => {
  const plugin = setup({ taskStatus: "done" });
  plugin.agentStatus("working");
  plugin.agentStatus("blocked");
  assert.deepEqual(changes(plugin.calls()), []);
  assert.deepEqual(plugin.assignments(), {});
});

test("Today in Herdr gets the deployment and profile from .env but not the agent key", () => {
  const plugin = setup({ dotEnv: "DAYHAND_API_KEY=agent-key\nDAYHAND_URL=https://example.invalid\nDAYHAND_PROFILE=work\n" });
  plugin.run("ui");
  assert.deepEqual(plugin.calls(), [["ui"]]);
  assert.deepEqual(plugin.envs(), [{ DAYHAND_URL: "https://example.invalid", DAYHAND_PROFILE: "work" }]);
});
