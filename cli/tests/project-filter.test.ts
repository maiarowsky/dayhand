import { expect, test } from "vitest";
import type { Task } from "../src/render/model.js";
import { DayhandClient } from "../src/transport/client.js";
import { makeApi } from "../src/ui/api.js";
import { Controller } from "../src/ui/controller.js";
import { derive } from "../src/ui/model.js";
import { rowsText } from "../src/ui/text.js";
import { dayhandJson, helm, newUser } from "./helpers.js";

async function tasks(key: string, prefix: string, project: string) {
  const add = (title: string, flags: string[] = []) => dayhandJson<Task>(key, ["add", `${prefix} ${title}`, "-p", project, ...flags]);
  const today = await add("Today");
  const overdue = await add("Overdue", ["--due", "2000-01-01"]);
  const done = await add("Done");
  await dayhandJson(key, ["done", done.id]);
  const trash = await add("Trash");
  await dayhandJson(key, ["rm", trash.id]);
  const proposal = await add("Proposal", ["--propose"]);
  return { today, overdue, done, trash, proposal };
}

test("every live task view resolves a canonical project before filtering IDs, even when archived", async () => {
  const { key } = await newUser();
  for (const name of ["Web shop", "Web-shop"]) await dayhandJson(key, ["project", "add", name]);
  await tasks(key, "Spaced", "Web shop");
  const literal = await tasks(key, "Literal", "Web-shop");
  await dayhandJson(key, ["now", literal.today.id]);
  const ui = new Controller({ api: makeApi(new DayhandClient({ url: helm().siteUrl, key })), view: "today", columns: 120, rows: 30 });
  try {
    await ui.refresh();
    ui.key("/"); ui.paste("+WEB-shop"); ui.key("enter");
    for (const archived of [false, true]) {
      if (archived) await dayhandJson(key, ["project", "archive", "Web-shop"]);
      for (const [binding, view, expected] of [
        ["1", "today", [literal.today.id, literal.overdue.id, literal.done.id]],
        ["2", "board", [literal.today.id, literal.overdue.id, literal.done.id]],
        ["3", "week", [literal.today.id, literal.done.id]],
        ["4", "trash", [literal.trash.id]],
        ["5", "agents", [literal.proposal.id]],
      ] as const) {
        ui.key(binding); await ui.idle();
        const lists = derive(ui.snapshot()).lists;
        const visible = view === "agents" ? lists.agents.flatMap((item) => item.kind === "proposal" ? [item.task] : [])
          : view === "board" || view === "week" ? lists[view].flat() : lists[view];
        expect(visible.map((task) => task.id).sort(), `${view}, archived=${archived}`).toEqual([...expected].sort());
        expect(rowsText(ui.frame().rows)).toContain("Literal");
        expect(rowsText(ui.frame().rows)).not.toContain("Spaced");
      }
    }
  } finally { ui.stop(); }
});
