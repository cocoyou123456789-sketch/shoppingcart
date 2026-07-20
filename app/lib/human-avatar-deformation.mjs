// @ts-check

import { avatarBodyProfile } from "./avatar-geometry.mjs";

const SOURCE_HEIGHT = 1.721;
const REFERENCE_METRICS = Object.freeze({
  height: 168,
  weight: 60,
  shoulder: 40,
  chest: 90,
  waist: 72,
  hips: 94,
  torso: 50,
  legs: 82,
  bodyShape: "straight",
});
const REFERENCE_PROFILE = avatarBodyProfile(REFERENCE_METRICS);

/** @param {number} value @param {number} minimum @param {number} maximum */
function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}

/** @param {number} from @param {number} to @param {number} amount */
function mix(from, to, amount) {
  return from + (to - from) * amount;
}

/** @param {number} from @param {number} to @param {number} value */
function inverseMix(from, to, value) {
  if (Math.abs(to - from) < 1e-6) return 0;
  return clamp((value - from) / (to - from), 0, 1);
}

/**
 * @param {number} value
 * @param {number} reference
 * @param {number} [minimum]
 * @param {number} [maximum]
 */
function ratio(value, reference, minimum = 0.68, maximum = 1.45) {
  return clamp(value / reference, minimum, maximum);
}

/**
 * Produces the deformation controls for the licensed human base mesh.
 * Measurements remain authoritative through avatarBodyProfile; BMI only adds
 * bounded face fullness because the source mesh has no authored face morph.
 *
 * @param {Record<string, unknown>} metrics
 */
export function humanDeformationProfile(metrics = {}) {
  const body = avatarBodyProfile(metrics);
  const height = clamp(Number(metrics.height) || 168, 130, 210);
  const weight = clamp(Number(metrics.weight) || 60, 35, 150);
  const statureMetres = height / 100;
  const bmi = weight / (statureMetres * statureMetres);
  const face = clamp((bmi / 22) ** 0.35, 0.86, 1.18);

  return {
    body,
    face,
    shoulder: ratio(body.widths.shoulder, REFERENCE_PROFILE.widths.shoulder),
    chest: ratio(body.widths.chest, REFERENCE_PROFILE.widths.chest),
    waist: ratio(body.widths.waist, REFERENCE_PROFILE.widths.waist),
    hips: ratio(body.widths.hips, REFERENCE_PROFILE.widths.hips),
    limb: ratio(body.widths.limb, REFERENCE_PROFILE.widths.limb, 0.72, 1.4),
  };
}

/**
 * Maps the MakeHuman source landmarks to this app's adjustable anatomical
 * landmarks. The foot stays on y=0 while torso and leg controls redistribute
 * the requested standing height.
 *
 * @param {number} sourceY
 * @param {ReturnType<typeof avatarBodyProfile>} body
 */
export function mapHumanY(sourceY, body) {
  const source = [
    0,
    0.1,
    0.55,
    0.92,
    1.02,
    1.14,
    1.34,
    1.47,
    1.52,
    1.61,
    SOURCE_HEIGHT,
  ];
  const target = [
    0,
    body.joints.ankle,
    body.joints.knee,
    body.joints.crotch,
    body.joints.hip,
    body.joints.waist,
    body.joints.chest,
    body.joints.shoulder,
    body.joints.neckBase,
    body.joints.headCenter,
    body.totalHeight,
  ];
  const safeY = clamp(Number(sourceY) || 0, 0, SOURCE_HEIGHT);
  for (let index = 0; index < source.length - 1; index += 1) {
    if (safeY <= source[index + 1]) {
      return mix(
        target[index],
        target[index + 1],
        inverseMix(source[index], source[index + 1], safeY),
      );
    }
  }
  return body.totalHeight;
}

/**
 * @param {number} sourceY
 * @param {ReturnType<typeof humanDeformationProfile>} deformation
 */
function torsoRatioAt(sourceY, deformation) {
  if (sourceY <= 1.02) return deformation.hips;
  if (sourceY <= 1.14) {
    return mix(
      deformation.hips,
      deformation.waist,
      inverseMix(1.02, 1.14, sourceY),
    );
  }
  if (sourceY <= 1.34) {
    return mix(
      deformation.waist,
      deformation.chest,
      inverseMix(1.14, 1.34, sourceY),
    );
  }
  return mix(
    deformation.chest,
    deformation.shoulder,
    inverseMix(1.34, 1.47, sourceY),
  );
}

/**
 * Returns calibrated x/z scales for a source vertex's controlling bone.
 * Longitudinal scaling is separate in mapHumanY, so height never changes
 * width and a lower weight visibly slims the face, arms and legs as well as
 * the waist.
 *
 * @param {ReturnType<typeof humanDeformationProfile>} deformation
 * @param {string} boneName
 * @param {number} sourceY
 * @param {string} meshName
 */
export function humanBoneScale(
  deformation,
  boneName,
  sourceY,
  meshName = "",
) {
  const normalizedBone = boneName.toLowerCase();
  const normalizedMesh = meshName.toLowerCase();
  const isHead = normalizedMesh.includes("head") ||
    normalizedMesh.includes("eyes") ||
    normalizedBone === "head" ||
    normalizedBone === "head_end";
  if (isHead) {
    return {
      x: 4.72 * deformation.face,
      z: 3.72 * deformation.face,
      zOffset: -0.18,
    };
  }

  const isHand = normalizedMesh.includes("hand") ||
    normalizedBone.includes("hand") ||
    /index|middle|pinky|ring|thumb/.test(normalizedBone);
  const isArm = isHand ||
    /clavicle|upperarm|lowerarm/.test(normalizedBone);
  if (isArm) {
    const longitudinal = inverseMix(0.9, 1.48, sourceY);
    const baseX = mix(1.72, 3.08, longitudinal);
    const limbResponse = 1 + (deformation.limb - 1) * 1.45;
    const shoulderResponse = 1 + (deformation.shoulder - 1) * 0.42;
    return {
      x: baseX * mix(limbResponse, shoulderResponse, longitudinal),
      z: 3.12 * limbResponse,
      zOffset: -0.16,
    };
  }

  const isLeg = /thigh|calf|foot|ball/.test(normalizedBone);
  if (isLeg) {
    const longitudinal = inverseMix(0.04, 0.98, sourceY);
    const baseX = mix(1.24, 2.96, longitudinal);
    const limbResponse = 1 + (deformation.limb - 1) * 1.55;
    const hipResponse = 1 + (deformation.hips - 1) * 0.78;
    return {
      x: baseX * mix(limbResponse, hipResponse, longitudinal),
      z: 3.18 * mix(limbResponse, hipResponse, longitudinal * 0.65),
      zOffset: -0.16,
    };
  }

  if (normalizedBone.includes("neck")) {
    const neckResponse = mix(deformation.face, deformation.shoulder, 0.42);
    return {
      x: 3.92 * neckResponse,
      z: 3.42 * neckResponse,
      zOffset: -0.17,
    };
  }

  const torsoResponse = torsoRatioAt(sourceY, deformation);
  return {
    x: 3.55 * torsoResponse,
    z: 3.12 * (1 + (torsoResponse - 1) * 0.88),
    zOffset: -0.16,
  };
}

export const HUMAN_SOURCE_HEIGHT = SOURCE_HEIGHT;
