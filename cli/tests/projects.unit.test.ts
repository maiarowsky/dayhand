import { describe, expect, test } from "vitest";
import { configProject } from "../src/backlog/project.js";
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
});

test("project name decoration is immutable, works in nested results, and enables + filters", () => {
  const task: Task = { id: "task", ref: 1, title: "Menu", status: "todo", isNow: false, projectId: "bakery", labels: ["web"], links: [], createdAt: 0, updatedAt: 0 };
  const value = { results: [{ task, next: null }] };
  const decorated = withProjectNames(value, projects);
  expect(decorated.results[0]!.task.project).toBe("Strona piekarni");
  expect(value.results[0]!.task).not.toHaveProperty("project");
  expect(matches(decorated.results[0]!.task, "+STRONA-piekarni #web")).toBe(true);
  expect(matches(decorated.results[0]!.task, "+Café")).toBe(false);
  expect(matches(decorated.results[0]!.task, "+none")).toBe(false);
  expect(matches({ ...task, projectId: undefined }, "+none")).toBe(true);
});

test("config project is a hint read from normal scalar spellings", () => {
  for (const [scalar, name] of [['"A: B"', "A: B"], ["'Owner''s shop'", "Owner's shop"], ["Shop # comment", "Shop"]]) {
    expect(configProject([{ path: "config.yml", content: `project_name: ${scalar}\n` }])).toBe(name);
  }
  expect(configProject([{ path: "tasks/task.md", content: "project_name: Not a config" }])).toBeUndefined();
});
