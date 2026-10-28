// The Backlog.md file format without a backend: the YAML header, the sections,
// places in the folder and the nearest status. The files are written here for
// the tests (docs/backlog-md.md describes the format).
import { basename } from "node:path";
import { describe, expect, test } from "vitest";
import { placeOf, readDate, readTask, slugOf, statusesOf, statusFor, writeTask, type TaskFile } from "../convex/lib/backlogMd";
import { FrontmatterError, parseFrontmatter, splitFrontmatter, writeFrontmatter, yamlScalar } from "../convex/lib/frontmatter";

const TASK = `---
id: TASK-7
title: "Sort the receipts: Q3"
status: In Progress
assignee:
  - '@sam'
created_date: '2026-10-01 09:15'
updated_date: 2026-10-20T08:00:00Z
labels: [finance, 'q3, late']
dependencies:
  - TASK-2
  - task-3 # the scanner
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Scan the paper receipts and file them by month.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Every receipt from July is scanned
- [ ] #2 The folder has one file per month
<!-- AC:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [ ] #1 The accountant has the link
<!-- DOD:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Scan
2. Rename
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
July done, the scanner jams on thin paper.

\`\`\`
## not a heading inside a code block
\`\`\`
<!-- SECTION:NOTES:END -->
`;

describe("the YAML header", () => {
  test("scalars, quotes, flow and block lists, comments and block text", () => {
    const { front, body } = splitFrontmatter(TASK);
    expect(body.startsWith("\n## Description")).toBe(true);
    const header = parseFrontmatter(front!);
    expect(header).toMatchObject({
      id: "TASK-7",
      title: "Sort the receipts: Q3",
      status: "In Progress",
      assignee: ["@sam"],
      created_date: "2026-10-01 09:15",
      labels: ["finance", "q3, late"],
      dependencies: ["TASK-2", "task-3"],
      priority: "high",
    });
    expect(parseFrontmatter("note: |\n  line one\n  line two\nempty:\nlist: []\nq: 'it''s'\n")).toEqual({
      note: "line one\nline two",
      empty: null,
      list: [],
      q: "it's",
    });
    expect(parseFrontmatter('title: "a \\"b\\" \\u00e9"\nfold: >\n  one\n  two\n')).toEqual({ title: 'a "b" é', fold: "one two" });
    expect(parseFrontmatter("labels: [it's, next]  \n")).toEqual({ labels: ["it's", "next"] });
  });

  test("quoted hashes, apostrophes and escaped backslashes survive all header representations", () => {
    const quoted = "O'Brien #42";
    const entries = ["id", "title", "status", "created_date", "updated_date"];
    const header = writeFrontmatter(entries.map((key) => [key, quoted]));
    expect(parseFrontmatter(splitFrontmatter(header + "\n").front!)).toEqual(Object.fromEntries(entries.map((key) => [key, quoted])));
    for (const key of ["labels", "dependencies", "references"]) {
      expect(parseFrontmatter(`${key}: ['O''Brien #42', 'next'] # outside\n`)[key]).toEqual([quoted, "next"]);
      expect(parseFrontmatter(`${key}: # outside\n  - 'O''Brien #42' # outside\n  - next\n`)[key]).toEqual([quoted, "next"]);
    }
    expect(parseFrontmatter(String.raw`title: "folder\\" # outside`)).toEqual({ title: "folder\\" });
    expect(parseFrontmatter(String.raw`labels: ["folder\\", "next #42"] # outside`)).toEqual({ labels: ["folder\\", "next #42"] });
    const written = writeTask({ id: "TASK-42", place: "task", title: quoted, status: "To Do", dependencies: [quoted], references: [quoted], created: quoted, updated: quoted, acceptance: [] });
    expect(readTask(written)).toMatchObject({ title: quoted, dependencies: [quoted], references: [quoted], updated: quoted });
  });

  test("a broken header is an error, a file without one has none", () => {
    expect(splitFrontmatter("# Just notes\n").front).toBeNull();
    expect(() => splitFrontmatter("---\ntitle: x\n")).toThrow(FrontmatterError);
    expect(() => parseFrontmatter("  indented: x\n")).toThrow(FrontmatterError);
  });

  test("written values read back as the same text", () => {
    const values = ["To Do", "Sort the receipts: Q3", "it's", "@sam", "123", "true", "", " padded ", "- dash", "#hash", "https://example.com/a?b=c"];
    const header = writeFrontmatter([["list", values], ["one", "plain-value"], ["none", []]]);
    expect(parseFrontmatter(splitFrontmatter(`${header}\n`).front!)).toEqual({ list: values, one: "plain-value", none: [] });
    expect(yamlScalar("plain")).toBe("plain");
    expect(yamlScalar("yes")).toBe("'yes'");
  });
});

describe("task files", () => {
  test("a task file: header, criteria from both lists, plan and the other sections", () => {
    const task = readTask({ path: "tasks/task-7 - Sort-the-receipts.md", content: TASK });
    expect(task).toMatchObject({
      place: "task",
      id: "TASK-7",
      title: "Sort the receipts: Q3",
      status: "In Progress",
      dependencies: ["TASK-2", "task-3"],
      description: "Scan the paper receipts and file them by month.",
      acceptance: [
        { text: "Every receipt from July is scanned", met: true },
        { text: "The folder has one file per month", met: false },
        { text: "The accountant has the link", met: false },
      ],
      plan: "1. Scan\n2. Rename",
      updated: "2026-10-20T08:00:00Z",
      dropped: ["assignee", "labels", "priority"],
    });
    expect(task.extra).toEqual(["## Implementation Notes\n\nJuly done, the scanner jams on thin paper.\n\n```\n## not a heading inside a code block\n```"]);
  });

  test("files without a header, title or id are not tasks", () => {
    expect(() => readTask({ path: "tasks/readme.md", content: "# Tasks\n" })).toThrow(/no YAML header/);
    expect(() => readTask({ path: "tasks/x.md", content: "---\nstatus: To Do\n---\n" })).toThrow(/no title/);
    for (const id of ["", "id:", "id: ' '"]) {
      expect(() => readTask({ path: "tasks/loose.md", content: `---\n${id}\ntitle: Loose\n---\nJust text.\n` })).toThrow(/no id/);
    }
  });

  test("the folder decides what a file is", () => {
    expect(placeOf("tasks/task-1 - a.md")).toBe("task");
    expect(placeOf("completed/task-1 - a.md")).toBe("completed");
    expect(placeOf("drafts/draft-1 - a.md")).toBe("draft");
    expect(placeOf("archive/tasks/task-1 - a.md")).toBe("archived");
    expect(placeOf("archive/drafts/draft-1 - a.md")).toBe("archived-draft");
    expect(placeOf("docs/doc-1 - a.md")).toBe("doc");
    expect(placeOf("decisions/decision-1 - a.md")).toBe("decision");
    expect(placeOf("milestones/m-1 - a.md")).toBe("milestone");
    expect(placeOf("config.yml")).toBe("config");
    expect(placeOf("backlog.config.yml")).toBe("config");
    expect(placeOf("task-1 - loose.md")).toBe("task");
  });
});

describe("enclosing backlog folders", () => {
  const places = [["tasks", "task"], ["completed", "completed"], ["drafts", "draft"], ["archive/tasks", "archived"], ["archive/drafts", "archived-draft"], ["docs", "doc"], ["decisions", "decision"], ["milestones", "milestone"]] as const;

  test.each(places)("%s owns its contents even inside another reserved folder", (outer, expected) => {
    for (const [inner] of places) {
      const path = `${outer}/${inner}/subset/task.md`;
      expect(placeOf(path)).toBe(expected);
      expect(placeOf(path.replace(/\//g, "\\").toUpperCase())).toBe(expected);
      expect(placeOf(`${outer}/${inner}/config.yml`)).toBe(expected);
    }
  });

  test.each([...places, ["config.yml", "config"] as const, ["backlog.config.yml", "config"] as const, ["task.md", "task"] as const])("dot and empty segments do not change %s classification", (folder, expected) => {
    const path = folder.endsWith(".yml") || folder.endsWith(".md") ? folder : `${folder}/tasks/task.md`;
    const dotted = `.//./${path.split("/").join("//./")}`;
    expect(placeOf(dotted)).toBe(expected);
    expect(placeOf(dotted.replace(/\//g, "\\").toUpperCase())).toBe(expected);
  });

  test("a reserved name below an unrecognized top-level folder does not reclassify it", () => {
    for (const [inner] of places) expect(placeOf(`subsets/${inner}/task.md`)).toBe("task");
  });
});

describe("statuses and dates", () => {
  test("first is todo, last is done, between is doing; others by their words", () => {
    const statuses = statusesOf('statuses: ["Backlog", "Doing", "Review", "Shipped"]\ndefault_status: Backlog\n');
    expect(statuses).toEqual(["Backlog", "Doing", "Review", "Shipped"]);
    expect(statusFor("backlog", statuses)).toEqual({ status: "todo", guessed: false });
    expect(statusFor("Review", statuses)).toEqual({ status: "doing", guessed: false });
    expect(statusFor("Shipped", statuses)).toEqual({ status: "done", guessed: false });
    expect(statusFor("Done", statuses)).toEqual({ status: "done", guessed: true });
    expect(statusFor("Waiting on legal", statuses)).toEqual({ status: "todo", guessed: true });
    expect(statusFor(undefined, statuses)).toEqual({ status: "todo", guessed: false });
    expect(statusesOf("project_name: x\n")).toEqual(["To Do", "In Progress", "Done"]);
  });

  test.each(["Incomplete", "Unfinished", "Unresolved", "Undone", "Unstarted", "Inactive", "Uncompleted", "Not Started", "Not Done", "Not Completed", "Not Active", "Not in progress", "No progress", "Never shipped", "non-active", "un-finished", "in-complete", "isn't resolved", "isn’t started", "Incomplete - closed", "Unfinished review"])("unrecognized negated status %s stays todo", (status) => {
    expect(statusFor(status, ["To Do", "In Progress", "Done"])).toEqual({ status: "todo", guessed: true });
  });

  test.each(["restarted", "overactive", "reviewer", "testingground", "preclosed", "shippedness", "completeable", "inprogress"])("embedded status word in %s is not an affirmative status", (status) => {
    expect(statusFor(status, ["To Do", "In Progress", "Done"])).toEqual({ status: "todo", guessed: true });
  });

  test.each([
    ["Done (verified)", "done"], ["Complete", "done"], ["Completed", "done"], ["Closed", "done"], ["Finished", "done"], ["Resolved", "done"], ["Shipped", "done"],
    ["In Progress (agent)", "doing"], ["Under Review", "doing"], ["Active", "doing"], ["Doing", "doing"], ["WIP", "doing"], ["Started", "doing"], ["Testing", "doing"], ["Blocked", "doing"],
  ])("affirmative whole words in %s map to %s", (status, expected) => {
    expect(statusFor(status, ["To Do", "In Progress", "Done"])).toEqual({ status: expected, guessed: true });
  });

  test("dates with a zone, and local dates in the user's time zone", () => {
    expect(readDate("2026-10-20T08:00:00Z", "Europe/Warsaw")).toBe(Date.parse("2026-10-20T08:00:00Z"));
    expect(readDate("2026-10-20 10:00", "Europe/Warsaw")).toBe(Date.parse("2026-10-20T08:00:00Z"));
    expect(readDate("2026-10-20", "UTC")).toBe(Date.parse("2026-10-20T00:00:00Z"));
    expect(readDate("someday", "UTC")).toBeNull();
  });
});

describe("writing", () => {
  const file: TaskFile = {
    id: "TASK-12",
    place: "task",
    title: "Renew the domain / DNS",
    status: "In Progress",
    dependencies: ["TASK-3"],
    references: ["https://registrar.example.com/renew"],
    created: "2026-10-01 09:00",
    updated: "2026-10-02 10:30",
    description: "Before it lapses.",
    acceptance: [{ text: "Paid until 2027", met: true }, { text: "DNS still resolves", met: false }],
    plan: "Pay, then check.",
    notes: "Resume: invoice saved",
  };

  test("a written file reads back with the same fields", () => {
    const written = writeTask(file);
    expect(written.path).toBe("tasks/task-12 - Renew-the-domain-DNS.md");
    expect(written.content).toContain("<!-- AC:BEGIN -->\n- [x] #1 Paid until 2027\n- [ ] #2 DNS still resolves\n<!-- AC:END -->");
    const back = readTask(written);
    expect(back).toMatchObject({
      id: "TASK-12",
      title: file.title,
      status: "In Progress",
      dependencies: ["TASK-3"],
      references: file.references,
      description: "Before it lapses.",
      acceptance: file.acceptance,
      plan: "Pay, then check.",
      extra: ["## Implementation Notes\n\nResume: invoice saved"],
      dropped: [],
    });
  });

  test("marked sections retain inner headings rather than turning them into task fields", () => {
    const description = "## Acceptance Criteria\n- [x] Only an example\n\n## Final Summary\nNot proof.";
    const plan = "## Rollout\nDeploy in stages.\n\n## Acceptance Criteria\n- [ ] Plan example";
    const notes = "## Final Summary\nStill just notes.";
    const finalSummary = "## Evidence\nAll checks passed.";
    const back = readTask(writeTask({ ...file, description, plan, notes, finalSummary }));
    expect(back).toMatchObject({ description, plan, finalSummary, acceptance: file.acceptance, extra: [`## Implementation Notes\n\n${notes}`] });
  });

  test.each(["Acceptance Criteria", "Definition of Done"])("%s ignores checkboxes and headings in fenced examples", (heading) => {
    const body = `## ${heading}\n- [x] Real criterion\n\n~~~~markdown\n- [ ] Example\n~~~\n## Final Summary\n- [x] Another example\n~~~~\n\n\`\`\`\`markdown\n\`\`\`\n- [ ] Still an example\n\`\`\`\`\n- [ ] Real second criterion`;
    const parsed = readTask({ path: "tasks/example.md", content: `---\nid: TASK-1\ntitle: Examples\n---\n${body}` });
    expect(parsed.acceptance).toEqual([{ text: "Real criterion", met: true }, { text: "Real second criterion", met: false }]);
    expect(parsed.finalSummary).toBeUndefined();
    expect(parsed.extra[0]).toContain("- [ ] Example\n~~~\n## Final Summary\n- [x] Another example\n~~~~");
  });

  test("an archived draft stays in the archived-draft classification", () => {
    const written = writeTask({ ...file, place: "archived-draft" });
    expect(written.path).toBe("archive/drafts/task-12 - Renew-the-domain-DNS.md");
    expect(readTask(written).place).toBe("archived-draft");
  });

  test.each(["task", "draft", "archived", "archived-draft"] as const)("%s filenames budget UTF-8 bytes for the complete component", (place) => {
    for (const id of ["ABCDEFGHIJKLMNOP-1", `${"A".repeat(198)}-1`]) {
      for (const title of ["界".repeat(80), "ą".repeat(80), "𠀀".repeat(80), "x".repeat(200), "***"]) {
        const written = writeTask({ ...file, id, place, title });
        const name = basename(written.path);
        expect(Buffer.byteLength(name, "utf8")).toBeLessThanOrEqual(255);
        expect(Buffer.from(name, "utf8").toString("utf8")).toBe(name);
        expect(name.startsWith(`${id.toLowerCase()} - `)).toBe(true);
        expect(readTask(written).title).toBe(title);
      }
    }
  });

  test("file names keep letters of any script and drop what a file system refuses", () => {
    expect(slugOf("Zażółć: gęślą/jaźń?")).toBe("Zażółć-gęślą-jaźń");
    expect(slugOf("***")).toBe("task");
    expect(slugOf("a".repeat(200))).toHaveLength(80);
  });
});
