import assert from "node:assert/strict";
import test from "node:test";
import {
  clearMutationAction,
  clearMarkerHydrationAction,
  clearMarkerStorageKey,
  clearMarkerWriteAction,
  compareClearSignals,
  clearSignalTimestamp,
  coordinationScope,
  createClearSignal,
  guardedSnapshotWrite,
  newestClearSignal,
  parseClearMarker,
  serializeCompletedClearMarker,
  serializeFailedClearMarker,
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
    status: "pending",
    completedGeneration: null,
  });
  assert.deepEqual(
    parseClearMarker(
      serializeCompletedClearMarker(
        "clear-123",
        "cloud-next",
        "2026-07-14T08:00:00.000Z",
      ),
    ),
    {
      signal: "clear-123",
      clearedAt: "2026-07-14T08:00:00.000Z",
      status: "complete",
      completedGeneration: "cloud-next",
    },
  );
  assert.deepEqual(
    parseClearMarker(
      serializeFailedClearMarker(
        "clear-123",
        "2026-07-14T08:00:00.000Z",
      ),
    ),
    {
      signal: "clear-123",
      clearedAt: "2026-07-14T08:00:00.000Z",
      status: "failed",
      completedGeneration: null,
    },
  );
  assert.deepEqual(
    parseClearMarker(JSON.stringify({
      version: 1,
      signal: "legacy-clear",
      clearedAt: "2026-07-14T08:00:00.000Z",
    })),
    {
      signal: "legacy-clear",
      clearedAt: "2026-07-14T08:00:00.000Z",
      status: "complete",
      completedGeneration: null,
    },
  );
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
  assert.equal(newestClearSignal(first, null, second, first), second);
  assert.equal(newestClearSignal(null, undefined), null);
});

test("clear marker transitions cannot roll a newer or completed boundary backward", () => {
  const olderPending = parseClearMarker(serializeClearMarker(
    createClearSignal(1_720_944_000_000, "older"),
    "2026-07-14T08:00:00.000Z",
  ));
  const newerPending = parseClearMarker(serializeClearMarker(
    createClearSignal(1_720_944_000_001, "newer"),
    "2026-07-14T08:00:01.000Z",
  ));
  const failed = parseClearMarker(serializeFailedClearMarker(
    newerPending.signal,
    newerPending.clearedAt,
  ));
  const complete = parseClearMarker(serializeCompletedClearMarker(
    newerPending.signal,
    "cloud-next",
    newerPending.clearedAt,
  ));

  assert.equal(clearMarkerWriteAction(newerPending, olderPending), "preserve-newer");
  assert.equal(clearMarkerWriteAction(olderPending, newerPending), "write");
  assert.equal(clearMarkerWriteAction(failed, newerPending), "write");
  assert.equal(clearMarkerWriteAction(complete, newerPending), "preserve-complete");
  assert.equal(clearMarkerWriteAction(newerPending, complete), "write");
  assert.equal(clearMarkerWriteAction(null, newerPending), "write");
});

test("clear marker hydration blocks pending data and preserves absorbed or future snapshots", () => {
  const pending = parseClearMarker(serializeClearMarker(
    "clear-123",
    "2026-07-14T08:00:00.000Z",
  ));
  const complete = parseClearMarker(serializeCompletedClearMarker(
    "clear-123",
    "cloud-next",
    "2026-07-14T08:00:00.000Z",
  ));
  const failed = parseClearMarker(serializeFailedClearMarker(
    "clear-123",
    "2026-07-14T08:00:00.000Z",
  ));

  assert.equal(clearMarkerHydrationAction(pending, null), "recover-pending");
  assert.equal(clearMarkerHydrationAction(failed, null), "hold-failed");
  assert.equal(
    clearMarkerHydrationAction(complete, {
      clearSignal: "clear-123",
      cloudGeneration: "cloud-next",
    }),
    "hydrate",
  );
  assert.equal(clearMarkerHydrationAction(complete, null), "reset-known");
  assert.equal(clearMarkerHydrationAction(complete, null, true), "preserve-future");
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
  assert.equal(parseClearMarker(JSON.stringify({ version: 2, signal: "x", clearedAt: "now", status: "pending" })), null);
  assert.equal(parseClearMarker(JSON.stringify({ version: 2, signal: "x", clearedAt: "2026-07-14T08:00:00.000Z", status: "complete" })), null);
  assert.equal(parseClearMarker(JSON.stringify({ version: 1, signal: "", clearedAt: "2026-07-14T08:00:00.000Z" })), null);
  assert.throws(() => serializeClearMarker(""), /clear signal/i);
});
