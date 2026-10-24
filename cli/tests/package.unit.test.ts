// What npm pack puts in the dayhand tarball: the backend that dayhand server runs. No backend
// install and no network: prepack's copy script runs and npm lists the files (--dry-run).
import { execFileSync } from "node:child_process";
import { existsSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, test } from "vitest";

const CLI = fileURLToPath(new URL("..", import.meta.url));
const COPIES = ["backend", "man", "LICENSE"].map((name) => `${CLI}${name}`);
// Leave the working tree as found: these copies are gitignored build output.
const before = COPIES.filter((path) => existsSync(path));
afterAll(() => {
  for (const path of COPIES) if (!before.includes(path)) rmSync(path, { recursive: true, force: true });
});

let files: string[] = [];
beforeAll(() => {
  execFileSync(process.execPath, [`${CLI}scripts/pack-files.mjs`], { cwd: CLI });
  const out = execFileSync("npm", ["pack", "--dry-run", "--json", "--ignore-scripts"], { cwd: CLI, encoding: "utf8", shell: process.platform === "win32" });
  files = (JSON.parse(out)[0].files as { path: string }[]).map((file) => file.path);
}, 60_000);

describe("npm pack", () => {
  test("carries the files of the backend's setup, including its lockfile and convex/_generated", () => {
    for (const file of [
      "backend/package.json",
      "backend/package-lock.json",
      "backend/tsconfig.json",
      "backend/convex/schema.ts",
      "backend/convex/tsconfig.json",
      "backend/convex/_generated/api.js",
      "backend/convex/lib/",
      "backend/scripts/setup.mjs",
      "backend/scripts/local-backend-lib.mjs",
      "backend/scripts/fetch-local-backend.mjs",
    ]) {
      expect(files.some((path) => (file.endsWith("/") ? path.startsWith(file) : path === file)), file).toBe(true);
    }
  });

  test("leaves out tests, installed dependencies, the local backend and the vitest config", () => {
    const backend = files.filter((path) => path.startsWith("backend/"));
    expect(backend.length).toBeGreaterThan(40);
    expect(backend.filter((path) => /^backend\/(tests|node_modules|\.local-backend)\/|vitest\.config/.test(path))).toEqual([]);
  });

  test("still carries the compiled CLI folder entry, the man pages and the license", () => {
    expect(files).toEqual(expect.arrayContaining(["package.json", "LICENSE", "man/dayhand.1", "man/dh.1"]));
  });
});
