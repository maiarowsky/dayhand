// The helm CLI against the local backend, through the same /mcp endpoint.
import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { describe, expect, test } from "vitest";
import { createKey, helm, newUserId } from "./helpers";

const CLI = fileURLToPath(new URL("../cli/helm.mjs", import.meta.url));
const exec = promisify(execFile);

async function helmCli(key: string | undefined, ...args: string[]) {
  const env = { PATH: process.env.PATH, HELM_URL: helm().siteUrl, ...(key ? { HELM_API_KEY: key } : {}) };
  try {
    const { stdout, stderr } = await exec(process.execPath, [CLI, ...args], { env });
    return { code: 0, stdout, stderr };
  } catch (error: any) {
    return { code: error.code as number, stdout: error.stdout as string, stderr: error.stderr as string };
  }
}

describe("helm CLI", () => {
  test("add, today, now, move, done, list and export", async () => {
    const key = await createKey(newUserId(), "cli");
    const added = JSON.parse((await helmCli(key, "add", "Call", "the", "bank", "--label", "admin", "--json")).stdout);
    expect(added).toMatchObject({ title: "Call the bank", labels: ["admin"] });
    const second = JSON.parse((await helmCli(key, "add", "Water plants", "--time", "18:00", "--json")).stdout);

    const now = await helmCli(key, "now", added.id, "--note", "have the account number ready");
    expect(now.stdout).toContain("Call the bank");

    const today = await helmCli(key, "today");
    expect(today.code).toBe(0);
    expect(today.stdout).toMatch(/^Today, \d{4}-\d{2}-\d{2} \(Europe\/London\)/);
    expect(today.stdout).toContain(`NOW  Call the bank (${added.id})`);
    expect(today.stdout).toContain("next: have the account number ready");
    expect(today.stdout).toMatch(/\[ \] \d{4}-\d{2}-\d{2} 18:00 Water plants/);

    const moved = await helmCli(key, "move", second.id, "tomorrow", "--time", "08:00");
    expect(moved.stdout).toMatch(/Moved:\n.* 08:00 Water plants/);

    const done = await helmCli(key, "done", added.id);
    expect(done.stdout).toMatch(/Done:\n\s+\[x\] .*Call the bank/);

    const open = await helmCli(key, "list");
    expect(open.stdout).toContain("Water plants");
    expect(open.stdout).not.toContain("Call the bank");
    expect((await helmCli(key, "list", "--done", "--label", "admin")).stdout).toContain("Call the bank");

    const md = await helmCli(key, "export");
    expect(md.stdout).toMatch(/^# Helm plan/);
    const json = JSON.parse((await helmCli(key, "export", "--format", "json")).stdout);
    expect(json.tasks).toHaveLength(2);
  });

  test("usage, tool and authentication errors have distinct exit codes", async () => {
    const key = await createKey(newUserId());
    expect(await helmCli(key, "frobnicate")).toMatchObject({ code: 2 });
    expect((await helmCli(undefined, "today")).stderr).toMatch(/HELM_API_KEY is not set/);
    const bad = await helmCli(key, "move", "nope", "today");
    expect(bad.code).toBe(1);
    expect(bad.stderr).toMatch(/Invalid arguments/);
    const revoked = await helmCli("helm_wrong", "today");
    expect(revoked).toMatchObject({ code: 3 });
    expect(revoked.stderr).toMatch(/rejected/);
  });
});
