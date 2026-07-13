import assert from "node:assert/strict";
import test from "node:test";
import {
  AVATAR_AUTO_ROTATE_MS,
  AVATAR_MAX_PHYSICAL_PIXELS,
  avatarAriaDescription,
  avatarGeometryDetail,
  avatarPixelRatio,
  avatarZoomPercent,
  cancelVisibleTimeBudget,
  createVisibleTimeBudget,
  disposeUniqueResources,
  pauseVisibleTimeBudget,
  replaceRuntimeAvatar,
  resumeVisibleTimeBudget,
} from "../app/lib/avatar-runtime.mjs";

test("avatar updates preserve the renderer and dispose only the replaced model", () => {
  const calls = [];
  const renderer = { shadowMap: { needsUpdate: false } };
  const oldAvatar = { id: "old" };
  const nextAvatar = { id: "next" };
  const runtime = {
    renderer,
    avatar: oldAvatar,
    scene: {
      add(value) { calls.push(["add", value.id]); },
      remove(value) { calls.push(["remove", value.id]); },
    },
  };

  const removed = replaceRuntimeAvatar(runtime, nextAvatar, (value) => {
    calls.push(["dispose", value.id]);
  });

  assert.equal(runtime.renderer, renderer);
  assert.equal(runtime.avatar, nextAvatar);
  assert.equal(removed, oldAvatar);
  assert.equal(renderer.shadowMap.needsUpdate, true);
  assert.deepEqual(calls, [
    ["add", "next"],
    ["remove", "old"],
    ["dispose", "old"],
  ]);
});

test("avatar auto-rotation has a bounded cumulative visible-time budget", () => {
  assert.ok(AVATAR_AUTO_ROTATE_MS <= 5_000);
  const budget = createVisibleTimeBudget(AVATAR_AUTO_ROTATE_MS);

  assert.equal(resumeVisibleTimeBudget(budget, 0), 4_500);
  assert.equal(pauseVisibleTimeBudget(budget, 1_000), 3_500);
  assert.equal(pauseVisibleTimeBudget(budget, 101_000), 3_500, "hidden time is free");
  assert.equal(resumeVisibleTimeBudget(budget, 101_000), 3_500);
  assert.equal(pauseVisibleTimeBudget(budget, 103_000), 1_500);
  assert.equal(resumeVisibleTimeBudget(budget, 203_000), 1_500);
  assert.equal(pauseVisibleTimeBudget(budget, 204_500), 0);
  assert.equal(resumeVisibleTimeBudget(budget, 300_000), 0, "an exhausted budget never restarts");
});

test("user interaction permanently cancels the remaining rotation budget", () => {
  const budget = createVisibleTimeBudget(AVATAR_AUTO_ROTATE_MS);
  resumeVisibleTimeBudget(budget, 0);
  pauseVisibleTimeBudget(budget, 800);
  assert.equal(cancelVisibleTimeBudget(budget), 0);
  assert.equal(resumeVisibleTimeBudget(budget, 10_000), 0);
});

test("avatar quality tiers reduce geometry and obey a physical-pixel ceiling", () => {
  const full = avatarGeometryDetail(false);
  const reduced = avatarGeometryDetail(true);
  assert.ok(reduced.head[0] < full.head[0]);
  assert.ok(reduced.capsule[1] < full.capsule[1]);
  assert.ok(reduced.floor < full.floor);

  const width = 560;
  const height = 692;
  const ratio = avatarPixelRatio(width, height, 2, false);
  assert.ok(width * height * ratio ** 2 <= AVATAR_MAX_PHYSICAL_PIXELS + 1);
  assert.ok(ratio < 2);
  assert.equal(avatarPixelRatio(width, height, 3, true), 1.25);
  assert.equal(avatarPixelRatio(width, height, 1, false), 1);

  const oversizedWidth = 2_000;
  const oversizedHeight = 1_000;
  const oversizedRatio = avatarPixelRatio(oversizedWidth, oversizedHeight, 2, false);
  assert.ok(oversizedRatio < 1, "large canvases may render below CSS resolution");
  assert.ok(
    oversizedWidth * oversizedHeight * oversizedRatio ** 2 <=
      AVATAR_MAX_PHYSICAL_PIXELS + 1,
  );
});

test("avatar resource disposal de-duplicates resources and preserves the retained pool", () => {
  const dynamic = { id: "dynamic" };
  const retained = { id: "retained" };
  const replacementDisposals = [];

  assert.equal(
    disposeUniqueResources(
      [dynamic, dynamic, retained],
      [retained],
      (resource) => replacementDisposals.push(resource.id),
    ),
    1,
  );
  assert.deepEqual(replacementDisposals, ["dynamic"]);

  const teardownDisposals = [];
  disposeUniqueResources(
    [dynamic, dynamic, retained],
    [retained],
    (resource) => teardownDisposals.push(resource.id),
  );
  disposeUniqueResources(
    [retained, retained],
    [],
    (resource) => teardownDisposals.push(resource.id),
  );
  assert.deepEqual(teardownDisposals, ["dynamic", "retained"]);
});

test("avatar zoom percentage is stable, bounded, and resilient to invalid input", () => {
  assert.equal(avatarZoomPercent(9, 9), 100);
  assert.equal(avatarZoomPercent(9, 6), 150);
  assert.equal(avatarZoomPercent(9, 12), 75);
  assert.equal(avatarZoomPercent(9, 100), 50);
  assert.equal(avatarZoomPercent(9, 1), 200);
  assert.equal(avatarZoomPercent(Number.NaN, Number.NaN), 100);
  assert.equal(avatarZoomPercent(Number.NaN, 9), 100);
});

test("avatar alternative text reflects body shape and selected garment categories", () => {
  const description = avatarAriaDescription(
    { height: 168, bodyShape: "pear" },
    { top: {}, bottom: {}, outerwear: {} },
  );
  assert.match(description, /168 厘米/);
  assert.match(description, /梨型/);
  assert.match(description, /上装、下装、外套/);
  assert.match(description, /正面、侧面和背面/);
  assert.match(description, /放大或缩小/);
});
