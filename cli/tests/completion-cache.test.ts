import { createHash } from "node:crypto";
import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "vitest";
import { dayhand, dayhandJson, helm, newUser, TEST_HOME } from "./helpers.js";

test("completion isolates all private hints by credential and ignores URL-only cache entries", async () => {
  const first = await newUser();
  const second = await newUser();
  for (const [key, name, label] of [[first.key, "Private A", "alpha"], [second.key, "Private B", "beta"]] as const) {
    await dayhandJson(key, ["project", "add", name]);
    await dayhandJson(key, ["add", name, "-l", label]);
  }
  const cacheDir = mkdtempSync(join(TEST_HOME, "credential-cache-"));
  const legacy = createHash("sha256").update(helm().siteUrl).digest("hex").slice(0, 16);
  writeFileSync(join(cacheDir, `tasks-${legacy}.json`), JSON.stringify({
    fetchedAt: Date.now(),
    tasks: [{ ref: 99, title: "Legacy private task" }],
    labels: ["legacy"],
    projects: [{ name: "Legacy private project", archived: false }],
  }));
  const complete = async (key: string, words: string[]) => {
    const run = await dayhand(key, ["__complete", ...words], { env: { DAYHAND_CACHE_DIR: cacheDir } });
    expect(run.code, run.stderr).toBe(0);
    expect(run.stderr).toBe("");
    return run.stdout.trimEnd().split("\n");
  };
  for (const [key, name, label] of [[first.key, "Private A", "alpha"], [second.key, "Private B", "beta"], [first.key, "Private A", "alpha"]] as const) {
    expect(await complete(key, ["add", "Menu", "--project", ""])).toEqual([name, "none", ":4"]);
    expect(await complete(key, ["project", "edit", ""])).toEqual([name, ":4"]);
    expect(await complete(key, ["list", "--label", ""])).toEqual([label, ":4"]);
    expect(await complete(key, ["show", ""])).toEqual(["now\tthe now task", `1\t${name}`, ":4"]);
  }
  const invalid = "invalid-completion-key";
  expect(await complete(invalid, ["add", "Menu", "--project", ""])).toEqual(["none", ":4"]);
  expect(await complete(invalid, ["project", "edit", ""])).toEqual([":4"]);
  expect(await complete(invalid, ["list", "--label", ""])).toEqual([":4"]);
  expect(await complete(invalid, ["show", ""])).toEqual(["now\tthe now task", ":4"]);
  for (const file of readdirSync(cacheDir)) {
    const stored = file + readFileSync(join(cacheDir, file), "utf8");
    expect(stored).not.toContain(first.key);
    expect(stored).not.toContain(second.key);
  }
});
