import assert from "node:assert/strict";
import test from "node:test";
import { preservePersistedPhotos } from "../app/lib/device-storage.mjs";

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
