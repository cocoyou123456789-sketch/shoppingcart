import assert from "node:assert/strict";
import test from "node:test";
import {
  humanBoneScale,
  humanDeformationProfile,
  mapHumanY,
} from "../app/lib/human-avatar-deformation.mjs";

const DEFAULT_METRICS = {
  height: 165,
  weight: 58,
  shoulder: 40,
  chest: 90,
  waist: 74,
  hips: 96,
  torso: 50,
  legs: 82,
  bodyShape: "hourglass",
};

test("lower weight slims the human face, arms, legs, waist and hips", () => {
  const current = humanDeformationProfile(DEFAULT_METRICS);
  const lighter = humanDeformationProfile({ ...DEFAULT_METRICS, weight: 48 });
  assert.ok(lighter.face < current.face);
  assert.ok(lighter.limb < current.limb);
  assert.ok(lighter.chest < current.chest);
  assert.ok(lighter.waist < current.waist);
  assert.ok(lighter.hips < current.hips);

  for (const [bone, y, mesh] of [
    ["head", 1.61, "mesh_Head"],
    ["lowerarm_l", 1.05, "mesh_Body"],
    ["thigh_l", 0.84, "mesh_Body"],
  ]) {
    const currentScale = humanBoneScale(current, bone, y, mesh);
    const lighterScale = humanBoneScale(lighter, bone, y, mesh);
    assert.ok(lighterScale.x < currentScale.x, `${bone} must become narrower`);
    assert.ok(lighterScale.z < currentScale.z, `${bone} must become shallower`);
  }
  assert.equal(lighter.body.totalHeight, current.body.totalHeight);
});

test("human landmark mapping preserves the requested height and foot contact", () => {
  const shortTorso = humanDeformationProfile({
    ...DEFAULT_METRICS,
    torso: 42,
    legs: 94,
  });
  const longTorso = humanDeformationProfile({
    ...DEFAULT_METRICS,
    torso: 58,
    legs: 72,
  });
  assert.equal(mapHumanY(0, shortTorso.body), 0);
  assert.equal(mapHumanY(0, longTorso.body), 0);
  assert.equal(mapHumanY(1.721, shortTorso.body), shortTorso.body.totalHeight);
  assert.equal(mapHumanY(1.721, longTorso.body), longTorso.body.totalHeight);
  assert.ok(
    mapHumanY(0.92, shortTorso.body) > mapHumanY(0.92, longTorso.body),
    "longer legs move the crotch landmark upward",
  );
});

test("human deformation stays finite and bounded for damaged measurements", () => {
  const deformation = humanDeformationProfile({
    height: Infinity,
    weight: Number.NaN,
    shoulder: -1e100,
    chest: 1e100,
    waist: "broken",
    hips: null,
    bodyShape: "__proto__",
  });
  for (const value of [
    deformation.face,
    deformation.shoulder,
    deformation.chest,
    deformation.waist,
    deformation.hips,
    deformation.limb,
  ]) {
    assert.ok(Number.isFinite(value));
    assert.ok(value >= 0.68 && value <= 1.45);
  }
  for (const bone of ["head", "upperarm_l", "thigh_r", "spine_02"]) {
    const scale = humanBoneScale(deformation, bone, 1.2, "mesh_Body");
    assert.ok(Number.isFinite(scale.x));
    assert.ok(Number.isFinite(scale.z));
    assert.ok(Number.isFinite(scale.zOffset));
  }
});
