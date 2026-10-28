// list_all through MCP: search, filters and pages on the server.
import { describe, expect, test } from "vitest";
import { callTool, createKey, mcpClient, newUserId, utc } from "./helpers";

const AT = utc("2026-10-23T09:00"); // a Friday; the default time zone is Europe/London

async function seeded() {
  const client = await mcpClient(await createKey(newUserId()));
  const add = (args: Record<string, unknown>) => callTool(client, "add_task", args);
  // Labels as an agent from before 0.14.0 still sends them: accepted and ignored.
  await add({ title: "Zadzwonić do księgowej", dueDate: "2026-10-20", labels: ["dom"] });
  await add({ title: "Faktury", note: "wysłać KSIĘGOWEJ do piątku", dueDate: "2026-10-23", labels: ["firma"] });
  await add({ title: "Plan tygodnia", resumeNote: "księgowa oddzwoni", dueDate: "2026-10-27" });
  await add({ title: "Kupić prezent" });
  const done = await add({ title: "Paragon dla księgowej", dueDate: "2026-10-21" });
  await callTool(client, "complete_task", { taskId: done.id });
  return client;
}

const titles = (page: { result: { title: string }[] }) => page.result.map((t) => t.title);
const find = async (client: Awaited<ReturnType<typeof mcpClient>>, args: Record<string, unknown>) =>
  (await client.callTool({ name: "list_all", arguments: { at: AT, ...args } })).structuredContent as any;

describe("list_all on the server", () => {
  test("search finds text in titles, notes and resume notes, any case, and pages with a cursor", async () => {
    const client = await seeded();
    const first = await find(client, { query: "księgow", limit: 1 });
    expect(first).toMatchObject({ total: 4, nextCursor: expect.any(String) });
    expect(titles(first)).toEqual(["Zadzwonić do księgowej"]);
    const second = await find(client, { query: "księgow", limit: 2, cursor: first.nextCursor });
    expect(titles(second)).toEqual(["Paragon dla księgowej", "Faktury"]);
    const last = await find(client, { query: "KSIĘGOW", limit: 2, cursor: second.nextCursor });
    expect(titles(last)).toEqual(["Plan tygodnia"]);
    expect(last).toMatchObject({ total: 4, nextCursor: null });
    await client.close();
  });

  test("a cursor stays valid when tasks are added before it", async () => {
    const client = await seeded();
    const first = await find(client, { limit: 2 });
    await callTool(client, "add_task", { title: "Wcześniejsze", dueDate: "2026-10-01" });
    const next = await find(client, { limit: 10, cursor: first.nextCursor });
    expect(titles(next)).not.toContain("Wcześniejsze");
    expect([...titles(first), ...titles(next)]).toHaveLength(5);
    await client.close();
  });

  test("status, due days and overdue narrow the list; labels are ignored", async () => {
    const client = await seeded();
    expect(titles(await find(client, { status: ["done"] }))).toEqual(["Paragon dla księgowej"]);
    expect(titles(await find(client, { includeDone: false }))).not.toContain("Paragon dla księgowej");
    const unfiltered = await find(client, { labels: ["firma"] });
    expect(unfiltered.total).toBe(5);
    expect(unfiltered.result.some((t: any) => "labels" in t)).toBe(false);
    expect(titles(await find(client, { query: "firma" }))).toEqual([]);
    expect(titles(await find(client, { overdue: true }))).toEqual(["Zadzwonić do księgowej"]);
    expect(titles(await find(client, { dueAfter: "2026-10-20", dueBefore: "2026-10-27" }))).toEqual([
      "Paragon dla księgowej",
      "Faktury",
    ]);
    expect(titles(await find(client, { dueBefore: "today", status: ["todo"] }))).toEqual(["Zadzwonić do księgowej"]);
    const undated = await find(client, { query: "prezent" });
    expect(undated).toMatchObject({ total: 1, nextCursor: null });
    expect(titles(await find(client, { query: "prezent", dueAfter: "2000-01-01" }))).toEqual([]);
    await client.close();
  });

  test("without limit everything comes back and the text block stays the plain array", async () => {
    const client = await seeded();
    const all = await client.callTool({ name: "list_all", arguments: {} });
    const text = JSON.parse((all.content as any)[0].text);
    expect(Array.isArray(text)).toBe(true);
    expect(text).toHaveLength(5);
    expect(all.structuredContent).toMatchObject({ total: 5, nextCursor: null });
    const paged = await client.callTool({ name: "list_all", arguments: { limit: 2 } });
    expect(JSON.parse((paged.content as any)[0].text)).toEqual(paged.structuredContent);
    await client.close();
  });

  test("bad limits, cursors and days are invalid arguments", async () => {
    const client = await mcpClient(await createKey(newUserId()));
    for (const args of [{ limit: 0 }, { limit: 201 }, { limit: 1.5 }, { cursor: "nope" }, { dueBefore: "someday" }, { query: "x".repeat(201) }]) {
      const result = await client.callTool({ name: "list_all", arguments: args });
      expect(result.structuredContent, JSON.stringify(args)).toMatchObject({ error: { code: "invalid_argument" } });
    }
    const status = await client.callTool({ name: "list_all", arguments: { status: ["later"] } });
    expect(status.structuredContent).toMatchObject({ error: { code: "invalid_argument", message: /Invalid arguments/ } });
    await client.close();
  });
});
