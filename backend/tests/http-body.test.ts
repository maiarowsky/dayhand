import { expect, test } from "vitest";
import { readJsonBody } from "../convex/lib/http";

const request = (body: BodyInit, headers: Record<string, string> = {}) =>
  new Request("http://localhost/test", { method: "POST", body, headers, duplex: "half" } as RequestInit);

test("L-02: the 4096-byte JSON budget counts UTF-8 bytes, not UTF-16 units", async () => {
  const body = JSON.stringify({ text: "ą".repeat(3000) });
  expect(body.length).toBeLessThan(4096);
  expect(new TextEncoder().encode(body).length).toBeGreaterThan(4096);
  expect(await readJsonBody(request(body))).toBeNull();
});

test("L-02: stop and cancel at the first chunk over budget, even with a false Content-Length", async () => {
  let reads = 0;
  let cancelled = false;
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      reads++;
      if (reads <= 3) controller.enqueue(new Uint8Array(reads === 1 ? 4096 : 1).fill(0x20));
      else controller.close();
    },
    cancel() { cancelled = true; },
  }, { highWaterMark: 0 });
  expect(await readJsonBody(request(body, { "Content-Length": "1" }))).toBeNull();
  expect(reads).toBe(2);
  expect(cancelled).toBe(true);
});

test("L-02: UTF-8 split between chunks and a body exactly at the budget still work", async () => {
  const expected = { text: "😀" + "x".repeat(4081) };
  const bytes = new TextEncoder().encode(JSON.stringify(expected));
  expect(bytes.length).toBe(4096);
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(bytes.slice(0, 11)); // Inside the emoji's UTF-8 sequence.
      controller.enqueue(bytes.slice(11));
      controller.close();
    },
  });
  expect(await readJsonBody(request(body))).toEqual(expected);
});
