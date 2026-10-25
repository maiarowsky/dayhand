import { describe, expect, test } from "vitest";
import { admin, dayhand, dayhandJson, jsonError, newUser, schemaValidator } from "./helpers.js";

const validate = schemaValidator();
const catalog = (key: string) => dayhandJson(key, ["project", "list", "--archived"]);
const history = async (key: string) => {
  const events = (await dayhandJson(key, ["export", "--format", "json"])).content.events;
  expect(events).toEqual(expect.arrayContaining([expect.objectContaining({ action: "projectAdd" })]));
  return events;
};
const placements = [
  { flags: ["--first"] }, { flags: ["--last"] },
  { flags: ["--before", "Other"] }, { flags: ["--after", "Other"] },
];
const gaps = [
  { lower: 1024, upper: 1024 + Number.EPSILON * 1024 },
  { lower: -1024 - Number.EPSILON * 1024, upper: -1024 },
  { lower: 1024, upper: 1024 },
];

describe("project ordering validation and retries", () => {
  test("a singleton rejects missing or self-relative targets in either direction without writes", async () => {
    const { key } = await newUser();
    const { project } = await dayhandJson(key, ["project", "add", "Home"]);
    const before = await catalog(key);
    const events = await history(key);
    for (const flag of ["--before", "--after"]) {
      for (const target of ["Missing", "home", project.id]) {
        const run = await dayhand(key, ["project", "edit", "Home", flag, target, "--json"]);
        expect(run.code, run.stderr).toBe(target === "Missing" ? 4 : 2);
        expect(jsonError(run).code).toBe(target === "Missing" ? "not_found" : "usage");
      }
    }
    expect(await catalog(key)).toEqual(before);
    expect(await history(key)).toEqual(events);
    for (const flag of ["--first", "--last"]) {
      expect(await dayhandJson(key, ["project", "edit", "Home", flag])).toMatchObject({ id: project.id, position: 0 });
    }
    expect(await history(key)).toEqual([...events, expect.objectContaining({ action: "projectUpdate", after: { projectId: project.id, position: 0 } })]);
  });

  test.each(placements)("rename plus $flags replays by client ID after the original name disappears", async ({ flags }) => {
    const { key } = await newUser();
    for (const name of ["Home", "Other"]) await dayhandJson(key, ["project", "add", name]);
    const args = ["project", "edit", "Home", "--name", "Household", ...flags, "--client-id", "rename-and-order"];
    const first = await dayhandJson(key, args);
    expect(validate("project.schema.json", first)).toEqual([]);
    const before = await catalog(key);
    const events = await history(key);
    expect(await dayhandJson(key, args)).toEqual(first);
    expect(await catalog(key)).toEqual(before);
    expect(await history(key)).toEqual(events);
    const missing = await dayhand(key, ["project", "edit", "Missing", ...flags, "--json"]);
    expect(missing.code, missing.stderr).toBe(4);
    expect(jsonError(missing).code).toBe("not_found");
  });

  test.each(gaps.flatMap((gap) => ["--before", "--after"].map((flag) => ({ ...gap, flag }))))("$flag rejects an exhausted gap at $lower .. $upper", async ({ lower, upper, flag }) => {
    const { key } = await newUser();
    for (const name of ["A", "B", "C"]) await dayhandJson(key, ["project", "add", name]);
    for (const [projectId, position] of [["A", lower], ["B", upper]]) {
      await dayhandJson(key, ["call", "update_project", JSON.stringify({ projectId, position })]);
    }
    const before = await catalog(key);
    const events = await history(key);
    for (const dryRun of [[], ["--dry-run"]]) {
      const run = await dayhand(key, ["project", "edit", "C", flag, flag === "--before" ? "B" : "A", ...dryRun, "--json"]);
      expect(run.code, run.stderr).toBe(2);
      expect(jsonError(run)).toMatchObject({ code: "usage", message: expect.stringContaining("no representable position") });
    }
    expect(await catalog(key)).toEqual(before);
    expect(await history(key)).toEqual(events);
  });

  test("repeated swaps after A fail before rounding can silently change menu order", async () => {
    const { key, keyId } = await newUser();
    for (const name of ["A", "B", "C"]) await dayhandJson(key, ["project", "add", name]);
    for (let attempt = 0; attempt < 64; attempt++) {
      if (attempt % 10 === 0) await admin("mutation", "callLimits:reset", { keyId });
      const before = await catalog(key);
      const moved = before.result[2].name;
      const run = await dayhand(key, ["project", "edit", moved, "--after", "A", "--json"]);
      const after = await catalog(key);
      if (run.code !== 0) {
        expect(run.code, run.stderr).toBe(2);
        expect(jsonError(run).message).toContain("no representable position");
        expect(after).toEqual(before);
        return;
      }
      expect(after.result.map((p: any) => p.name)).toEqual(["A", moved, before.result[1].name]);
      expect(after.result[1].position).toBeGreaterThan(after.result[0].position);
      expect(after.result[1].position).toBeLessThan(after.result[2].position);
    }
    throw new Error("Expected finite midpoint precision to be exhausted");
  }, 120_000);
});
