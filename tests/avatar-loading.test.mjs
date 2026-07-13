import assert from "node:assert/strict";
import test from "node:test";
import { avatarLoadPolicy } from "../app/lib/avatar-loading.mjs";

test("avatar loading policy protects slow networks while preserving user override", () => {
  assert.deepEqual(
    avatarLoadPolicy({ priority: true, saveData: true }),
    { mode: "pause", reason: "network", delayMs: 0 },
  );
  assert.deepEqual(
    avatarLoadPolicy({ priority: true, effectiveType: "2g" }),
    { mode: "pause", reason: "network", delayMs: 0 },
  );
  assert.deepEqual(
    avatarLoadPolicy({ forceLoad: true, saveData: true, effectiveType: "slow-2g" }),
    { mode: "immediate", reason: null, delayMs: 0 },
  );
});

test("resource-constrained devices keep home 3D opt-in but load the studio", () => {
  for (const constraints of [{ deviceMemory: 4 }, { hardwareConcurrency: 4 }]) {
    assert.deepEqual(
      avatarLoadPolicy(constraints),
      { mode: "pause", reason: "device", delayMs: 0 },
    );
    assert.deepEqual(
      avatarLoadPolicy({ ...constraints, priority: true }),
      { mode: "immediate", reason: null, delayMs: 0 },
    );
  }
});

test("ordinary and 3g connections defer non-priority 3D by the right amount", () => {
  assert.deepEqual(
    avatarLoadPolicy({ effectiveType: "4g", deviceMemory: 8, hardwareConcurrency: 8 }),
    { mode: "defer", reason: null, delayMs: 800 },
  );
  assert.deepEqual(
    avatarLoadPolicy({ effectiveType: "3g", deviceMemory: 8, hardwareConcurrency: 8 }),
    { mode: "defer", reason: null, delayMs: 1_800 },
  );
});
