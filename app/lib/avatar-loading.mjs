const SLOW_CONNECTIONS = new Set(["slow-2g", "2g"]);

/**
 * @param {{
 *   forceLoad?: boolean;
 *   priority?: boolean;
 *   saveData?: boolean;
 *   effectiveType?: string;
 *   deviceMemory?: number;
 *   hardwareConcurrency?: number;
 * }} [options]
 * @returns {{
 *   mode: "immediate" | "pause" | "defer";
 *   reason: "network" | "device" | null;
 *   delayMs: number;
 * }}
 */
export function avatarLoadPolicy({
  forceLoad = false,
  priority = false,
  saveData = false,
  effectiveType,
  deviceMemory,
  hardwareConcurrency,
} = {}) {
  if (forceLoad) return { mode: "immediate", reason: null, delayMs: 0 };
  if (saveData || SLOW_CONNECTIONS.has(effectiveType)) {
    return { mode: "pause", reason: "network", delayMs: 0 };
  }
  if (priority) return { mode: "immediate", reason: null, delayMs: 0 };
  if (
    (Number.isFinite(deviceMemory) && deviceMemory <= 4) ||
    (Number.isFinite(hardwareConcurrency) && hardwareConcurrency <= 4)
  ) {
    return { mode: "pause", reason: "device", delayMs: 0 };
  }
  return {
    mode: "defer",
    reason: null,
    delayMs: effectiveType === "3g" ? 1_800 : 800,
  };
}
