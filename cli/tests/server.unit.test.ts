// Which backend folder hlm server runs the setup script from. No backend.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, test } from "vitest";
import { findBackend } from "../src/registry/server.js";

const ROOT = mkdtempSync(join(process.env.HLM_TEST_TMPDIR ?? tmpdir(), "hlm-find-"));
afterAll(() => rmSync(ROOT, { recursive: true, force: true }));

function backend(dir: string, name = "helm-backend") {
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

  test("--backend or HELM_BACKEND_DIR, and only a real Helm backend", () => {
    expect(findBackend(clone, {}, nowhere, own)).toBe(clone);
    expect(findBackend(undefined, { HELM_BACKEND_DIR: clone }, nowhere, own)).toBe(clone);
    expect(findBackend(nowhere, {}, nowhere, own)).toBeNull();
    const other = backend(join(ROOT, "other"), "something-else");
    expect(findBackend(other, {}, nowhere, own)).toBeNull();
  });

  test("the checkout hlm runs from wins over the current folder", () => {
    expect(findBackend(undefined, {}, nested, own)).toBe(own);
  });

  test("without one, the current folder or one above it", () => {
    const missing = join(ROOT, "no-such-hlm", "backend");
    expect(findBackend(undefined, {}, nested, missing)).toBe(clone);
    expect(findBackend(undefined, {}, clone, missing)).toBe(clone);
    expect(findBackend(undefined, {}, nowhere, missing)).toBeNull();
  });
});
