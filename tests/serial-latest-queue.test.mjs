import assert from "node:assert/strict";
import test from "node:test";
import { createSerialLatestQueue } from "../app/lib/serial-latest-queue.mjs";

function deferred() {
  let resolve;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

test("profile saves stay serial and coalesce waiting edits to the latest value", async () => {
  const releases = [deferred(), deferred()];
  const started = [];
  let active = 0;
  let maximumActive = 0;
  const queue = createSerialLatestQueue(async (value) => {
    const index = started.length;
    started.push(value);
    active += 1;
    maximumActive = Math.max(maximumActive, active);
    await releases[index].promise;
    active -= 1;
  });

  const completed = queue.enqueue("A");
  queue.enqueue("B");
  queue.enqueue("C");
  assert.deepEqual(started, ["A"]);
  assert.equal(queue.pending, true);

  releases[0].resolve();
  await Promise.resolve();
  await Promise.resolve();
  assert.deepEqual(started, ["A", "C"]);
  assert.equal(maximumActive, 1);

  releases[1].resolve();
  await completed;
  assert.equal(queue.running, false);
  assert.equal(queue.pending, false);
});

test("a failed profile save stops queued requests without creating overlap", async () => {
  const release = deferred();
  const started = [];
  const queue = createSerialLatestQueue(async (value) => {
    started.push(value);
    await release.promise;
    return false;
  });

  const completed = queue.enqueue("old");
  queue.enqueue("new");
  release.resolve();
  await completed;

  assert.deepEqual(started, ["old"]);
  assert.equal(queue.running, false);
  assert.equal(queue.pending, false);
});
