// @ts-check

/** @typedef {"chest" | "waist" | "hips" | "length"} MeasurementField */

/** @type {Record<MeasurementField, { direct: string[], flat: string[], min: number, max: number }>} */
const FIELD_RULES = {
  chest: {
    direct: ["胸围", "胸部围度", "chest", "bust"],
    flat: ["平铺胸宽", "胸宽", "pit to pit"],
    min: 20,
    max: 250,
  },
  waist: {
    direct: ["腰围", "waist"],
    flat: ["平铺腰宽", "腰宽"],
    min: 20,
    max: 250,
  },
  hips: {
    direct: ["臀围", "hip circumference", "hips"],
    flat: ["平铺臀宽", "臀宽", "hip width"],
    min: 20,
    max: 250,
  },
  length: {
    direct: ["衣长", "裙长", "裤长", "garment length", "body length"],
    flat: [],
    min: 10,
    max: 300,
  },
};

/** @param {string} value */
function escaped(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * @param {string} text
 * @param {string[]} labels
 * @param {number} [multiplier]
 */
function findLabeledNumber(text, labels, multiplier = 1) {
  if (!labels.length) return undefined;
  const labelGroup = labels.map(escaped).join("|");
  const pattern = new RegExp(
    `(?:${labelGroup})\\s*(?:约|around)?\\s*[:：=]?\\s*(\\d{1,3}(?:\\.\\d+)?)\\s*(cm|厘米|公分|in|inch|inches|英寸)?`,
    "ig",
  );
  const matches = [...text.matchAll(pattern)];
  if (matches.length !== 1) return undefined;
  const [match] = matches;
  const unit = (match[2] ?? "cm").toLowerCase();
  const centimeters = Number(match[1]) * (unit === "in" || unit.startsWith("inch") || unit === "英寸" ? 2.54 : 1);
  return centimeters * multiplier;
}

/**
 * Extracts explicitly labelled garment measurements from pasted size-chart text.
 * Flat widths are converted to approximate circumferences by multiplying by two.
 * Unlabelled numbers are intentionally ignored to avoid inventing measurements.
 *
 * @param {string} input
 * @returns {{ measurements: Partial<Record<"chest" | "waist" | "hips" | "length", number>>, matched: string[] }}
 */
export function extractGarmentMeasurements(input) {
  const text = String(input ?? "").replace(/\s+/g, " ").trim();
  /** @type {Partial<Record<"chest" | "waist" | "hips" | "length", number>>} */
  const measurements = {};
  /** @type {string[]} */
  const matched = [];
  if (!text) return { measurements, matched };

  for (const [field, rule] of /** @type {[MeasurementField, (typeof FIELD_RULES)[MeasurementField]][]} */ (Object.entries(FIELD_RULES))) {
    const direct = findLabeledNumber(text, rule.direct);
    const flat = direct === undefined ? findLabeledNumber(text, rule.flat, 2) : undefined;
    const value = direct ?? flat;
    if (value === undefined || value < rule.min || value > rule.max) continue;
    measurements[field] = Math.round(value * 10) / 10;
    matched.push(field);
  }
  return { measurements, matched };
}
