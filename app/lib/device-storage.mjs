// @ts-check

const DEVICE_SNAPSHOT_VERSION = 1;

/**
 * Serializes every device-owned product field explicitly so additions cannot
 * disappear silently during a save/restore round trip.
 *
 * @param {Record<string, unknown>} snapshot
 * @param {string | null} clearSignal
 * @param {string} [updatedAt]
 */
export function serializeDeviceSnapshot(
  snapshot,
  clearSignal,
  updatedAt = new Date().toISOString(),
) {
  return JSON.stringify({
    version: DEVICE_SNAPSHOT_VERSION,
    wardrobe: snapshot.wardrobe,
    metrics: snapshot.metrics,
    outfit: snapshot.outfit,
    mood: snapshot.mood,
    cartProductIds: snapshot.cartProductIds,
    savedProductIds: snapshot.savedProductIds,
    cloudItemIds: snapshot.cloudItemIds,
    cloudGeneration: snapshot.cloudGeneration,
    deletedWardrobeClientIds: snapshot.deletedWardrobeClientIds,
    dailyPreferences: snapshot.dailyPreferences,
    profilePending: snapshot.profilePending,
    clearSignal: clearSignal ?? undefined,
    updatedAt,
  });
}

/**
 * Parses known device snapshots while refusing future versions that this
 * client could otherwise overwrite with an incomplete older schema.
 * Versionless records are accepted as the legacy v1 format.
 *
 * @param {string | null} raw
 * @returns {Record<string, unknown> | null}
 */
export function parseDeviceSnapshot(raw) {
  if (typeof raw !== "string" || !raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    if (parsed.version !== undefined && parsed.version !== DEVICE_SNAPSHOT_VERSION) return null;
    return parsed;
  } catch {
    return null;
  }
}

/** @param {string | null} raw */
export function hasUnsupportedDeviceSnapshotVersion(raw) {
  if (typeof raw !== "string" || !raw) return false;
  try {
    const parsed = JSON.parse(raw);
    return Boolean(
      parsed &&
      typeof parsed === "object" &&
      !Array.isArray(parsed) &&
      parsed.version !== undefined &&
      parsed.version !== DEVICE_SNAPSHOT_VERSION,
    );
  } catch {
    return false;
  }
}

/**
 * Reads only coordination fields whose meaning is stable across snapshot
 * versions. Callers must not treat the returned envelope as product data.
 *
 * @param {string | null} raw
 */
export function readDeviceSnapshotEnvelope(raw) {
  if (typeof raw !== "string" || !raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    return {
      version: parsed.version,
      cloudGeneration: typeof parsed.cloudGeneration === "string"
        ? parsed.cloudGeneration
        : undefined,
      clearSignal: typeof parsed.clearSignal === "string"
        ? parsed.clearSignal
        : undefined,
    };
  } catch {
    return null;
  }
}

/**
 * A known snapshot can be reset when the server proves it belongs to an old
 * data generation. An unknown future schema is preserved for a newer client.
 *
 * @param {string} storedGeneration
 * @param {string | undefined} serverGeneration
 * @param {boolean} incompatible
 */
export function deviceGenerationAction(
  storedGeneration,
  serverGeneration,
  incompatible,
) {
  if (!serverGeneration || serverGeneration === storedGeneration) return "keep";
  return incompatible ? "preserve-future" : "reset-known";
}

/**
 * Re-checks the live storage value immediately before a normal write, so an
 * older tab cannot overwrite a future schema written after it hydrated.
 * Explicit user-confirmed clears intentionally bypass this guard.
 *
 * @template T
 * @param {() => string | null} readCurrent
 * @param {() => T} write
 * @returns {T | "incompatible" | "unavailable"}
 */
export function guardKnownDeviceSnapshotWrite(readCurrent, write) {
  try {
    if (hasUnsupportedDeviceSnapshotVersion(readCurrent())) return "incompatible";
  } catch {
    return "unavailable";
  }
  return write();
}

/**
 * Keeps the stored order, removes duplicates, and ignores IDs that no longer
 * exist in the current catalogue.
 *
 * @template {{ id: string }} T
 * @param {unknown} ids
 * @param {T[]} items
 * @returns {T[]}
 */
export function restoreItemsInStoredOrder(ids, items) {
  if (!Array.isArray(ids)) return [];
  const byId = new Map(items.map((item) => [item.id, item]));
  const seen = new Set();
  const restored = [];
  for (const id of ids) {
    if (typeof id !== "string" || seen.has(id)) continue;
    const item = byId.get(id);
    if (!item) continue;
    seen.add(id);
    restored.push(item);
  }
  return restored;
}

/**
 * Resolves local/cloud profile conflicts without discarding an explicitly
 * pending device edit.
 *
 * @template {Record<string, unknown>} T
 * @param {{ defaults: T, local?: Partial<T> | null, cloud?: Partial<T> | null, profilePending?: boolean }} input
 */
export function resolveHydratedProfile(input) {
  const localMetrics = input.local
    ? /** @type {T} */ ({ ...input.defaults, ...input.local })
    : null;
  const cloudMetrics = input.cloud
    ? /** @type {T} */ ({ ...input.defaults, ...input.cloud })
    : null;
  /** @param {T} left @param {T} right */
  const sameMetrics = (left, right) => {
    return Object.keys(input.defaults).every((key) => left[key] === right[key]);
  };

  if (
    input.profilePending === true &&
    localMetrics &&
    (!cloudMetrics || !sameMetrics(localMetrics, cloudMetrics))
  ) {
    return {
      metrics: localMetrics,
      profilePending: true,
      source: "local",
    };
  }
  if (cloudMetrics && (
    input.profilePending === false ||
    !localMetrics ||
    sameMetrics(localMetrics, cloudMetrics) ||
    (
      input.profilePending === undefined &&
      sameMetrics(localMetrics, input.defaults)
    )
  )) {
    return {
      metrics: cloudMetrics,
      profilePending: false,
      source: "cloud",
    };
  }
  if (localMetrics) {
    const comparison = cloudMetrics ?? input.defaults;
    if (!sameMetrics(localMetrics, comparison)) {
      return {
        metrics: localMetrics,
        profilePending: true,
        source: "local",
      };
    }
  }
  if (cloudMetrics) {
    return {
      metrics: cloudMetrics,
      profilePending: false,
      source: "cloud",
    };
  }
  return {
    metrics: localMetrics ?? input.defaults,
    profilePending: false,
    source: localMetrics ? "local" : "default",
  };
}

/**
 * Builds a quota fallback that keeps photos already proven to fit in storage,
 * while omitting only new local photos. It never resurrects deleted garments.
 *
 * @template {{ id: string, imageUrl?: string }} T
 * @param {T[]} wardrobe
 * @param {string | null} previousRaw
 * @returns {T[]}
 */
export function preservePersistedPhotos(wardrobe, previousRaw) {
  const persistedPhotos = new Map();
  try {
    /** @type {{ wardrobe?: Array<{ id?: string, imageUrl?: string }> } | null} */
    const previous = JSON.parse(previousRaw ?? "null");
    if (Array.isArray(previous?.wardrobe)) {
      previous.wardrobe.forEach((item) => {
        if (item?.id && typeof item.imageUrl === "string" && item.imageUrl.startsWith("data:")) {
          persistedPhotos.set(item.id, item.imageUrl);
        }
      });
    }
  } catch {
    // Invalid old data cannot provide a reusable photo.
  }

  return wardrobe.map((item) => {
    if (!item.imageUrl || !/^(data:|blob:)/.test(item.imageUrl)) return item;
    return /** @type {T} */ ({ ...item, imageUrl: persistedPhotos.get(item.id) });
  });
}
