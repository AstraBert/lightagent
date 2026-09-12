import { assert, assertEquals } from "@std/assert";
import { AsyncQueue } from "../src/queue.ts";

Deno.test("AsyncQueue - returns pushed items in FIFO order", async () => {
  const queue = new AsyncQueue<number>();
  queue.push({ chunk: 1 });
  queue.push({ chunk: 2 });
  queue.push({ chunk: 3 });

  assertEquals(await queue.next(), { chunk: 1 });
  assertEquals(await queue.next(), { chunk: 2 });
  assertEquals(await queue.next(), { chunk: 3 });
});

Deno.test("AsyncQueue - next() waits for a future push", async () => {
  const queue = new AsyncQueue<string>();
  const pending = queue.next();
  queue.push({ chunk: "late" });
  assertEquals(await pending, { chunk: "late" });
});

Deno.test("AsyncQueue - multiple waiting consumers are resolved in order", async () => {
  const queue = new AsyncQueue<number>();
  const first = queue.next();
  const second = queue.next();
  const third = queue.next();

  queue.push({ chunk: 1 });
  queue.push({ chunk: 2 });
  queue.push({ chunk: 3 });

  assertEquals(await first, { chunk: 1 });
  assertEquals(await second, { chunk: 2 });
  assertEquals(await third, { chunk: 3 });
});

Deno.test("AsyncQueue - interleaved pushes and nexts preserve order", async () => {
  const queue = new AsyncQueue<number>();
  queue.push({ chunk: 1 });
  const a = queue.next();
  const b = queue.next();
  queue.push({ chunk: 2 });
  queue.push({ chunk: 3 });
  const c = queue.next();

  assertEquals(await a, { chunk: 1 });
  assertEquals(await b, { chunk: 2 });
  assertEquals(await c, { chunk: 3 });
});

Deno.test("AsyncQueue - supports done sentinel items", async () => {
  const queue = new AsyncQueue<number>();
  queue.push({ chunk: 1 });
  queue.push({ done: true });

  assertEquals(await queue.next(), { chunk: 1 });
  const sentinel = await queue.next();
  assert(sentinel.done);
  assertEquals(sentinel.chunk, undefined);
});

Deno.test("AsyncQueue - supports interrupt sentinels", async () => {
  const queue = new AsyncQueue<number>();
  queue.push({ isInterrupt: true });
  const item = await queue.next();
  assert(item.isInterrupt);
});

Deno.test("AsyncQueue - buffered items are drained before waiting", async () => {
  const queue = new AsyncQueue<number>();
  queue.push({ chunk: 1 });
  queue.push({ chunk: 2 });

  // Drain the buffer, then the next call must wait for a new push.
  await queue.next();
  await queue.next();

  let resolved = false;
  const pending = queue.next().then((item) => {
    resolved = true;
    return item;
  });

  // Give the microtask queue a chance to run: nothing should resolve yet.
  await Promise.resolve();
  assertEquals(resolved, false);

  queue.push({ chunk: 3 });
  assertEquals(await pending, { chunk: 3 });
});
