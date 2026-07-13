import assert from "node:assert/strict";
import test from "node:test";
import {
  hasPendingWardrobeItems,
  removeWardrobeIdentity,
  replaceSyncedWardrobeItem,
} from "../app/lib/wardrobe-sync.mjs";
import { isClientWardrobeId, wardrobeCloudId } from "../app/lib/wardrobe-id.mjs";

test("pending wardrobe detection ignores samples and known cloud items", () => {
  const wardrobe = [
    { id: "sample", source: "示例衣物" },
    { id: "cloud", source: "我的衣服" },
    { id: "local", source: "我的衣服" },
  ];
  assert.equal(hasPendingWardrobeItems(wardrobe, new Set(["cloud"])), true);
  assert.equal(hasPendingWardrobeItems(wardrobe.slice(0, 2), new Set(["cloud"])), false);
});

test("a client tombstone removes local and cloud copies plus every try-on reference", () => {
  const result = removeWardrobeIdentity(
    [
      { id: "local", clientId: undefined },
      { id: "cloud", clientId: "local" },
      { id: "keep", clientId: "keep-client" },
    ],
    { topId: "local", bottomId: "cloud", dressId: "keep", outerwearId: "cloud" },
    "local",
    ["cloud"],
  );
  assert.deepEqual(result.wardrobe, [{ id: "keep", clientId: "keep-client" }]);
  assert.deepEqual(result.outfit, {
    topId: undefined,
    bottomId: undefined,
    dressId: "keep",
    outerwearId: undefined,
  });
});

test("a synced cloud item replaces its local draft without breaking try-on", () => {
  const local = { id: "local", name: "本机上衣", source: "我的衣服" };
  const cloud = { id: "cloud", name: "本机上衣", source: "我的衣服", imageUrl: "/private" };
  const existingCloud = { id: "cloud", name: "旧副本", source: "我的衣服" };
  const untouched = { id: "bottom", name: "裤子", source: "我的衣服" };
  const result = replaceSyncedWardrobeItem(
    [local, existingCloud, untouched],
    { topId: "local", bottomId: "bottom", outerwearId: "coat" },
    "local",
    cloud,
  );
  assert.deepEqual(result.wardrobe, [cloud, untouched]);
  assert.deepEqual(result.outfit, {
    topId: "cloud",
    bottomId: "bottom",
    dressId: undefined,
    outerwearId: "coat",
  });
  assert.equal(result.applied, true);
});

test("a completed upload cannot reinsert a local item removed while it was pending", () => {
  const wardrobe = [{ id: "bottom", source: "我的衣服" }];
  const outfit = { bottomId: "bottom" };
  const result = replaceSyncedWardrobeItem(
    wardrobe,
    outfit,
    "already-removed",
    { id: "cloud", source: "我的衣服" },
  );
  assert.equal(result.applied, false);
  assert.equal(result.wardrobe, wardrobe);
  assert.equal(result.outfit, outfit);
});

test("cloud ids are stable per owner without trusting the client id directly", async () => {
  const clientId = "w-123e4567-e89b-42d3-a456-426614174000";
  assert.equal(isClientWardrobeId(clientId), true);
  const first = await wardrobeCloudId("Alice@Example.com", clientId);
  const replay = await wardrobeCloudId("alice@example.com", clientId);
  const otherOwner = await wardrobeCloudId("bob@example.com", clientId);
  assert.match(first, /^w-[0-9a-f-]{36}$/);
  assert.equal(first, replay);
  assert.notEqual(first, clientId);
  assert.notEqual(first, otherOwner);
  assert.equal(await wardrobeCloudId("alice@example.com", "w-client-controlled"), null);
});
