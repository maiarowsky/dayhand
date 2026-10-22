// The app token script: a token it issues from a key file is accepted by the
// app layer and maps to issuer|subject; bad input and existing keys are refused.
import { mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ConvexHttpClient } from "convex/browser";
import { afterAll, describe, expect, test } from "vitest";
import { api } from "../convex/_generated/api";
import { generateKeyFile, issueAppToken } from "../scripts/app-token.mjs";
import { helm } from "./helpers";

const dir = mkdtempSync(join(tmpdir(), "helm-app-token-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe("app-token script", () => {
  test("issues a token the app layer accepts", async () => {
    const keyFile = join(dir, "key.json");
    writeFileSync(keyFile, JSON.stringify({ privateJwk: helm().privateJwk }));
    const { token, userId } = await issueAppToken({ keyFile, issuer: helm().issuer, subject: "phone", days: 30 });
    expect(userId).toBe(`${helm().issuer}|phone`);

    const payload = JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString());
    expect(payload.exp - payload.iat).toBe(30 * 24 * 60 * 60);

    const client = new ConvexHttpClient(helm().url);
    client.setAuth(token);
    const task = await client.mutation(api.app.add, { title: "From the phone", dueDate: "today" });
    const today = await client.query(api.app.listToday, {});
    expect(today.today.map((t) => t.id)).toContain(task.id);
  });

  test("rejects bad input", async () => {
    const keyFile = join(dir, "key.json");
    const base = { keyFile, issuer: "https://helm.test", subject: "me", days: 30 };
    await expect(issueAppToken({ ...base, subject: "a|b" })).rejects.toThrow(/subject/);
    await expect(issueAppToken({ ...base, days: 0 })).rejects.toThrow(/days/);
    await expect(issueAppToken({ ...base, keyFile: join(dir, "missing.json") })).rejects.toThrow(/not found/);
  });

  test("generates a private key file once and never overwrites it", async () => {
    const keyFile = join(dir, "generated.json");
    expect(await generateKeyFile(keyFile)).toMatch(/^data:application\/json;base64,/);
    expect(statSync(keyFile).mode & 0o777).toBe(0o600);
    await expect(generateKeyFile(keyFile)).rejects.toThrow(/already exists/);
  });
});
