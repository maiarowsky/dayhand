// Which backend folder dayhand server runs the setup script from. No backend.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, test } from "vitest";
import { findBackend } from "../src/registry/server.js";

const ROOT = mkdtempSync(join(process.env.DAYHAND_TEST_TMPDIR ?? tmpdir(), "dayhand-find-"));
afterAll(() => rmSync(ROOT, { recursive: true, force: true }));

function backend(dir: string, name = "dayhand-backend") {
  mkdirSync(join(dir, "scripts"), { recursive: true });
  writeFileSync(join(dir, "scripts", "setup.mjs"), "");
  writeFileSync(join(dir, "package.json"), JSON.stringify({ name }));
  return dir;
}

describe("findBackend", () => {
  const clone = backend(join(ROOT, "clone", "backend"));
  const own = backend(join(ROOT, "own", "backend"));
  const nested = join(ROOT, "clone", "docs", "deep");
  mkdirSync(nested, { recursive: true });
  const nowhere = join(ROOT, "nowhere");
  mkdirSync(nowhere);

  test("--backend or DAYHAND_BACKEND_DIR, and only a real Dayhand backend", () => {
    expect(findBackend(clone, {}, nowhere, own)).toBe(clone);
    expect(findBackend(undefined, { DAYHAND_BACKEND_DIR: clone }, nowhere, own)).toBe(clone);
    expect(findBackend(nowhere, {}, nowhere, own)).toBeNull();
    const other = backend(join(ROOT, "other"), "something-else");
    expect(findBackend(other, {}, nowhere, own)).toBeNull();
    // A checkout from before the rename names its backend helm-backend.
    const older = backend(join(ROOT, "older"), "helm-backend");
    expect(findBackend(older, {}, nowhere, own)).toBe(older);
  });

  test("the checkout dayhand runs from wins over the current folder", () => {
    expect(findBackend(undefined, {}, nested, own)).toBe(own);
  });

  test("without one, the current folder or one above it", () => {
    const missing = join(ROOT, "no-such-dayhand", "backend");
    const noPackage = join(ROOT, "no-such-package", "backend");
    expect(findBackend(undefined, {}, nested, missing, noPackage)).toBe(clone);
    expect(findBackend(undefined, {}, clone, missing, noPackage)).toBe(clone);
    expect(findBackend(undefined, {}, nowhere, missing, noPackage)).toBeNull();
  });

  describe("the backend the package carries", () => {
    const packaged = backend(join(ROOT, "package", "backend"));
    const missing = join(ROOT, "no-such-dayhand", "backend");
    const noPackage = join(ROOT, "no-such-package", "backend");

    test("is the last resort: used when no checkout is found", () => {
      expect(findBackend(undefined, {}, nowhere, missing, packaged)).toBe(packaged);
      expect(findBackend(undefined, {}, nowhere, missing, noPackage)).toBeNull();
    });

    test("loses to the checkout dayhand runs from and to the current folder", () => {
      expect(findBackend(undefined, {}, nowhere, own, packaged)).toBe(own);
      expect(findBackend(undefined, {}, nested, missing, packaged)).toBe(clone);
      expect(findBackend(undefined, {}, clone, missing, packaged)).toBe(clone);
    });

    test("loses to --backend and DAYHAND_BACKEND_DIR, which never fall back to it", () => {
      expect(findBackend(own, {}, nowhere, missing, packaged)).toBe(own);
      expect(findBackend(undefined, { DAYHAND_BACKEND_DIR: own }, nowhere, missing, packaged)).toBe(own);
      expect(findBackend(nowhere, {}, nowhere, missing, packaged)).toBeNull();
      expect(findBackend(undefined, { DAYHAND_BACKEND_DIR: nowhere }, nowhere, missing, packaged)).toBeNull();
    });

    test("is found by its own folder as --backend too", () => {
      expect(findBackend(packaged, {}, nowhere, own, packaged)).toBe(packaged);
    });
  });
});
