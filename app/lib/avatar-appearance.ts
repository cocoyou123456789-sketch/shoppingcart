export const DEFAULT_HAIR_COLOR = "#2d2529";

export const BODY_FEATURES = [
  "none",
  "freckles",
  "beauty-mark",
  "tattoo",
] as const;

export type BodyFeature = (typeof BODY_FEATURES)[number];

export const DEFAULT_BODY_FEATURE: BodyFeature = "none";

const HEX_COLOR_PATTERN = /^#[0-9a-f]{6}$/i;

export function isHexColor(value: unknown): value is string {
  return typeof value === "string" && HEX_COLOR_PATTERN.test(value);
}

export function normalizeHexColor(
  value: unknown,
  fallback = DEFAULT_HAIR_COLOR,
) {
  const normalizedFallback = isHexColor(fallback)
    ? fallback.toLowerCase()
    : DEFAULT_HAIR_COLOR;
  return isHexColor(value) ? value.toLowerCase() : normalizedFallback;
}

export function isBodyFeature(value: unknown): value is BodyFeature {
  return (
    typeof value === "string" &&
    BODY_FEATURES.includes(value as BodyFeature)
  );
}

export function normalizeBodyFeature(
  value: unknown,
  fallback: BodyFeature = DEFAULT_BODY_FEATURE,
): BodyFeature {
  return isBodyFeature(value) ? value : fallback;
}
