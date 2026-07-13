import assert from "node:assert/strict";
import test from "node:test";
import {
  clearMutationAction,
  clearMarkerStorageKey,
  compareClearSignals,
  clearSignalTimestamp,
  coordinationScope,
  createClearSignal,
  guardedSnapshotWrite,
  parseClearMarker,
  serializeClearMarker,
  snapshotMatchesClearSignal,
} from "../app/lib/storage-coordination.mjs";

test("a stale clear never rebases itself onto a newer cloud generation", () => {
  assert.equal(clearMutationAction(204, "initial", "cloud-next"), "complete");
  assert.equal(clearMutationAction(409, "initial", "cloud-next"), "stale");
  assert.notEqual(clearMutationAction(409, "initial", "cloud-next"), "retry");
  assert.equal(clearMutationAction(503, "initial", "cloud-next"), "failed");
});

test("clear markers are owner-keyed, validated, and generation-safe", () => {
  assert.equal(
    clearMarkerStorageKey("songsong:owner:alice"),
    "songsong:owner:alice:clear-marker",
  );
  assert.equal(coordinationScope("songsong:owner:alice"), coordinationScope("songsong:owner:alice"));
  assert.notEqual(coordinationScope("songsong:owner:alice"), coordinationScope("songsong:owner:bob"));
  assert.doesNotMatch(coordinationScope("songsong:owner:alice@example.com"), /alice|example/i);
  const raw = serializeClearMarker("clear-123", "2026-07-14T08:00:00.000Z");
  assert.deepEqual(parseClearMarker(raw), {
    signal: "clear-123",
    clearedAt: "2026-07-14T08:00:00.000Z",
  });
  assert.equal(snapshotMatchesClearSignal("clear-123", "clear-123"), true);
  assert.equal(snapshotMatchesClearSignal(null, null), true);
  assert.equal(snapshotMatchesClearSignal(null, "clear-123"), false);
  assert.equal(snapshotMatchesClearSignal("old", "clear-123"), false);
});

test("clear signals carry a sortable local generation without exposing personal data", () => {
  const first = createClearSignal(1_720_944_000_000, "first");
  const second = createClearSignal(1_720_944_000_001, "second");
  assert.equal(clearSignalTimestamp(first), 1_720_944_000_000);
  assert.equal(clearSignalTimestamp(second), 1_720_944_000_001);
  assert.ok(second.localeCompare(first) > 0);
  assert.ok(compareClearSignals(second, first) > 0);
  assert.ok(compareClearSignals(first, second) < 0);
  assert.equal(compareClearSignals(first, first), 0);
  const sameTimeA = createClearSignal(1_720_944_000_001, "aaa");
  const sameTimeB = createClearSignal(1_720_944_000_001, "bbb");
  assert.ok(compareClearSignals(sameTimeB, sameTimeA) > 0);
  assert.ok(compareClearSignals(second, "legacy-clear") > 0);
  assert.equal(clearSignalTimestamp("initial"), null);
});

test("old debounce and pagehide callbacks cannot restore a cleared snapshot", () => {
  const writes = [];
  const staleWrite = () => guardedSnapshotWrite("before-clear", "after-clear", () => {
    writes.push("old personal snapshot");
    return "complete";
  });
  assert.equal(staleWrite(), "superseded");
  assert.equal(staleWrite(), "superseded");
  assert.deepEqual(writes, []);
  assert.equal(
    guardedSnapshotWrite("after-clear", "after-clear", () => {
      writes.push("new empty snapshot");
      return "complete";
    }),
    "complete",
  );
  assert.deepEqual(writes, ["new empty snapshot"]);
});

test("malformed clear markers cannot invalidate a snapshot", () => {
  assert.equal(parseClearMarker("not-json"), null);
  assert.equal(parseClearMarker(JSON.stringify({ version: 2, signal: "x", clearedAt: "now" })), null);
  assert.equal(parseClearMarker(JSON.stringify({ version: 1, signal: "", clearedAt: "2026-07-14T08:00:00.000Z" })), null);
  assert.throws(() => serializeClearMarker(""), /clear signal/i);
});
