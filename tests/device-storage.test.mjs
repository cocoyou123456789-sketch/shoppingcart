import assert from "node:assert/strict";
import test from "node:test";
import {
  deviceGenerationAction,
  guardKnownDeviceSnapshotWrite,
  hasUnsupportedDeviceSnapshotVersion,
  parseDeviceSnapshot,
  preservePersistedPhotos,
  readDeviceSnapshotEnvelope,
  resolveHydratedProfile,
  restoreItemsInStoredOrder,
  serializeDeviceSnapshot,
} from "../app/lib/device-storage.mjs";

test("device snapshots preserve every personal field through a JSON round trip", () => {
  const snapshot = {
    wardrobe: [{
      id: "local-shirt",
      clientId: "local-shirt",
      name: "我的衬衫",
      category: "上装",
      color: "#d7dff0",
      colorName: "雾霾蓝",
      size: "M",
      source: "我的衣服",
      sourceUrl: "https://example.test/shirt",
      imageUrl: "data:image/jpeg;base64,PHOTO",
      season: "春秋",
      style: "轻松",
      chest: 102,
      waist: 88,
      hips: 100,
      length: 67,
      confidence: "高",
    }],
    metrics: {
      height: 171,
      weight: 63,
      shoulder: 42,
      chest: 94,
      waist: 77,
      hips: 101,
      torso: 51,
      legs: 84,
      skinTone: "#c98e68",
      bodyShape: "pear",
    },
    outfit: {
      topId: "local-shirt",
      bottomId: "bottom",
      dressId: "dress",
      outerwearId: "coat",
    },
    mood: 74,
    cartProductIds: ["p-coat", "p-knit"],
    savedProductIds: ["p-dress", "p-shoes"],
    cloudItemIds: ["cloud-shirt"],
    cloudGeneration: "generation-7",
    deletedWardrobeClientIds: ["local-deleted"],
    dailyPreferences: {
      weather: "下雨",
      occasion: "上课",
      feeling: "温柔",
      comfort: "保暖",
    },
    profilePending: true,
  };
  const raw = serializeDeviceSnapshot(
    snapshot,
    "clear-signal",
    "2026-07-14T10:00:00.000Z",
  );

  assert.deepEqual(parseDeviceSnapshot(raw), {
    version: 1,
    ...snapshot,
    clearSignal: "clear-signal",
    updatedAt: "2026-07-14T10:00:00.000Z",
  });
});

test("device snapshot parsing accepts legacy v1 data but rejects future schemas", () => {
  assert.deepEqual(parseDeviceSnapshot('{"wardrobe":[],"metrics":{}}'), {
    wardrobe: [],
    metrics: {},
  });
  assert.equal(parseDeviceSnapshot('{"version":2,"wardrobe":[],"metrics":{}}'), null);
  assert.equal(
    hasUnsupportedDeviceSnapshotVersion('{"version":2,"wardrobe":[],"metrics":{}}'),
    true,
  );
  assert.equal(hasUnsupportedDeviceSnapshotVersion('{"wardrobe":[],"metrics":{}}'), false);
  assert.equal(parseDeviceSnapshot("[1,2,3]"), null);
  assert.equal(parseDeviceSnapshot("{"), null);
});

test("future snapshot envelopes retain their cloud generation without exposing product data", () => {
  const raw = '{"version":2,"cloudGeneration":"generation-9","clearSignal":"clear-8","futureField":{"private":true}}';
  assert.deepEqual(readDeviceSnapshotEnvelope(raw), {
    version: 2,
    cloudGeneration: "generation-9",
    clearSignal: "clear-8",
  });
  assert.equal(
    deviceGenerationAction("generation-9", "generation-9", true),
    "keep",
  );
  assert.equal(
    deviceGenerationAction("generation-8", "generation-9", true),
    "preserve-future",
  );
  assert.equal(
    deviceGenerationAction("generation-8", "generation-9", false),
    "reset-known",
  );
});

test("an older tab refuses a future snapshot that appeared after hydration", () => {
  let raw = '{"version":1,"metrics":{"height":165}}';
  let writes = 0;
  raw = '{"version":2,"metrics":{"height":172},"futureField":true}';

  const result = guardKnownDeviceSnapshotWrite(
    () => raw,
    () => {
      writes += 1;
      raw = '{"version":1,"metrics":{"height":160}}';
      return "complete";
    },
  );

  assert.equal(result, "incompatible");
  assert.equal(writes, 0);
  assert.equal(raw, '{"version":2,"metrics":{"height":172},"futureField":true}');
});

test("a snapshot write fails closed when the live schema cannot be read", () => {
  let writes = 0;
  const result = guardKnownDeviceSnapshotWrite(
    () => {
      throw new Error("storage unavailable");
    },
    () => {
      writes += 1;
      return "complete";
    },
  );
  assert.equal(result, "unavailable");
  assert.equal(writes, 0);
});

test("catalogue items restore in saved order without duplicates or removed IDs", () => {
  const catalogue = [
    { id: "p-knit", name: "针织衫" },
    { id: "p-coat", name: "风衣" },
    { id: "p-dress", name: "连衣裙" },
  ];
  assert.deepEqual(
    restoreItemsInStoredOrder(
      ["p-coat", "missing", "p-knit", "p-coat"],
      catalogue,
    ),
    [catalogue[1], catalogue[0]],
  );
});

test("pending device profile edits win over stale cloud metrics until saved", () => {
  const defaults = { height: 165, waist: 74 };
  const local = { height: 172, waist: 79 };
  const cloud = { height: 160, waist: 70 };
  assert.deepEqual(
    resolveHydratedProfile({ defaults, local, cloud, profilePending: true }),
    { metrics: local, profilePending: true, source: "local" },
  );
  assert.deepEqual(
    resolveHydratedProfile({ defaults, local: cloud, cloud, profilePending: true }),
    { metrics: cloud, profilePending: false, source: "cloud" },
  );
  assert.deepEqual(
    resolveHydratedProfile({ defaults, local, cloud, profilePending: false }),
    { metrics: cloud, profilePending: false, source: "cloud" },
  );
  assert.deepEqual(
    resolveHydratedProfile({ defaults, local, cloud }),
    { metrics: local, profilePending: true, source: "local" },
  );
  assert.deepEqual(
    resolveHydratedProfile({ defaults, local, cloud: null }),
    { metrics: local, profilePending: true, source: "local" },
  );
  assert.deepEqual(
    resolveHydratedProfile({ defaults, local: defaults, cloud: null }),
    { metrics: defaults, profilePending: false, source: "local" },
  );
  assert.deepEqual(
    resolveHydratedProfile({ defaults, local: defaults, cloud }),
    { metrics: cloud, profilePending: false, source: "cloud" },
  );
});

test("quota fallback preserves old photos and omits only unpersisted local photos", () => {
  const previousRaw = JSON.stringify({
    wardrobe: [
      { id: "old", name: "旧衣服", imageUrl: "data:image/jpeg;base64,OLD" },
      { id: "deleted", name: "已删除", imageUrl: "data:image/jpeg;base64,DELETED" },
    ],
  });
  const next = preservePersistedPhotos([
    { id: "old", name: "旧衣服", imageUrl: "data:image/jpeg;base64,NEW-TOO-LARGE" },
    { id: "new", name: "新衣服", imageUrl: "data:image/jpeg;base64,NEW" },
    { id: "cloud", name: "云端衣服", imageUrl: "/api/wardrobe/image?id=cloud" },
  ], previousRaw);

  assert.equal(next[0].imageUrl, "data:image/jpeg;base64,OLD");
  assert.equal(next[1].imageUrl, undefined);
  assert.equal(next[2].imageUrl, "/api/wardrobe/image?id=cloud");
  assert.equal(next.some((item) => item.id === "deleted"), false);
});

test("quota fallback safely handles malformed previous storage", () => {
  const [item] = preservePersistedPhotos(
    [{ id: "new", imageUrl: "blob:https://example.test/photo" }],
    "{",
  );
  assert.equal(item.imageUrl, undefined);
});
