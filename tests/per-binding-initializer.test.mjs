import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { createPerBindingInitializer } from "../app/lib/per-binding-initializer.mjs";

function deferred() {
  let resolve;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

test("concurrent schema initialization shares one promise per binding", async () => {
  const gate = deferred();
  const binding = {};
  let calls = 0;
  const ensure = createPerBindingInitializer(async (receivedBinding) => {
    calls += 1;
    assert.equal(receivedBinding, binding);
    await gate.promise;
  });

  const first = ensure(binding);
  const second = ensure(binding);
  assert.equal(first, second);
  await Promise.resolve();
  assert.equal(calls, 1);

  gate.resolve();
  await first;
  assert.equal(ensure(binding), first, "a successful initializer stays cached");
  assert.equal(calls, 1);
});

test("different D1 bindings initialize independently", async () => {
  const calls = [];
  const ensure = createPerBindingInitializer(async (binding) => {
    calls.push(binding);
  });
  const firstBinding = {};
  const secondBinding = {};

  const first = ensure(firstBinding);
  const second = ensure(secondBinding);
  assert.notEqual(first, second);
  await Promise.all([first, second]);
  assert.deepEqual(calls, [firstBinding, secondBinding]);
});

test("a failed initializer is evicted and the next request can retry", async () => {
  const binding = {};
  let attempts = 0;
  const ensure = createPerBindingInitializer(async () => {
    attempts += 1;
    if (attempts === 1) throw new Error("temporary D1 startup failure");
  });

  const failed = ensure(binding);
  assert.equal(ensure(binding), failed, "concurrent callers share the failure");
  await assert.rejects(failed, /temporary D1 startup failure/);

  const retry = ensure(binding);
  assert.notEqual(retry, failed);
  await retry;
  assert.equal(attempts, 2);
  assert.equal(ensure(binding), retry);
});

test("all runtime schema entry points use the per-binding initializer", async () => {
  const [wardrobe, profile, dataGeneration, personalClear] = await Promise.all([
    readFile(new URL("../app/api/wardrobe/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/profile/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/lib/data-generation.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/personal-data/route.ts", import.meta.url), "utf8"),
  ]);

  assert.match(wardrobe, /ensureWardrobeTables = createPerBindingInitializer/);
  assert.match(profile, /ensureProfileTable = createPerBindingInitializer/);
  assert.match(dataGeneration, /ensureDataGenerationTable = createPerBindingInitializer/);
  assert.match(personalClear, /ensureClearTables = createPerBindingInitializer/);
  assert.match(wardrobe, /ALTER TABLE wardrobe_image_cleanup ADD COLUMN upload_state/);
  assert.match(profile, /ALTER TABLE body_profiles ADD COLUMN revision/);
});
