import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterAll, expect, test } from "vitest";
import { npmCli } from "../../backend/scripts/setup-lib.mjs";

const ROOT = mkdtempSync(join(process.env.DAYHAND_TEST_TMPDIR ?? tmpdir(), "dayhand-npm-"));
afterAll(() => rmSync(ROOT, { recursive: true, force: true }));

const layouts = [
  ["Windows", "node.exe", "node_modules/npm/bin/npm-cli.js"],
  ["Unix", "bin/node", "lib/node_modules/npm/bin/npm-cli.js"],
  ["Homebrew keg", "Cellar/node/24.0.0/bin/node", "Cellar/node/24.0.0/libexec/lib/node_modules/npm/bin/npm-cli.js"],
  ["Homebrew prefix", "Cellar/node/24.0.0/bin/node", "lib/node_modules/npm/bin/npm-cli.js"],
  ["Homebrew versioned keg", "Cellar/node@22/22.0.0/bin/node", "Cellar/node@22/22.0.0/libexec/lib/node_modules/npm/bin/npm-cli.js"],
  ["Homebrew versioned prefix", "Cellar/node@22/22.0.0/bin/node", "lib/node_modules/npm/bin/npm-cli.js"],
];

test.each(layouts)("%s resolves an executable npm without npm_execpath", (name, nodePath, npmPath) => {
  const prefix = join(ROOT, name);
  const npm = join(prefix, npmPath);
  mkdirSync(dirname(npm), { recursive: true });
  writeFileSync(npm, "console.log(JSON.stringify(process.argv.slice(2)));\n");
  const found = npmCli({}, join(prefix, nodePath));
  expect(found).toBe(npm);
  const output = execFileSync(process.execPath, [found!, "ci", "--ignore-scripts"], {
    cwd: prefix,
    env: { HOME: prefix, XDG_DATA_HOME: prefix, LOCALAPPDATA: prefix },
    encoding: "utf8",
  });
  expect(JSON.parse(output)).toEqual(["ci", "--ignore-scripts"]);
});

test("npm_execpath takes precedence only when it names an existing npm CLI", () => {
  const prefix = join(ROOT, "precedence");
  const node = join(prefix, "bin", "node");
  const installed = join(prefix, "lib", "node_modules", "npm", "bin", "npm-cli.js");
  const explicit = join(prefix, "custom", "npm-cli.js");
  const other = join(prefix, "custom", "other.js");
  for (const file of [installed, explicit, other]) {
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, "");
  }
  expect(npmCli({ npm_execpath: explicit }, node)).toBe(explicit);
  expect(npmCli({ npm_execpath: other }, node)).toBe(installed);
  expect(npmCli({ npm_execpath: join(prefix, "missing", "npm-cli.js") }, node)).toBe(installed);
  expect(npmCli({}, join(ROOT, "missing", "bin", "node"))).toBeUndefined();
});
