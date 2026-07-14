import assert from "node:assert/strict";
import test from "node:test";
import {
  avatarBodyProfile,
  avatarCameraFit,
} from "../app/lib/avatar-geometry.mjs";

const DEFAULT_METRICS = {
  height: 168,
  weight: 60,
  shoulder: 40,
  chest: 90,
  waist: 72,
  hips: 94,
  torso: 50,
  legs: 82,
};

function numericLeaves(value, path = "profile") {
  if (typeof value === "number") return [[path, value]];
  if (Array.isArray(value)) {
    return value.flatMap((item, index) => numericLeaves(item, `${path}[${index}]`));
  }
  if (value && typeof value === "object") {
    return Object.entries(value).flatMap(([key, item]) => numericLeaves(item, `${path}.${key}`));
  }
  return [];
}

test("avatar body profile stays finite, ordered, and bounded for hostile measurements", () => {
  const cases = [
    DEFAULT_METRICS,
    { height: 145, weight: 38, shoulder: 32, chest: 72, waist: 56, hips: 76, torso: 42, legs: 72 },
    { height: 195, weight: 120, shoulder: 52, chest: 126, waist: 118, hips: 132, torso: 58, legs: 94 },
    { height: Number.NaN, weight: Infinity, shoulder: -1e9, chest: "bad", waist: null, hips: 1e9, torso: -Infinity, legs: undefined },
  ];

  for (const metrics of cases) {
    const profile = avatarBodyProfile(metrics);
    for (const [path, value] of numericLeaves(profile)) {
      assert.ok(Number.isFinite(value), `${path} must be finite`);
    }
    assert.ok(profile.heightScale >= 130 / 168 && profile.heightScale <= 210 / 168);
    assert.ok(profile.totalHeight >= 4.9 && profile.totalHeight <= 8.01);
    assert.ok(profile.widths.shoulder >= 0.62 && profile.widths.shoulder <= 1.32);
    assert.ok(profile.widths.chest >= 0.5 && profile.widths.chest <= 1.32);
    assert.ok(profile.widths.waist >= 0.4 && profile.widths.waist <= 1.28);
    assert.ok(profile.widths.hips >= 0.54 && profile.widths.hips <= 1.34);
    assert.ok(profile.widths.limb >= 0.12 && profile.widths.limb <= 0.25);

    const { joints } = profile;
    assert.ok(0 < joints.ankle);
    assert.ok(joints.ankle < joints.knee);
    assert.ok(joints.knee < joints.crotch);
    assert.ok(joints.crotch < joints.hip);
    assert.ok(joints.hip < joints.waist);
    assert.ok(joints.waist < joints.chest);
    assert.ok(joints.chest < joints.shoulder);
    assert.ok(joints.shoulder < joints.neckBase);
    assert.ok(joints.neckBase < joints.headCenter);
    assert.ok(joints.headCenter < joints.headTop);
    assert.equal(joints.headTop, profile.totalHeight);
    assert.ok(joints.wrist < joints.elbow && joints.elbow < joints.shoulder);

    assert.equal(profile.torsoRings.length, 12);
    for (let index = 0; index < profile.torsoRings.length; index += 1) {
      const ring = profile.torsoRings[index];
      assert.ok(ring.xRadius > 0 && ring.zRadius > 0);
      if (index > 0) {
        const previous = profile.torsoRings[index - 1];
        assert.ok(previous.y < ring.y, `ring ${index} must be above its predecessor`);
        assert.ok(Math.abs(ring.xRadius - previous.xRadius) < 0.72, "adjacent rings stay continuous");
        assert.ok(Math.abs(ring.zRadius - previous.zRadius) < 0.72, "adjacent depths stay continuous");
      }
    }
  }
});

test("height and each width measurement have monotonic, bounded influence", () => {
  const shorter = avatarBodyProfile({ ...DEFAULT_METRICS, height: 150 });
  const taller = avatarBodyProfile({ ...DEFAULT_METRICS, height: 190 });
  assert.ok(taller.heightScale > shorter.heightScale);
  assert.ok(taller.totalHeight > shorter.totalHeight);
  assert.ok(taller.joints.headTop > shorter.joints.headTop);

  const monotonicCases = [
    ["shoulder", "shoulder", 34, 50],
    ["chest", "chest", 72, 126],
    ["waist", "waist", 56, 118],
    ["hips", "hips", 76, 132],
  ];
  for (const [metric, width, low, high] of monotonicCases) {
    const narrow = avatarBodyProfile({ ...DEFAULT_METRICS, [metric]: low });
    const wide = avatarBodyProfile({ ...DEFAULT_METRICS, [metric]: high });
    assert.ok(wide.widths[width] > narrow.widths[width], `${metric} must widen its body region`);
  }

  const light = avatarBodyProfile({ ...DEFAULT_METRICS, weight: 45 });
  const heavy = avatarBodyProfile({ ...DEFAULT_METRICS, weight: 100 });
  assert.ok(heavy.widths.limb > light.widths.limb);
  assert.ok(heavy.widths.chest > light.widths.chest);
  assert.ok(heavy.widths.waist > light.widths.waist);
  assert.ok(heavy.widths.hips > light.widths.hips);
});

test("five female body-shape cues stay subtle and preserve the expected relative silhouette", () => {
  const profiles = Object.fromEntries(
    ["straight", "pear", "hourglass", "inverted", "apple"].map((bodyShape) => [
      bodyShape,
      avatarBodyProfile({ ...DEFAULT_METRICS, bodyShape }),
    ]),
  );

  assert.ok(profiles.pear.widths.hips > profiles.straight.widths.hips);
  assert.ok(profiles.pear.widths.shoulder < profiles.straight.widths.shoulder);
  assert.ok(profiles.pear.widths.chest < profiles.straight.widths.chest);

  assert.ok(profiles.hourglass.widths.waist < profiles.straight.widths.waist);
  assert.ok(profiles.hourglass.widths.chest > profiles.straight.widths.chest);
  assert.ok(profiles.hourglass.widths.hips > profiles.straight.widths.hips);

  assert.ok(profiles.inverted.widths.shoulder > profiles.straight.widths.shoulder);
  assert.ok(profiles.inverted.widths.chest > profiles.straight.widths.chest);
  assert.ok(profiles.inverted.widths.hips < profiles.straight.widths.hips);

  assert.ok(profiles.apple.widths.waist > profiles.straight.widths.waist);
  assert.ok(profiles.apple.widths.chest > profiles.straight.widths.chest);

  for (const profile of Object.values(profiles)) {
    assert.equal(profile.totalHeight, profiles.straight.totalHeight);
    assert.equal(profile.joints.headTop, profiles.straight.joints.headTop);
    const lowerRib = profile.torsoRings[4];
    const chest = profile.torsoRings[5];
    assert.ok(lowerRib.frontScale >= 1.02 && lowerRib.frontScale <= 1.03);
    assert.ok(chest.frontScale >= 1.05 && chest.frontScale <= 1.08);
    assert.ok(chest.frontScale > lowerRib.frontScale);
  }

  const defaultShoulder = profiles.straight.widths.shoulder;
  assert.ok(defaultShoulder < 0.86, "default female shoulder line stays softly proportioned");
  const shoulderTransition = profiles.straight.torsoRings.slice(8);
  for (let index = 1; index < shoulderTransition.length; index += 1) {
    assert.ok(
      shoulderTransition[index].xRadius < shoulderTransition[index - 1].xRadius,
      "shoulder-to-neck rings taper continuously",
    );
  }
});

test("explicit measurements dominate even the opposing body-shape cue", () => {
  const cases = [
    ["shoulder", "shoulder", 32, "inverted", 52, "pear"],
    ["chest", "chest", 72, "inverted", 126, "pear"],
    ["waist", "waist", 56, "apple", 118, "hourglass"],
    ["hips", "hips", 76, "pear", 132, "inverted"],
  ];
  for (const [metric, width, low, lowShape, high, highShape] of cases) {
    const narrow = avatarBodyProfile({ ...DEFAULT_METRICS, [metric]: low, bodyShape: lowShape });
    const wide = avatarBodyProfile({ ...DEFAULT_METRICS, [metric]: high, bodyShape: highShape });
    assert.ok(wide.widths[width] > narrow.widths[width], `${metric} must outrank its shape cue`);
  }

  for (const hostileShape of ["not-a-shape", "__proto__", "toString", null, 42]) {
    const invalid = avatarBodyProfile({
      height: Infinity,
      weight: Number.NaN,
      shoulder: -1e100,
      chest: 1e100,
      waist: "not-a-number",
      hips: null,
      torso: -Infinity,
      legs: Infinity,
      bodyShape: hostileShape,
    });
    for (const [path, value] of numericLeaves(invalid)) {
      assert.ok(Number.isFinite(value), `${path} must remain finite`);
    }
    assert.equal(invalid.joints.headTop, invalid.totalHeight);
  }
});

test("torso and leg controls redistribute one fixed requested height", () => {
  const longTorso = avatarBodyProfile({ ...DEFAULT_METRICS, torso: 58, legs: 72 });
  const longLegs = avatarBodyProfile({ ...DEFAULT_METRICS, torso: 42, legs: 94 });

  assert.equal(longTorso.totalHeight, longLegs.totalHeight);
  assert.equal(longTorso.joints.headTop, longLegs.joints.headTop);
  assert.ok(longTorso.joints.crotch < longLegs.joints.crotch);
  assert.ok(
    longTorso.joints.shoulder - longTorso.joints.crotch >
      longLegs.joints.shoulder - longLegs.joints.crotch,
  );
  assert.ok(
    longLegs.joints.crotch - longLegs.joints.ankle >
      longTorso.joints.crotch - longTorso.joints.ankle,
  );
});

function corners(bounds) {
  const result = [];
  for (const x of [bounds.min.x, bounds.max.x]) {
    for (const y of [bounds.min.y, bounds.max.y]) {
      for (const z of [bounds.min.z, bounds.max.z]) result.push({ x, y, z });
    }
  }
  return result;
}

test("camera fit contains every avatar corner inside the requested safe frame at all yaw views", () => {
  const bounds = {
    min: { x: -1.25, y: 0, z: -0.72 },
    max: { x: 1.25, y: 6.75, z: 0.72 },
  };
  const safeFrame = { top: 0.2, bottom: 0.13, left: 0.08, right: 0.08, padding: 1.08 };
  const verticalFovDegrees = 31;
  const aspect = 0.82;
  const fit = avatarCameraFit({ bounds, verticalFovDegrees, aspect, safeFrame });
  const center = {
    x: (bounds.min.x + bounds.max.x) / 2,
    y: (bounds.min.y + bounds.max.y) / 2,
    z: (bounds.min.z + bounds.max.z) / 2,
  };
  const targetY = center.y + fit.targetYOffset;
  const tangentVertical = Math.tan(verticalFovDegrees * Math.PI / 360);
  const tangentHorizontal = tangentVertical * aspect;
  const safeMinimumX = -1 + 2 * safeFrame.left;
  const safeMaximumX = 1 - 2 * safeFrame.right;
  const safeMinimumY = -1 + 2 * safeFrame.bottom;
  const safeMaximumY = 1 - 2 * safeFrame.top;

  for (const yaw of [0, Math.PI / 4, Math.PI / 2, Math.PI * 3 / 4]) {
    for (const point of corners(bounds)) {
      const deltaX = point.x - center.x;
      const deltaZ = point.z - center.z;
      const viewX = deltaX * Math.cos(yaw) - deltaZ * Math.sin(yaw);
      const viewZ = deltaX * Math.sin(yaw) + deltaZ * Math.cos(yaw);
      const pointDistance = fit.fitDistance - viewZ;
      assert.ok(pointDistance > 0);
      const projectedX = viewX / (pointDistance * tangentHorizontal);
      const projectedY = (point.y - targetY) / (pointDistance * tangentVertical);
      assert.ok(projectedX >= safeMinimumX - 1e-9 && projectedX <= safeMaximumX + 1e-9);
      assert.ok(projectedY >= safeMinimumY - 1e-9 && projectedY <= safeMaximumY + 1e-9);
    }
  }
  assert.ok(fit.minDistance < fit.fitDistance);
  assert.ok(fit.fitDistance < fit.maxDistance);
});

test("camera fit sanitizes degenerate bounds and invalid optics without NaN", () => {
  const fit = avatarCameraFit({
    bounds: {
      min: { x: Number.NaN, y: Infinity, z: 2 },
      max: { x: Number.NaN, y: -Infinity, z: 2 },
    },
    verticalFovDegrees: Number.NaN,
    aspect: 0,
    safeFrame: { top: 1, bottom: 1, left: -4, right: Infinity, padding: 99 },
  });
  for (const [name, value] of Object.entries(fit)) {
    assert.ok(Number.isFinite(value), `${name} must be finite`);
  }
  assert.ok(fit.minDistance < fit.fitDistance);
  assert.ok(fit.fitDistance < fit.maxDistance);
});
