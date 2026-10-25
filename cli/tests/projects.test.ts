// Executable CLI/TUI flows on the merged, real local backend (no project-operation mocks).
import { createServer } from "node:http";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { DayhandClient } from "../src/transport/client.js";
import { makeApi } from "../src/ui/api.js";
import { Controller } from "../src/ui/controller.js";
import { rowsText } from "../src/ui/text.js";
import { admin, dayhand, dayhandJson, helm, jsonError, newUser, schemaValidator, TEST_HOME } from "./helpers.js";

const validate = schemaValidator();
const titles = (result: any) => result.result.map((t: any) => t.title);
const names = (key: string) => dayhandJson(key, ["project", "list", "--archived"]).then((v) => v.result.map((p: any) => p.name));

function folder(name = "Shop") {
  const dir = mkdtempSync(join(TEST_HOME, "project-backlog-"));
  mkdirSync(join(dir, "tasks"));
  writeFileSync(join(dir, "config.yml"), `project_name: ${JSON.stringify(name)}\nstatuses: ["To Do", "Doing", "Done"]\n`);
  writeFileSync(join(dir, "tasks/task-1.md"), "---\nid: TASK-1\ntitle: Imported menu\nstatus: To Do\n---\n");
  return dir;
}

describe("projects", () => {
  test("from-label previews store nothing, including task history; applying moves only unassigned tasks", async () => {
    const { key } = await newUser();
    const other = (await dayhandJson(key, ["project", "add", "Other"])).project;
    await dayhandJson(key, ["add", "Loose", "-l", "home"]);
    await dayhandJson(key, ["add", "Assigned", "-l", "home", "-p", other.id]);
    const before = await dayhandJson(key, ["export", "--format", "json"]);
    const history = await dayhandJson(key, ["show", "1"]);
    const preview = await dayhandJson(key, ["project", "add", "Home", "--from-label", "home", "--remove-label", "--dry-run"]);
    expect(validate("dry-run.schema.json", preview)).toEqual([]);
    expect(validate("project-added.schema.json", preview.calls[0].result)).toEqual([]);
    expect(preview.calls[0]).toMatchObject({ tool: "add_project", arguments: { fromLabel: "home", removeLabel: true }, result: { moved: [{ ref: 1 }], skipped: [{ ref: 2, projectId: other.id }] } });
    const after = await dayhandJson(key, ["export", "--format", "json"]);
    expect({ ...after.content, exportedAt: null }).toEqual({ ...before.content, exportedAt: null });
    expect(await dayhandJson(key, ["show", "1"])).toEqual(history);
    const applied = await dayhandJson(key, ["project", "add", "Home", "--from-label", "home", "--remove-label"]);
    expect(applied.moved).toHaveLength(1);
    expect(applied.skipped).toHaveLength(1);
    expect((await dayhandJson(key, ["show", "1"])).task).toMatchObject({ projectId: applied.project.id, labels: [] });
    expect((await dayhandJson(key, ["show", "2"])).task).toMatchObject({ projectId: other.id, labels: ["home"] });
  });

  test("menu order, metadata clearing, archive and unarchive keep their schema and tasks", async () => {
    const { key, keyId } = await newUser();
    for (const name of ["A", "B", "C"]) await dayhandJson(key, ["project", "add", name]);
    const reorder = async (name: string, flags: string[], expected: string[]) => {
      const value = await dayhandJson(key, ["project", "edit", name, ...flags]);
      expect(validate("project.schema.json", value)).toEqual([]);
      expect(await names(key)).toEqual(expected);
    };
    await reorder("C", ["--before", "B"], ["A", "C", "B"]);
    await reorder("A", ["--after", "C"], ["C", "A", "B"]);
    await reorder("B", ["--first"], ["B", "C", "A"]);
    await reorder("B", ["--last"], ["C", "A", "B"]);
    await dayhandJson(key, ["project", "edit", "A", "--name", "Alpha", "--color", "teal", "--icon", "🏠", "--note", "Context"]);
    const cleared = await dayhandJson(key, ["project", "edit", "Alpha", "--clear-color", "--clear-icon", "--clear-note"]);
    for (const field of ["color", "icon", "note"]) expect(cleared).not.toHaveProperty(field);
    await dayhandJson(key, ["add", "Keeps its project", "-p", "Alpha"]);
    const archived = await dayhandJson(key, ["project", "archive", "Alpha", "B"]);
    expect(validate("results.schema.json", archived)).toEqual([]);
    expect(archived.results.every((p: any) => p.archived)).toBe(true);
    expect((await dayhandJson(key, ["project"])).result.map((p: any) => p.name)).toEqual(["C"]);
    expect((await dayhandJson(key, ["today", "-p", "Alpha"])).today).toHaveLength(1);
    const restored = await dayhandJson(key, ["project", "unarchive", "Alpha", "B"]);
    expect(validate("results.schema.json", restored)).toEqual([]);
    expect(restored.results.every((p: any) => !p.archived)).toBe(true);
    await admin("mutation", "callLimits:reset", { keyId });
    for (const flags of [["--first", "--last"], ["--before", "Alpha"], ["--color", "red", "--clear-color"], ["--note", "new", "--clear-note"]]) {
      expect((await dayhand(key, ["project", "edit", "Alpha", ...flags])).code).toBe(2);
    }
    expect(await names(key)).toEqual(["C", "Alpha", "B"]);
  });

  test("project --color is distinct from terminal colors and global flags work before or after the command", async () => {
    const { key } = await newUser();
    const run = await dayhand(key, ["--color", "always", "project", "add", "Colored", "--color", "amber", "--no-color", "--client-id", "color-once"]);
    expect(run.code, run.stderr).toBe(0);
    expect(run.stdout).not.toContain("\u001b[");
    expect((await dayhandJson(key, ["project", "list"])).result[0].color).toBe("amber");
    const renamed = await dayhand(key, ["--json", "project", "edit", "Colored", "--color", "blue"]);
    expect(renamed.code, renamed.stderr).toBe(0);
    expect(JSON.parse(renamed.stdout).color).toBe("blue");
    const task = await dayhand(key, ["--json", "add", "Options", "-p", "Colored", "--client-id", "option-task"]);
    expect(task.code, task.stderr).toBe(0);
    const plain = await dayhand(key, ["list", "--plain", "--fields", "title"]);
    expect(plain.stdout).toBe("Options\n");
    const noColor = await dayhand(key, ["--color", "always", "list", "--no-color"]);
    expect(noColor.stdout).not.toContain("\u001b[");
    const color = await dayhand(key, ["--no-color", "list", "--color", "always"]);
    expect(color.stdout).toContain("\u001b[");
  });

  test("bulk assign requires confirmation at two tasks, returns results, and none clears", async () => {
    const { key } = await newUser();
    const project = (await dayhandJson(key, ["project", "add", "Home"])).project;
    for (const title of ["A", "B"]) await dayhandJson(key, ["add", title]);
    expect((await dayhand(key, ["project", "assign", "Home", "1", "2", "--json"])).code).toBe(2);
    expect((await dayhandJson(key, ["list", "-p", "none"])).total).toBe(2);
    const assigned = await dayhandJson(key, ["project", "assign", "Home", "1", "2", "-y", "--client-id", "assign-many"]);
    expect(validate("results.schema.json", assigned)).toEqual([]);
    expect(assigned.results.map((t: any) => t.projectId)).toEqual([project.id, project.id]);
    expect(await dayhandJson(key, ["project", "assign", "Home", "1", "2", "-y", "--client-id", "assign-many"])).toEqual(assigned);
    await dayhandJson(key, ["project", "assign", "none", "1", "2", "-y"]);
    expect((await dayhandJson(key, ["list", "-p", "none"])).total).toBe(2);
  });

  test("task filtering is server-side and default plain columns do not gain a project", async () => {
    const { key } = await newUser();
    const project = (await dayhandJson(key, ["project", "add", "Strona piekarni"])).project;
    const task = await dayhandJson(key, ["add", "Menu", "-p", project.id, "-l", "web"]);
    const loose = await dayhandJson(key, ["add", "Loose"]);
    expect((await dayhandJson(key, ["list", "-p", "strona PIEKARNI", "--limit", "1"])).total).toBe(1);
    expect(titles(await dayhandJson(key, ["list", "-p", "none"]))).toEqual(["Loose"]);
    expect((await dayhandJson(key, ["today", "-p", "none"])).today.map((t: any) => t.id)).toEqual([loose.id]);
    expect((await dayhandJson(key, ["board", "-p", project.id])).todo.map((t: any) => t.id)).toEqual([task.id]);
    const plain = await dayhand(key, ["list", "--plain"]);
    expect(plain.stdout).toBe(`${task.ref}\ttodo\t${task.dueDate}\t\tMenu\tweb\n${loose.ref}\ttodo\t${loose.dueDate}\t\tLoose\t\n`);
    const human = await dayhand(key, ["list"]);
    expect(human.stdout).toMatch(/Menu\s+\+Strona-piekarni #web/);
    expect((await dayhand(key, ["show", "1"])).stdout).toContain("+Strona-piekarni");
    expect((await dayhand(key, ["list", "--plain", "--fields", "project,projectId"])).stdout).toBe(`Strona piekarni\t${project.id}\n\t\n`);
    const fields = await dayhandJson(key, ["list", "--fields", "project,projectId"]);
    expect(fields.result).toEqual([{ project: "Strona piekarni", projectId: project.id }, {}]);
    expect((await dayhandJson(key, ["list"])).result[0]).not.toHaveProperty("project");
    await dayhandJson(key, ["edit", "1", "--clear-project"]);
    expect(titles(await dayhandJson(key, ["list", "-p", "none"]))).toEqual(["Menu", "Loose"]);
  });

  test("Backlog creates only an explicit missing project; previews create nothing and config is just a hint", async () => {
    const { key } = await newUser();
    const dir = folder("Shop");
    const preview = await dayhand(key, ["backlog", "import", dir, "--project", "Shop", "--dry-run", "--json"]);
    expect(preview.code, preview.stderr).toBe(0);
    expect(validate("backlog-import.schema.json", JSON.parse(preview.stdout))).toEqual([]);
    expect(preview.stderr).toContain("Would create project");
    expect(await names(key)).toEqual([]);
    expect(titles(await dayhandJson(key, ["list"]))).toEqual([]);
    const imported = await dayhandJson(key, ["backlog", "import", dir, "--project", "Shop"]);
    expect(imported).toMatchObject({ created: 1, failed: [] });
    expect(await names(key)).toEqual(["Shop"]);
    expect((await dayhandJson(key, ["list", "-p", "Shop"])).total).toBe(1);
    const again = await dayhandJson(key, ["backlog", "import", dir, "--project", "shop"]);
    expect(again.created).toBe(0);
    expect(await names(key)).toEqual(["Shop"]);
    const fresh = await newUser();
    const unassigned = await dayhand(fresh.key, ["backlog", "import", dir, "--json"]);
    expect(unassigned.code).toBe(0);
    expect(JSON.parse(unassigned.stderr.trim())).toMatchObject({ warning: { code: "backlog_project", message: expect.stringContaining('add --project "Shop"') } });
    expect(await names(fresh.key)).toEqual([]);
    expect((await dayhandJson(fresh.key, ["list", "-p", "none"])).total).toBe(1);
  });

  test("ICS and JSON imports use the fallback project only for tasks without one in the file", async () => {
    const { key } = await newUser();
    const fallback = (await dayhandJson(key, ["project", "add", "Fallback"])).project;
    const ics = join(TEST_HOME, "project.ics");
    writeFileSync(ics, "BEGIN:VCALENDAR\nVERSION:2.0\nBEGIN:VTODO\nUID:project-import-1\nSUMMARY:Calendar task\nEND:VTODO\nEND:VCALENDAR\n");
    const imported = await dayhandJson(key, ["import", ics, "--format", "ics", "--project", "Fallback"]);
    expect(validate("import-result.schema.json", imported)).toEqual([]);
    expect(imported).toMatchObject({ created: 1, failed: [] });
    expect((await dayhandJson(key, ["list", "-p", "Fallback"])).result[0].projectId).toBe(fallback.id);
    const source = await newUser();
    await dayhandJson(source.key, ["project", "add", "From file"]);
    await dayhandJson(source.key, ["add", "Keeps file project", "-p", "From file"]);
    await dayhandJson(source.key, ["add", "Uses fallback"]);
    const exported = await dayhandJson(source.key, ["export", "--format", "json"]);
    const file = join(TEST_HOME, "projects.json");
    writeFileSync(file, JSON.stringify(exported.content));
    expect((await dayhandJson(key, ["import", file, "--project", "Fallback"])).created).toBe(2);
    expect(titles(await dayhandJson(key, ["list", "-p", "From file"]))).toEqual(["Keeps file project"]);
    expect(titles(await dayhandJson(key, ["list", "-p", "Fallback"]))).toEqual(["Calendar task", "Uses fallback"]);
  });

  test("executable completion reads active projects from the real backend, including names with spaces", async () => {
    const { key } = await newUser();
    await dayhandJson(key, ["project", "add", "Strona piekarni"]);
    await dayhandJson(key, ["project", "add", "Old"]);
    await dayhandJson(key, ["project", "archive", "Old"]);
    const active = await dayhand(key, ["__complete", "add", "Menu", "-p", ""]);
    expect(active.code).toBe(0);
    expect(active.stdout.trim().split("\n")).toEqual(["Strona piekarni", "none", ":4"]);
    const ordered = await dayhand(key, ["__complete", "project", "edit", "Strona piekarni", "--before", ""]);
    expect(ordered.stdout.trim().split("\n")).toEqual(["Strona piekarni", "Old", ":4"]);
  });

  test("human names cost one catalog call per command, JSON and default plain cost none", async () => {
    const { key } = await newUser();
    await dayhandJson(key, ["project", "add", "Home"]);
    await dayhandJson(key, ["add", "A", "-p", "Home"]);
    const calls: string[] = [];
    const proxy = createServer(async (request, response) => {
      let body = "";
      for await (const chunk of request) body += chunk;
      const rpc = JSON.parse(body);
      if (rpc.method === "tools/call") calls.push(rpc.params.name);
      const upstream = await fetch(helm().siteUrl + request.url, { method: request.method, headers: { "Content-Type": "application/json", Authorization: request.headers.authorization ?? "" }, body });
      response.writeHead(upstream.status, { "Content-Type": "application/json" }).end(await upstream.text());
    });
    await new Promise<void>((resolve) => proxy.listen(0, "127.0.0.1", resolve));
    const url = `http://127.0.0.1:${(proxy.address() as { port: number }).port}`;
    try {
      for (const flags of [[], ["--json"], ["--plain"], ["--json", "--fields", "project"]]) {
        calls.length = 0;
        const run = await dayhand(key, ["list", ...flags], { url });
        expect(run.code, run.stderr).toBe(0);
        expect(calls.filter((name) => name === "list_projects")).toHaveLength(flags.length === 0 || flags.includes("project") ? 1 : 0);
      }
    } finally { await new Promise<void>((resolve) => proxy.close(() => resolve())); }
  });

  test("TUI quick add and / +project work through the live controller", async () => {
    const { key } = await newUser();
    const project = (await dayhandJson(key, ["project", "add", "Strona piekarni"])).project;
    await dayhandJson(key, ["add", "Loose"]);
    const ui = new Controller({ api: makeApi(new DayhandClient({ url: helm().siteUrl, key })), view: "today", columns: 120, rows: 24 });
    try {
      await ui.refresh();
      ui.key("a"); ui.paste("Menu +STRONA-piekarni #web");
      expect(rowsText(ui.frame().rows)).toContain("+Strona-piekarni #web");
      ui.key("enter"); await ui.idle();
      expect((await dayhandJson(key, ["list", "-p", project.id])).result[0]).toMatchObject({ title: "Menu", labels: ["web"], projectId: project.id });
      ui.key("/"); ui.paste("+strona-piekarni"); ui.key("enter");
      expect(rowsText(ui.frame().rows)).toContain("Menu");
      expect(rowsText(ui.frame().rows)).not.toContain("Loose");
      ui.key("/"); ui.key("C-u"); ui.key("esc");
      ui.key("a"); ui.paste("Keep +unknown");
      expect(rowsText(ui.frame().rows)).toContain("? +unknown");
      ui.key("enter"); await ui.idle();
      expect(titles(await dayhandJson(key, ["list", "-p", "none"]))).toContain("Keep +unknown");
    } finally { ui.stop(); }
  });
});
