const NOMINAL_HEIGHT = 6.4;
const REFERENCE_HEIGHT_CM = 168;
const EPSILON = 1e-4;

// These are deliberately small visual cues, not substitute measurements.
// Every multiplier stays within four percent of neutral so the user's chest,
// waist, hip, and shoulder values remain the primary source of geometry.
const BODY_SHAPE_CUES = Object.freeze({
  straight: Object.freeze({ shoulder: 1, chest: 0.995, waist: 1.025, hips: 0.985, chestFront: 0 }),
  pear: Object.freeze({ shoulder: 0.98, chest: 0.985, waist: 0.99, hips: 1.035, chestFront: -0.004 }),
  hourglass: Object.freeze({ shoulder: 1.005, chest: 1.018, waist: 0.965, hips: 1.02, chestFront: 0.008 }),
  inverted: Object.freeze({ shoulder: 1.035, chest: 1.025, waist: 1.005, hips: 0.97, chestFront: 0.004 }),
  apple: Object.freeze({ shoulder: 1.005, chest: 1.02, waist: 1.04, hips: 0.995, chestFront: 0.006 }),
});

function finiteNumber(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}

function boundedNumber(value, fallback, minimum, maximum) {
  return clamp(finiteNumber(value, fallback), minimum, maximum);
}

function mix(from, to, amount) {
  return from + (to - from) * amount;
}

function bodyShapeCue(value) {
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(BODY_SHAPE_CUES, value)
    ? BODY_SHAPE_CUES[value]
    : BODY_SHAPE_CUES.straight;
}

/**
 * Convert measurements into a renderer-independent body profile.
 *
 * Coordinates start at the sole of the foot (y = 0). Width values and torso
 * radii are half extents, not full diameters. Explicit circumferences remain
 * authoritative; weight contributes only a bounded soft-tissue adjustment.
 *
 * @param {object} metrics
 * @returns {{
 *   heightScale: number,
 *   totalHeight: number,
 *   joints: {
 *     ankle: number, knee: number, hip: number, crotch: number,
 *     waist: number, chest: number, shoulder: number, neckBase: number,
 *     headCenter: number, headTop: number, elbow: number, wrist: number
 *   },
 *   widths: { shoulder: number, chest: number, waist: number, hips: number, limb: number },
 *   torsoRings: Array<{ y: number, xRadius: number, zRadius: number, zOffset: number, frontScale?: number }>
 * }}
 */
export function avatarBodyProfile(metrics = {}) {
  const height = boundedNumber(metrics.height, REFERENCE_HEIGHT_CM, 130, 210);
  const weight = boundedNumber(metrics.weight, 60, 35, 150);
  const shoulderMeasurement = boundedNumber(metrics.shoulder, 40, 30, 58);
  const chestMeasurement = boundedNumber(metrics.chest, 90, 65, 145);
  const waistMeasurement = boundedNumber(metrics.waist, 72, 50, 140);
  const hipMeasurement = boundedNumber(metrics.hips, 94, 65, 150);
  const torsoMeasurement = boundedNumber(metrics.torso, 50, 38, 64);
  const legMeasurement = boundedNumber(metrics.legs, 82, 65, 105);
  const bodyShape = bodyShapeCue(metrics.bodyShape);

  const heightScale = height / REFERENCE_HEIGHT_CM;
  const totalHeight = NOMINAL_HEIGHT * heightScale;
  const statureMetres = height / 100;
  const bmi = weight / (statureMetres * statureMetres);
  const softTissue = clamp(1 + (bmi - 22) * 0.006, 0.9, 1.16);
  const limbMass = clamp(1 + (bmi - 22) * 0.012, 0.82, 1.28);

  const widths = {
    shoulder: clamp(
      0.84 * (shoulderMeasurement / 40) * (0.96 + softTissue * 0.04) * bodyShape.shoulder,
      0.62,
      1.32,
    ),
    chest: clamp(0.72 * (chestMeasurement / 90) * softTissue * bodyShape.chest, 0.5, 1.32),
    waist: clamp(0.56 * (waistMeasurement / 72) * softTissue * bodyShape.waist, 0.4, 1.28),
    hips: clamp(0.76 * (hipMeasurement / 94) * softTissue * bodyShape.hips, 0.54, 1.34),
    limb: clamp(0.17 * limbMass, 0.12, 0.25),
  };

  // Torso and leg controls redistribute a fixed standing height. This keeps a
  // longer torso from also making the completed avatar taller than requested.
  const ankle = 0.26 * heightScale;
  const shoulder = totalHeight - 1.24 * heightScale;
  const availableLowerBody = shoulder - ankle;
  const legPreference = 2.72 * clamp(legMeasurement / 82, 0.8, 1.22);
  const torsoPreference = 1.9 * clamp(torsoMeasurement / 50, 0.82, 1.22);
  const legLength = availableLowerBody * legPreference / (legPreference + torsoPreference);
  const crotch = ankle + legLength;
  const torsoLength = shoulder - crotch;
  const hip = crotch + torsoLength * 0.12;
  const waist = crotch + torsoLength * 0.48;
  const chest = crotch + torsoLength * 0.76;
  const neckBase = shoulder + 0.18 * heightScale;
  const headCenter = totalHeight - 0.43 * heightScale;
  const headTop = totalHeight;

  const joints = {
    ankle,
    knee: ankle + legLength * 0.52,
    hip,
    crotch,
    waist,
    chest,
    shoulder,
    neckBase,
    headCenter,
    headTop,
    elbow: shoulder - 0.94 * heightScale,
    wrist: shoulder - 1.98 * heightScale,
  };

  const upperHipY = mix(hip, waist, 0.55);
  const lowerRibY = mix(waist, chest, 0.55);
  const underarmY = mix(chest, shoulder, 0.62);
  const upperShoulderY = mix(underarmY, shoulder, 0.66);
  const outerShoulderSlopeY = mix(shoulder, neckBase, 0.3);
  const innerShoulderSlopeY = mix(shoulder, neckBase, 0.68);
  const neckRadius = clamp(0.205 * softTissue, 0.17, 0.25);
  const torsoRings = [
    {
      y: crotch,
      xRadius: widths.hips * 0.7,
      zRadius: widths.hips * 0.58,
      zOffset: -0.015 * heightScale,
    },
    {
      y: hip,
      xRadius: widths.hips,
      zRadius: widths.hips * 0.72,
      zOffset: -0.035 * heightScale,
    },
    {
      y: upperHipY,
      xRadius: mix(widths.hips * 0.94, widths.waist, 0.48),
      zRadius: mix(widths.hips * 0.7, widths.waist * 0.72, 0.48),
      zOffset: -0.012 * heightScale,
    },
    {
      y: waist,
      xRadius: widths.waist,
      zRadius: widths.waist * 0.72,
      zOffset: 0,
    },
    {
      y: lowerRibY,
      xRadius: mix(widths.waist, widths.chest, 0.62),
      zRadius: mix(widths.waist * 0.72, widths.chest * 0.7, 0.62),
      zOffset: 0.012 * heightScale,
      frontScale: 1.025 + bodyShape.chestFront * 0.45,
    },
    {
      y: chest,
      xRadius: widths.chest,
      zRadius: widths.chest * 0.7,
      zOffset: 0.025 * heightScale,
      frontScale: 1.065 + bodyShape.chestFront,
    },
    {
      y: underarmY,
      xRadius: Math.max(widths.chest * 0.95, widths.shoulder * 0.82),
      zRadius: widths.chest * 0.63,
      zOffset: 0.012 * heightScale,
    },
    {
      y: upperShoulderY,
      xRadius: Math.max(widths.chest * 0.9, widths.shoulder * 0.93),
      zRadius: Math.max(widths.chest * 0.58, widths.shoulder * 0.47),
      zOffset: 0.006 * heightScale,
    },
    {
      y: shoulder,
      xRadius: widths.shoulder,
      zRadius: Math.max(widths.chest * 0.54, widths.shoulder * 0.43),
      zOffset: 0,
    },
    {
      y: outerShoulderSlopeY,
      xRadius: Math.max(neckRadius * 2.15, widths.shoulder * 0.76),
      zRadius: Math.max(neckRadius * 1.45, widths.chest * 0.46),
      zOffset: 0,
    },
    {
      y: innerShoulderSlopeY,
      xRadius: Math.max(neckRadius * 1.55, widths.shoulder * 0.465),
      zRadius: Math.max(neckRadius * 1.08, widths.chest * 0.31),
      zOffset: 0,
    },
    {
      y: neckBase,
      xRadius: neckRadius,
      zRadius: neckRadius * 0.9,
      zOffset: 0,
    },
  ];

  return { heightScale, totalHeight, joints, widths, torsoRings };
}

function normalizedBounds(bounds) {
  const rawMinimum = bounds?.min ?? {};
  const rawMaximum = bounds?.max ?? {};
  const fallbackMinimum = { x: -0.5, y: 0, z: -0.35 };
  const fallbackMaximum = { x: 0.5, y: NOMINAL_HEIGHT, z: 0.35 };
  const minimum = {};
  const maximum = {};
  for (const axis of ["x", "y", "z"]) {
    const first = finiteNumber(rawMinimum[axis], fallbackMinimum[axis]);
    const second = finiteNumber(rawMaximum[axis], fallbackMaximum[axis]);
    minimum[axis] = Math.min(first, second);
    maximum[axis] = Math.max(first, second);
    if (maximum[axis] - minimum[axis] < EPSILON) {
      const center = (maximum[axis] + minimum[axis]) / 2;
      minimum[axis] = center - EPSILON / 2;
      maximum[axis] = center + EPSILON / 2;
    }
  }
  return { minimum, maximum };
}

function normalizedInsets(safeFrame = {}) {
  let top = boundedNumber(safeFrame.top, 0, 0, 0.45);
  let bottom = boundedNumber(safeFrame.bottom, 0, 0, 0.45);
  let left = boundedNumber(safeFrame.left, 0, 0, 0.45);
  let right = boundedNumber(safeFrame.right, 0, 0, 0.45);
  if (top + bottom > 0.88) {
    const scale = 0.88 / (top + bottom);
    top *= scale;
    bottom *= scale;
  }
  if (left + right > 0.88) {
    const scale = 0.88 / (left + right);
    left *= scale;
    right *= scale;
  }
  return {
    top,
    bottom,
    left,
    right,
    padding: boundedNumber(safeFrame.padding, 1.08, 1, 1.5),
  };
}

/**
 * Find a yaw-independent camera distance that contains an axis-aligned avatar
 * box inside normalized viewport insets. `targetYOffset` is added to the box's
 * center Y. Insets are viewport fractions (0.1 reserves ten percent).
 *
 * @param {{
 *   bounds?: { min?: {x?: number, y?: number, z?: number}, max?: {x?: number, y?: number, z?: number} },
 *   verticalFovDegrees?: number,
 *   aspect?: number,
 *   safeFrame?: {top?: number, bottom?: number, left?: number, right?: number, padding?: number}
 * }} input
 * @returns {{fitDistance: number, targetYOffset: number, minDistance: number, maxDistance: number}}
 */
export function avatarCameraFit({
  bounds,
  verticalFovDegrees = 31,
  aspect = 1,
  safeFrame = {},
} = {}) {
  const { minimum, maximum } = normalizedBounds(bounds);
  const insets = normalizedInsets(safeFrame);
  const fovRadians = boundedNumber(verticalFovDegrees, 31, 15, 75) * Math.PI / 180;
  const tangentVertical = Math.tan(fovRadians / 2);
  const measuredAspect = boundedNumber(aspect, 1, 0.35, 3.5);
  const tangentHorizontal = tangentVertical * measuredAspect;
  const width = maximum.x - minimum.x;
  const height = maximum.y - minimum.y;
  const depth = maximum.z - minimum.z;

  // The XZ diagonal bounds every front/side/45-degree yaw without rebuilding
  // the box for each view direction.
  const horizontalSpan = Math.max(EPSILON, Math.hypot(width, depth));
  const depthSpan = horizontalSpan;
  const verticalHalfFrame = Math.max(0.1, 1 - insets.top - insets.bottom);
  // There is no horizontal target offset in the public API, so use the
  // smaller clearance around viewport center for asymmetric side insets.
  const horizontalHalfFrame = Math.max(
    0.1,
    Math.min(1 - 2 * insets.left, 1 - 2 * insets.right),
  );
  const verticalPlaneDistance = height * 0.5 * insets.padding /
    (verticalHalfFrame * tangentVertical);
  const horizontalPlaneDistance = horizontalSpan * 0.5 * insets.padding /
    (horizontalHalfFrame * tangentHorizontal);
  const nearestPlaneDistance = Math.max(verticalPlaneDistance, horizontalPlaneDistance);
  const depthAllowance = depthSpan * 0.5;
  const fitDistance = nearestPlaneDistance + depthAllowance;
  const safeCenterY = insets.bottom - insets.top;
  const targetYOffset = -safeCenterY * nearestPlaneDistance * tangentVertical;
  const unconstrainedMinimum = Math.max(depthAllowance + 0.05, fitDistance * 0.68);
  const minDistance = Math.max(0.1, Math.min(fitDistance * 0.92, unconstrainedMinimum));
  const maxDistance = Math.max(fitDistance + 0.5, fitDistance * 1.65);

  return { fitDistance, targetYOffset, minDistance, maxDistance };
}
