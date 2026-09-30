import assert from "node:assert/strict";
import test from "node:test";
import { KeyedMutex } from "../src/lib/keyed-mutex.js";

const tick = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

test("work for one key never overlaps and keeps arrival order", async () => {
  const mutex = new KeyedMutex();
  const log: string[] = [];
  const job = (name: string, ms: number) =>
    mutex.run("repo", async () => {
      log.push(`start ${name}`);
      await tick(ms);
      log.push(`end ${name}`);
      return name;
    });
  const results = await Promise.all([job("a", 20), job("b", 1), job("c", 1)]);
  assert.deepEqual(results, ["a", "b", "c"]);
  assert.deepEqual(log, ["start a", "end a", "start b", "end b", "start c", "end c"]);
});

test("different keys run concurrently", async () => {
  const mutex = new KeyedMutex();
  let running = 0;
  let peak = 0;
  const job = (key: string) =>
    mutex.run(key, async () => {
      running++;
      peak = Math.max(peak, running);
      await tick(15);
      running--;
    });
  await Promise.all([job("one"), job("two"), job("three")]);
  assert.equal(peak, 3);
});

test("a failing job releases the lock and does not poison later work", async () => {
  const mutex = new KeyedMutex();
  await assert.rejects(
    mutex.run("k", async () => {
      throw new Error("boom");
    }),
    /boom/,
  );
  assert.equal(await mutex.run("k", async () => "ok"), "ok");
  assert.equal(mutex.size, 0, "idle keys are cleaned up");
});
