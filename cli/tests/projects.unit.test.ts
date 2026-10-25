import { describe, expect, test } from "vitest";
import { findProject, withProjectNames, type Project } from "../src/projects.js";
import type { Task } from "../src/render/model.js";
import { matches } from "../src/ui/lists.js";
import { parseQuickAdd } from "../src/ui/quickadd.js";

const context = { now: Date.parse("2026-10-23T12:00:00Z"), timezone: "Europe/London" };
const project = (id: string, name: string, archived = false): Project => ({ id, name, archived, position: 1024, createdAt: 0, updatedAt: 0 });
const projects = [project("bakery", "Strona piekarni"), project("cafe", "Café"), project("old", "Old", true)];

describe("quick add projects", () => {
  test.each([
    ["Menu +STRONA-piekarni fri 2pm #web", { title: "Menu", projectId: "bakery", project: "Strona piekarni", labels: ["web"], due: { date: "2026-10-30", time: "14:00" } }],
    ["Menu +café no date", { title: "Menu", projectId: "cafe", due: null }],
    ["Menu +unknown", { title: "Menu +unknown", unknownProjects: ["+unknown"] }],
    ["Menu +Old", { title: "Menu +Old", unknownProjects: ["+Old"] }],
    ['"Menu +Strona-piekarni #web"', { title: "Menu +Strona-piekarni #web", labels: [] }],
    ["Menu +Strona-piekarni +Café", { title: "Menu +Café", projectId: "bakery" }],
  ])("%s", (input, expected) => {
    expect(parseQuickAdd(input, context, projects)).toMatchObject(expected);
  });

  test("names match case/NFC or id, but an unknown token does not create a project", () => {
    expect(findProject(projects, " CAFÉ ")?.id).toBe("cafe");
    expect(findProject(projects, "bakery")?.name).toBe("Strona piekarni");
    expect(parseQuickAdd("Menu +missing", context, projects)).not.toHaveProperty("projectId");
    expect(parseQuickAdd('"Menu +Café"', context, projects)).not.toHaveProperty("projectId");
  });

  test.each([false, true])("IDs and canonical names outrank aliases regardless of order (reversed: %s)", (reversed) => {
    const catalog = [project("web", "Web shop"), project("hyphen", "Web-shop"), project("shadow", "web")];
    const ordered = reversed ? [...catalog].reverse() : catalog;
    expect(findProject(ordered, "web")?.id).toBe("web");
    expect(findProject(ordered, "WEB")?.id).toBe("shadow");
    expect(parseQuickAdd("Menu +web", context, ordered)).toMatchObject({ title: "Menu", projectId: "web" });
    expect(parseQuickAdd("Menu +WEB-shop", context, ordered)).toMatchObject({ title: "Menu", projectId: "hyphen" });
    expect(parseQuickAdd("Menu +WEB-shop", context, ordered.filter((p) => p.id !== "hyphen"))).toMatchObject({ title: "Menu", projectId: "web" });
  });

  test.each([false, true])("ambiguous aliases and archived exact matches never select another project (reversed: %s)", (reversed) => {
    const catalog = [project("one", "Blue sky"), project("two", "Blue  sky"), project("web", "Web shop"), project("old", "Web-shop", true)];
    const ordered = reversed ? [...catalog].reverse() : catalog;
    for (const token of ["Blue-sky", "Web-shop", "old"]) {
      const parsed = parseQuickAdd(`Menu +${token}`, context, ordered);
      expect(parsed).toMatchObject({ title: `Menu +${token}`, unknownProjects: [`+${token}`] });
      expect(parsed).not.toHaveProperty("projectId");
    }
  });
});

test("project name decoration is immutable, works in nested results, and enables + filters", () => {
  const task: Task = { id: "task", ref: 1, title: "Menu", status: "todo", isNow: false, projectId: "bakery", labels: ["web"], links: [], createdAt: 0, updatedAt: 0 };
  const value = { results: [{ task, next: null }] };
  const decorated = withProjectNames(value, projects);
  expect(decorated.results[0]!.task.project).toBe("Strona piekarni");
  expect(value.results[0]!.task).not.toHaveProperty("project");
  expect(matches(decorated.results[0]!.task, "+STRONA-piekarni #web")).toBe(true);
  expect(matches(decorated.results[0]!.task, "+Café")).toBe(false);
});

test("project filters match complete tokens in any case and preserve ordinary text search", () => {
  const task: Task = { id: "task", title: "Menu", ref: 42, status: "todo", isNow: false, labels: ["web"], links: [], note: "Bakery", createdAt: 0, updatedAt: 0 };
  for (const [name, expected] of [["Home", true], ["HOME", true], ["Home-office", false], ["My Home", false]] as const) {
    const named = { ...task, projectId: name, project: name };
    expect(matches(named, "+hOmE")).toBe(expected);
    expect(matches(named, "+hOmE #web")).toBe(expected);
  }
  expect(matches(task, "+Home")).toBe(false);
  for (const filter of ["menu", "BAKERY", "#WEB", "#42", ""]) expect(matches(task, filter)).toBe(true);
});
