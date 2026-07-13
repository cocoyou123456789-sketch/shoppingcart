import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  IMAGE_UPLOAD_STATE,
  planClearedImageDrain,
  stageTrackedWardrobeImage,
  stagedImageResolution,
} from "../app/lib/wardrobe-image-lifecycle.mjs";

function deferred() {
  let resolve;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

test("generation rotation before upload reservation prevents every R2 write", async () => {
  let putCalls = 0;
  const result = await stageTrackedWardrobeImage({
    reserve: async () => false,
    put: async () => {
      putCalls += 1;
    },
    markReady: async () => assert.fail("a stale upload cannot become ready"),
    discard: async () => assert.fail("a stale upload has no object to discard"),
  });

  assert.deepEqual(result, { status: "stale" });
  assert.equal(putCalls, 0);
});

test("clear waits on an uploading lease and deterministically drains it after handoff", async () => {
  const key = "wardrobe/alice/upload-race";
  const reserved = deferred();
  const allowPutToFinish = deferred();
  const leases = new Map();
  const objects = new Set();

  const upload = stageTrackedWardrobeImage({
    reserve: async () => {
      leases.set(key, IMAGE_UPLOAD_STATE.uploading);
      reserved.resolve();
      return true;
    },
    put: async () => {
      await allowPutToFinish.promise;
      objects.add(key);
    },
    markReady: async () => {
      assert.equal(leases.get(key), IMAGE_UPLOAD_STATE.uploading);
      leases.set(key, IMAGE_UPLOAD_STATE.ready);
    },
    discard: async () => {
      objects.delete(key);
      leases.delete(key);
    },
  });

  await reserved.promise;
  const firstClear = planClearedImageDrain([{
    image_key: key,
    upload_state: leases.get(key),
    upload_abandoned: 0,
  }]);
  assert.deepEqual(firstClear, { deletableKeys: [], pendingKeys: [key] });
  assert.equal(objects.has(key), false);
  assert.equal(leases.has(key), true, "clear must preserve an active writer's lease");

  allowPutToFinish.resolve();
  assert.deepEqual(await upload, { status: "ready" });
  assert.equal(objects.has(key), true);
  assert.equal(leases.get(key), IMAGE_UPLOAD_STATE.ready);

  const replayedClear = planClearedImageDrain([{
    image_key: key,
    upload_state: leases.get(key),
    upload_abandoned: 0,
  }]);
  assert.deepEqual(replayedClear, { deletableKeys: [key], pendingKeys: [] });
  for (const deletableKey of replayedClear.deletableKeys) {
    objects.delete(deletableKey);
    leases.delete(deletableKey);
  }
  assert.equal(objects.size, 0);
  assert.equal(leases.size, 0);
});

test("failed writers become immediately drainable even when compensating deletion fails", async () => {
  const key = "wardrobe/alice/failed-upload";
  const leases = new Map();

  await assert.rejects(
    stageTrackedWardrobeImage({
      reserve: async () => {
        leases.set(key, IMAGE_UPLOAD_STATE.uploading);
        return true;
      },
      put: async () => {
        throw new Error("ambiguous R2 failure");
      },
      markReady: async () => assert.fail("failed writes cannot become ready"),
      markFailed: async () => {
        assert.equal(leases.get(key), IMAGE_UPLOAD_STATE.uploading);
        leases.set(key, IMAGE_UPLOAD_STATE.ready);
      },
      discard: async () => {
        throw new Error("R2 deletion is temporarily unavailable");
      },
    }),
    /ambiguous R2 failure/,
  );

  assert.equal(leases.get(key), IMAGE_UPLOAD_STATE.ready);
  assert.deepEqual(
    planClearedImageDrain([{
      image_key: key,
      upload_state: IMAGE_UPLOAD_STATE.ready,
      upload_abandoned: 0,
    }]),
    { deletableKeys: [key], pendingKeys: [] },
  );
});

test("an interrupted writer remains protected until its lease is provably abandoned", () => {
  const key = "wardrobe/alice/interrupted-upload";
  assert.deepEqual(
    planClearedImageDrain([{
      image_key: key,
      upload_state: IMAGE_UPLOAD_STATE.uploading,
      upload_abandoned: 0,
    }]),
    { deletableKeys: [], pendingKeys: [key] },
  );
  assert.deepEqual(
    planClearedImageDrain([{
      image_key: key,
      upload_state: IMAGE_UPLOAD_STATE.uploading,
      upload_abandoned: 1,
    }]),
    { deletableKeys: [key], pendingKeys: [] },
  );
});

test("stable item images have no active writer and remain immediately deletable", () => {
  const key = "wardrobe/alice/stable-item";
  assert.deepEqual(
    planClearedImageDrain([{
      image_key: key,
      upload_state: null,
      upload_abandoned: 0,
    }]),
    { deletableKeys: [key], pendingKeys: [] },
  );
});

test("an ambiguous committed insert never discards its authoritative image", () => {
  assert.equal(stagedImageResolution("image-new", "image-new"), "attached");
  assert.equal(stagedImageResolution("image-new", "image-other"), "discard");
  assert.equal(stagedImageResolution("image-new", null), "discard");
  assert.equal(stagedImageResolution(null, "image-other"), "none");
});

test("unknown future lease states fail closed instead of deleting a live object", () => {
  const key = "wardrobe/alice/future-state";
  assert.deepEqual(
    planClearedImageDrain([{
      image_key: key,
      upload_state: "future-protocol-state",
      upload_abandoned: 0,
    }]),
    { deletableKeys: [], pendingKeys: [key] },
  );
});

test("API wiring preserves the generation fence, lease migration, and replay barrier", async () => {
  const [wardrobeRoute, clearRoute, schema, migration] = await Promise.all([
    readFile(new URL("../app/api/wardrobe/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/personal-data/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../db/schema.ts", import.meta.url), "utf8"),
    readFile(new URL("../drizzle/0005_little_doorman.sql", import.meta.url), "utf8"),
  ]);

  assert.match(wardrobeRoute, /stageTrackedWardrobeImage/);
  assert.match(
    wardrobeRoute,
    /INSERT INTO wardrobe_image_cleanup[\s\S]*?uploading[\s\S]*?owner_data_generations[\s\S]*?requestedGeneration/,
  );
  assert.match(wardrobeRoute, /ALTER TABLE wardrobe_image_cleanup ADD COLUMN upload_state/);
  assert.match(wardrobeRoute, /SET upload_state = 'ready', created_at = CURRENT_TIMESTAMP/);
  assert.match(
    wardrobeRoute,
    /commit result is ambiguous[\s\S]*?if \(replay\)[\s\S]*?stagedImageResolution/,
  );
  assert.match(wardrobeRoute, /markFailed: markImageWriteFinished/);
  assert.doesNotMatch(wardrobeRoute, /INSERT OR REPLACE INTO wardrobe_image_cleanup/);
  assert.match(clearRoute, /planClearedImageDrain/);
  assert.match(clearRoute, /INSERT OR IGNORE INTO wardrobe_image_cleanup/);
  assert.match(clearRoute, /if \(replay\?\.status === "done"\)[\s\S]*?if \(!drained\)[\s\S]*?status: 503/);
  assert.match(clearRoute, /dataGenerationHeaders\(replay\.next_generation\)/);
  assert.match(schema, /uploadState: text\("upload_state"\)\.notNull\(\)\.default\("ready"\)/);
  assert.match(migration, /ALTER TABLE `wardrobe_image_cleanup` ADD `upload_state`/);
});
