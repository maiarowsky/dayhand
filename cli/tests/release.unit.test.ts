// Generated agent and man pages, prime, and the release files: pure checks
// that keep them in step with the registry and package.json.
import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import { AGENT_COMMANDS } from "../src/guide.js";
import { renderMan } from "../src/man.js";
import { commandNames } from "../src/registry/index.js";
import { primeText } from "../src/registry/agents.js";
import { renderSkill } from "../src/skill.js";
import { releaseProblems } from "../scripts/check-release.mjs";

const read = (path: string) => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");
const pkg = JSON.parse(read("cli/package.json"));

describe("generated pages (npm run build && npm run docs)", () => {
  test("man/dayhand.1 is current", () => {
    expect(read("man/dayhand.1")).toBe(renderMan());
  });

  test("docs/skills/dayhand/SKILL.md is current", () => {
    expect(read("docs/skills/dayhand/SKILL.md")).toBe(renderSkill());
  });

  test("the man page lists every command and global option; roff requests stay intact", () => {
    const man = renderMan();
    for (const name of ["dayhand add", "dayhand prime", "dayhand device revoke", "\\-\\-json", "\\-\\-client\\-id"]) expect(man).toContain(name);
    // A text line starting with a dot or quote would be read as a request.
    const requests = man.split("\n").filter((line) => /^[.']/.test(line));
    for (const line of requests) expect(line, line).toMatch(/^\.(\\"|TH|SH|TP|B|PP|RS|RE|nf|fi|br)( |$)/);
  });

  test("the skill has the Agent Skills front matter and names only existing commands", () => {
    const skill = renderSkill();
    expect(skill).toMatch(/^---\nname: dayhand\ndescription: .{40,1024}\n---\n/);
    const names = commandNames();
    for (const [command] of AGENT_COMMANDS) expect(names, command).toContain(command.split(" ")[1]);
    expect(skill).not.toContain("dayhand login <");
  });
});

test("prime puts the now task with its resume note on top, then the rules", () => {
  const task = (ref: number, title: string, extra = {}) => ({
    id: `t${ref}`, ref, title, status: "todo", isNow: false, labels: [], links: [], createdAt: 0, updatedAt: 0, ...extra,
  });
  const text = primeText({
    date: "2026-10-22",
    timezone: "Europe/London",
    now: task(12, "Call the accountant", { isNow: true, status: "doing", resumeNote: "ask about VAT" }) as never,
    overdue: [task(9, "Reply to the offer", { dueDate: "2026-10-19", overdue: true }) as never],
    today: [],
    doneToday: [],
  });
  expect(text).toMatch(/^# Dayhand tasks \(dayhand\)\n\nToday, Thu 22 Oct 2026 \(Europe\/London\)\nNOW  #12 Call the accountant\n     next: ask about VAT\n/);
  expect(text).toMatch(/#9 .*Mon 19 Oct.*Reply to the offer/);
  expect(text).toContain("\n## Using dayhand\n- Pass --json");
  expect(text).not.toContain("\x1b[");
});

describe("release files", () => {
  test("the CLI has its own version: manifest, package.json, lockfile and Homebrew formula agree", () => {
    expect(JSON.parse(read(".release-please-manifest.json"))).toEqual({ cli: pkg.version });
    expect(JSON.parse(read("cli/package-lock.json")).version).toBe(pkg.version);
    expect(read("packaging/homebrew/dayhand.rb")).toContain(`url "https://registry.npmjs.org/${pkg.name}/-/dayhand-${pkg.version}.tgz" # x-release-please-version`);
    const config = JSON.parse(read("release-please-config.json"));
    expect(Object.keys(config.packages)).toEqual(["cli"]);
    expect(config.packages.cli).toMatchObject({ component: "dayhand", "release-type": "node" });
  });

  test("the package ships the binary and the man page, and names the public repository", () => {
    expect(pkg).not.toHaveProperty("private");
    expect(pkg).toMatchObject({
      name: "dayhand",
      repository: { type: "git", url: "git+https://github.com/maiarowsky/dayhand.git", directory: "cli" },
      // dh is the short name; hlm, the old one, warns until 1.0 removes it.
      bin: { dayhand: "dist/bin/dayhand.js", dh: "dist/bin/dayhand.js", hlm: "dist/bin/hlm.js" },
      man: ["./man/dayhand.1", "./man/dh.1"],
      files: ["dist", "man"],
    });
    expect(read("man/dh.1")).toBe(".so man1/dayhand.1\n");
  });

  test("the publish check refuses a private package, a wrong tag, no repository and an old npm", () => {
    const ready = { name: "@x/dayhand", version: "1.2.3", repository: { url: "git+https://github.com/x/helm.git" } };
    expect(releaseProblems(ready, "dayhand-v1.2.3", "11.6.0")).toEqual([]);
    expect(releaseProblems(pkg, `dayhand-v${pkg.version}`, "11.6.0")).toEqual([]);
    expect(releaseProblems({ ...ready, private: true }, "dayhand-v1.2.3", "11.6.0")).toEqual([expect.stringMatching(/"private": true/)]);
    expect(releaseProblems(ready, "dayhand-v1.2.4", "11.6.0")).toEqual([expect.stringMatching(/does not match/)]);
    expect(releaseProblems({ ...ready, repository: "https://github.com/<owner>/helm" }, "dayhand-v1.2.3")).toEqual([expect.stringMatching(/repository/)]);
    expect(releaseProblems(ready, "dayhand-v1.2.3", "11.5.0")).toEqual([expect.stringMatching(/trusted publishing/)]);
    expect(releaseProblems(ready, "dayhand-v1.2.3", "11.5.1")).toEqual([]);
  });

  test("the publish workflow is gated, uses OIDC with provenance and pinned actions", () => {
    const workflow = read(".github/workflows/publish-npm.yml");
    expect(workflow).toContain("if: vars.DAYHAND_PUBLISH_ENABLED == 'true'");
    expect(workflow).toContain("id-token: write");
    expect(workflow).toContain("npm publish --provenance --access public");
    expect(workflow).toContain("node scripts/check-release.mjs");
    expect(workflow).not.toMatch(/NPM_TOKEN|NODE_AUTH_TOKEN/);
    for (const file of ["publish-npm.yml", "release-please.yml"]) {
      for (const [, ref] of read(`.github/workflows/${file}`).matchAll(/uses: \S+@(\S+)/g)) expect(ref, file).toMatch(/^[0-9a-f]{40}$/);
    }
    expect(read(".github/workflows/release-please.yml")).toContain("if: vars.DAYHAND_RELEASE_ENABLED == 'true'");
  });
});
