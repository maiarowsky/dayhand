// The copy of the packaged backend that dayhand server runs the setup from. No backend.
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, test } from "vitest";
import { CliError } from "../src/core/exit.js";
import { backendCopyDir, writableBackend } from "../src/registry/packaged-backend.js";

const ROOT = mkdtempSync(join(process.env.DAYHAND_TEST_TMPDIR ?? tmpdir(), "dayhand-copy-"));
afterAll(() => {
  chmodTree(ROOT, 0o755, 0o644);
  rmSync(ROOT, { recursive: true, force: true });
});

let n = 0;
const folder = () => join(ROOT, `case-${++n}`);

/** A packaged backend like cli/backend: the files prepack copies, plus what a run in place would leave. */
function packaged(dir = folder()) {
  mkdirSync(join(dir, "scripts"), { recursive: true });
  mkdirSync(join(dir, "convex", "_generated"), { recursive: true });
  writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "dayhand-backend" }));
  writeFileSync(join(dir, "package-lock.json"), "{}");
  writeFileSync(join(dir, "scripts", "setup.mjs"), "// setup");
  writeFileSync(join(dir, "convex", "schema.ts"), "// schema");
  writeFileSync(join(dir, "convex", "_generated", "api.js"), "// api");
  return dir;
}

function chmodTree(dir: string, dirMode: number, fileMode: number) {
  if (!existsSync(dir)) return;
  chmodSync(dir, dirMode);
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) chmodTree(join(dir, entry.name), dirMode, fileMode);
    else chmodSync(join(dir, entry.name), fileMode);
  }
}

describe("writableBackend", () => {
  test("a fresh copy of the package's backend lands in <data>/backend/<version>", () => {
    const source = packaged();
    const data = folder();
    const copy = writableBackend(source, "1.2.3", data, true);
    expect(copy).toEqual({ dir: join(data, "backend", "1.2.3"), copied: true, inPlace: false });
    expect(copy.dir).toBe(backendCopyDir(data, "1.2.3"));
    for (const file of ["package.json", "package-lock.json", "scripts/setup.mjs", "convex/schema.ts", "convex/_generated/api.js"]) {
      expect(readFileSync(join(copy.dir, file), "utf8")).toBe(readFileSync(join(source, file), "utf8"));
    }
    // Nothing half-made stays beside it, and the package folder is untouched.
    expect(readdirSync(join(data, "backend"))).toEqual(["1.2.3"]);
    expect(readdirSync(source).sort()).toEqual(["convex", "package-lock.json", "package.json", "scripts"]);
  });

  test("the same version reuses its copy, with what the setup added to it", () => {
    const source = packaged();
    const data = folder();
    const first = writableBackend(source, "1.2.3", data, true);
    mkdirSync(join(first.dir, "node_modules", "convex"), { recursive: true });
    mkdirSync(join(first.dir, ".local-backend", "bin"), { recursive: true });
    writeFileSync(join(first.dir, ".local-backend", "bin", "convex-local-backend"), "binary");
    // Even a changed package folder does not replace the copy of the same version.
    writeFileSync(join(source, "convex", "schema.ts"), "// changed");
    const again = writableBackend(source, "1.2.3", data, true);
    expect(again).toEqual({ dir: first.dir, copied: false, inPlace: false });
    expect(existsSync(join(again.dir, "node_modules", "convex"))).toBe(true);
    expect(readFileSync(join(again.dir, ".local-backend", "bin", "convex-local-backend"), "utf8")).toBe("binary");
    expect(readFileSync(join(again.dir, "convex", "schema.ts"), "utf8")).toBe("// schema");
  });

  test("a new version gets a new copy and the old one stays", () => {
    const source = packaged();
    const data = folder();
    const old = writableBackend(source, "1.2.3", data, true);
    writeFileSync(join(source, "convex", "schema.ts"), "// next");
    const next = writableBackend(source, "1.3.0", data, true);
    expect(next.copied).toBe(true);
    expect(next.dir).not.toBe(old.dir);
    expect(readFileSync(join(next.dir, "convex", "schema.ts"), "utf8")).toBe("// next");
    expect(readFileSync(join(old.dir, "convex", "schema.ts"), "utf8")).toBe("// schema");
    expect(readdirSync(join(data, "backend")).sort()).toEqual(["1.2.3", "1.3.0"]);
  });

  test("never takes node_modules or .local-backend along, and a version cannot leave the data folder", () => {
    const source = packaged();
    mkdirSync(join(source, "node_modules", "x"), { recursive: true });
    mkdirSync(join(source, ".local-backend"), { recursive: true });
    const data = folder();
    const copy = writableBackend(source, "../../escape", data, true);
    expect(copy.dir.startsWith(join(data, "backend") + "/")).toBe(true);
    expect(readdirSync(copy.dir).sort()).toEqual(["convex", "package-lock.json", "package.json", "scripts"]);
  });

  test.skipIf(process.platform === "win32")("a read-only package folder still gives a writable copy", () => {
    const source = packaged();
    chmodTree(source, 0o555, 0o444);
    const data = folder();
    const copy = writableBackend(source, "1.2.3", data, true);
    // What npm ci and the Convex binary download do next: write into the copy.
    writeFileSync(join(copy.dir, "package-lock.json"), "{ }");
    mkdirSync(join(copy.dir, "node_modules"));
    expect(statSync(join(copy.dir, "scripts", "setup.mjs")).mode & 0o200).toBe(0o200);
  });

  test("--dry-run changes nothing: no copy is made, the package folder is used in place, an existing copy is found", () => {
    const source = packaged();
    const data = folder();
    expect(writableBackend(source, "1.2.3", data, false)).toEqual({ dir: source, copied: false, inPlace: true });
    expect(existsSync(data)).toBe(false);
    const made = writableBackend(source, "1.2.3", data, true);
    expect(writableBackend(source, "1.2.3", data, false)).toEqual({ dir: made.dir, copied: false, inPlace: false });
  });

  test("a copy that cannot be made says where, with a hint", () => {
    const source = packaged();
    const data = folder();
    mkdirSync(data);
    writeFileSync(join(data, "backend"), "a file where the folder should be");
    const error = (() => {
      try {
        writableBackend(source, "1.2.3", data, true);
      } catch (e) {
        return e;
      }
    })();
    expect(error).toBeInstanceOf(CliError);
    expect((error as CliError).message).toContain(join(data, "backend", "1.2.3"));
    expect((error as CliError).details.hint).toContain("DAYHAND_DATA_DIR");
    expect((error as CliError).cause).toBeDefined();
  });
});
