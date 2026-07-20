// @ts-check

const DEVICE_SNAPSHOT_VERSION = 3;
const KNOWN_DEVICE_SNAPSHOT_VERSIONS = new Set([1, 2, DEVICE_SNAPSHOT_VERSION]);

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
    profileRevision: snapshot.profileRevision,
    clearSignal: clearSignal ?? undefined,
    updatedAt,
  });
}

/**
 * Parses known device snapshots while refusing future versions that this
 * client could otherwise overwrite with an incomplete older schema.
 * Versionless records, v1, and v2 are accepted as legacy formats.
 *
 * @param {string | null} raw
 * @returns {Record<string, unknown> | null}
 */
export function parseDeviceSnapshot(raw) {
  if (typeof raw !== "string" || !raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    if (
      parsed.version !== undefined &&
      !KNOWN_DEVICE_SNAPSHOT_VERSIONS.has(parsed.version)
    ) return null;
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
      !KNOWN_DEVICE_SNAPSHOT_VERSIONS.has(parsed.version),
    );
  } catch {
    return false;
  }
}

/** @param {unknown} left @param {unknown} right @returns {boolean} */
function deviceValuesEqual(left, right) {
  if (Object.is(left, right)) return true;
  if (Array.isArray(left) || Array.isArray(right)) {
    if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) {
      return false;
    }
    return left.every((entry, index) => deviceValuesEqual(entry, right[index]));
  }
  if (
    !left ||
    !right ||
    typeof left !== "object" ||
    typeof right !== "object"
  ) return false;
  const leftRecord = /** @type {Record<string, unknown>} */ (left);
  const rightRecord = /** @type {Record<string, unknown>} */ (right);
  const leftKeys = Object.keys(leftRecord);
  const rightKeys = Object.keys(rightRecord);
  return leftKeys.length === rightKeys.length && leftKeys.every(
    (key) => Object.hasOwn(rightRecord, key) &&
      deviceValuesEqual(leftRecord[key], rightRecord[key]),
  );
}

/**
 * Compares a current v3 snapshot with a proposed v3 serialization while
 * ignoring only the write timestamp. Legacy snapshots intentionally return
 * false so the next safe save migrates them to the protected schema.
 *
 * @param {string | null} currentRaw
 * @param {string} nextRaw
 */
export function deviceSnapshotContentsMatch(currentRaw, nextRaw) {
  try {
    const current = JSON.parse(currentRaw ?? "null");
    const next = JSON.parse(nextRaw);
    if (
      !current ||
      !next ||
      typeof current !== "object" ||
      typeof next !== "object" ||
      Array.isArray(current) ||
      Array.isArray(next) ||
      current.version !== DEVICE_SNAPSHOT_VERSION ||
      next.version !== DEVICE_SNAPSHOT_VERSION
    ) return false;
    const currentKeys = Object.keys(current).filter((key) => key !== "updatedAt");
    const nextKeys = Object.keys(next).filter((key) => key !== "updatedAt");
    return currentKeys.length === nextKeys.length && currentKeys.every(
      (key) => Object.hasOwn(next, key) && deviceValuesEqual(current[key], next[key]),
    );
  } catch {
    return false;
  }
}

/**
 * Decides how to handle a storage event using the value that is still
 * authoritative in localStorage when the event is processed.
 *
 * @param {{ eventRaw: string | null, currentRaw: string | null, hasLocalWork: boolean }} input
 */
export function crossTabSnapshotAction(input) {
  if (!input.eventRaw || input.eventRaw !== input.currentRaw) return "ignore";
  if (hasUnsupportedDeviceSnapshotVersion(input.eventRaw)) return "incompatible";
  if (!parseDeviceSnapshot(input.eventRaw)) return "ignore";
  return input.hasLocalWork ? "prompt" : "apply";
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
 * Merges the profile coordination fields independently from the rest of a
 * whole-device snapshot. Revisions are monotonic, and keeping local metrics
 * against a newer confirmed cloud snapshot marks them pending instead of
 * falsely calling them synchronized.
 *
 * @template {Record<string, unknown>} T
 * @param {{
 *   choice: "current" | "incoming",
 *   current: { metrics: T, revision: number, pending: boolean },
 *   incoming: { metrics: T, revision: number, pending: boolean }
 * }} input
 */
export function resolveSnapshotProfileChoice(input) {
  const sameMetrics = (() => {
    const currentKeys = Object.keys(input.current.metrics);
    const incomingKeys = Object.keys(input.incoming.metrics);
    return currentKeys.length === incomingKeys.length && currentKeys.every(
      (key) => Object.hasOwn(input.incoming.metrics, key) &&
        Object.is(input.current.metrics[key], input.incoming.metrics[key]),
    );
  })();

  if (input.choice === "incoming") {
    return input.incoming.revision >= input.current.revision
      ? { ...input.incoming, source: "incoming" }
      : { ...input.current, source: "current" };
  }
  if (input.incoming.revision < input.current.revision) {
    return { ...input.current, source: "current" };
  }
  const pending = input.incoming.revision > input.current.revision
    ? input.incoming.pending || !sameMetrics
    : input.incoming.pending
      ? input.current.pending
      : !sameMetrics;
  return {
    metrics: input.current.metrics,
    revision: input.incoming.revision,
    pending,
    source: "current",
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
