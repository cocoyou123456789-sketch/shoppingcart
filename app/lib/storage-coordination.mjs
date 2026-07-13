const CLEAR_MARKER_VERSION = 2;
const LEGACY_CLEAR_MARKER_VERSION = 1;
const MAX_SIGNAL_LENGTH = 100;
const MAX_GENERATION_LENGTH = 200;
const DEFAULT_CLEAR_RETRY_DELAY_MS = 2_000;
const MIN_CLEAR_RETRY_DELAY_MS = 250;
const MAX_CLEAR_RETRY_DELAY_MS = 5_000;
const CLEAR_RETRY_ACTIVE_CHECK_MS = 250;

/**
 * Parses both Retry-After forms while keeping personal-data clears responsive.
 * Missing/malformed values get a conservative pause; excessively long server
 * hints are capped so a clear operation cannot hold the interface indefinitely.
 */
export function clearRetryDelayMs(
  retryAfter,
  now = Date.now(),
) {
  let requestedDelay = Number.NaN;
  if (typeof retryAfter === "string") {
    const value = retryAfter.trim();
    if (/^(?:0|[1-9]\d*)$/.test(value)) {
      const seconds = Number(value);
      requestedDelay = Number.isFinite(seconds)
        ? seconds * 1_000
        : MAX_CLEAR_RETRY_DELAY_MS;
    } else if (value) {
      const retryAt = Date.parse(value);
      if (Number.isFinite(retryAt) && Number.isFinite(now)) {
        requestedDelay = retryAt - now;
      }
    }
  }
  if (!Number.isFinite(requestedDelay)) {
    requestedDelay = DEFAULT_CLEAR_RETRY_DELAY_MS;
  }
  return Math.min(
    MAX_CLEAR_RETRY_DELAY_MS,
    Math.max(MIN_CLEAR_RETRY_DELAY_MS, Math.ceil(requestedDelay)),
  );
}

/**
 * Waits in short slices so a replaced clear boundary or account can stop the
 * retry promptly. The injectable sleeper keeps the policy deterministic in
 * tests without relying on wall-clock timers.
 */
export async function waitForActiveClearRetry(
  delayMs,
  isActive,
  sleep = (duration) => new Promise((resolve) => setTimeout(resolve, duration)),
) {
  if (typeof isActive !== "function" || !isActive()) return false;
  const boundedDelay = Math.min(
    MAX_CLEAR_RETRY_DELAY_MS,
    Math.max(0, Number.isFinite(delayMs) ? Math.ceil(delayMs) : DEFAULT_CLEAR_RETRY_DELAY_MS),
  );
  let elapsed = 0;
  while (elapsed < boundedDelay) {
    if (!isActive()) return false;
    const slice = Math.min(CLEAR_RETRY_ACTIVE_CHECK_MS, boundedDelay - elapsed);
    await sleep(slice);
    elapsed += slice;
  }
  return isActive();
}

export function clearMarkerStorageKey(snapshotKey) {
  return `${snapshotKey}:clear-marker`;
}

export function coordinationScope(snapshotKey) {
  let hash = 0x811c9dc5;
  for (const character of String(snapshotKey)) {
    hash ^= character.codePointAt(0);
    hash = Math.imul(hash, 0x01000193);
  }
  return `scope-${(hash >>> 0).toString(36)}`;
}

export function createClearSignal(now = Date.now(), nonce = crypto.randomUUID()) {
  if (!Number.isSafeInteger(now) || now < 0) throw new TypeError("A valid clear time is required");
  const normalizedNonce = String(nonce).replace(/[^a-zA-Z0-9-]/g, "").slice(0, 64);
  if (!normalizedNonce) throw new TypeError("A clear nonce is required");
  return `g-${now.toString(36).padStart(9, "0")}-${normalizedNonce}`;
}

export function clearSignalTimestamp(signal) {
  if (typeof signal !== "string") return null;
  const match = /^g-([0-9a-z]{9,})-[a-zA-Z0-9-]+$/.exec(signal);
  if (!match) return null;
  const timestamp = Number.parseInt(match[1], 36);
  return Number.isSafeInteger(timestamp) ? timestamp : null;
}

export function compareClearSignals(left, right) {
  if (left === right) return 0;
  const leftTime = clearSignalTimestamp(left);
  const rightTime = clearSignalTimestamp(right);
  if (leftTime === null && rightTime !== null) return -1;
  if (leftTime !== null && rightTime === null) return 1;
  if (leftTime === null && rightTime === null) {
    return String(left).localeCompare(String(right));
  }
  if (leftTime !== rightTime) return leftTime < rightTime ? -1 : 1;
  return String(left).localeCompare(String(right));
}

export function newestClearSignal(...signals) {
  return signals.reduce((newest, signal) => {
    if (typeof signal !== "string" || !signal) return newest;
    if (!newest || compareClearSignals(signal, newest) > 0) return signal;
    return newest;
  }, null);
}

/**
 * Keeps the persisted clear boundary monotonic while allowing an explicitly
 * failed request to resume with the same idempotency signal.
 */
export function clearMarkerWriteAction(currentMarker, nextMarker) {
  if (!nextMarker) return "reject";
  if (!currentMarker) return "write";
  const ordering = compareClearSignals(nextMarker.signal, currentMarker.signal);
  if (ordering < 0) return "preserve-newer";
  if (ordering > 0) return "write";
  if (currentMarker.status === "complete") {
    if (
      nextMarker.status !== "complete" ||
      currentMarker.completedGeneration !== nextMarker.completedGeneration
    ) return "preserve-complete";
  }
  return "write";
}

export function serializeClearMarker(signal, clearedAt = new Date().toISOString()) {
  if (typeof signal !== "string" || !signal || signal.length > MAX_SIGNAL_LENGTH) {
    throw new TypeError("A short, non-empty clear signal is required");
  }
  return JSON.stringify({
    version: CLEAR_MARKER_VERSION,
    signal,
    clearedAt,
    status: "pending",
  });
}

export function serializeCompletedClearMarker(
  signal,
  completedGeneration,
  clearedAt = new Date().toISOString(),
) {
  if (typeof signal !== "string" || !signal || signal.length > MAX_SIGNAL_LENGTH) {
    throw new TypeError("A short, non-empty clear signal is required");
  }
  if (
    typeof completedGeneration !== "string" ||
    !completedGeneration ||
    completedGeneration.length > MAX_GENERATION_LENGTH
  ) {
    throw new TypeError("A short, non-empty completed generation is required");
  }
  return JSON.stringify({
    version: CLEAR_MARKER_VERSION,
    signal,
    clearedAt,
    status: "complete",
    completedGeneration,
  });
}

export function serializeFailedClearMarker(
  signal,
  clearedAt = new Date().toISOString(),
) {
  if (typeof signal !== "string" || !signal || signal.length > MAX_SIGNAL_LENGTH) {
    throw new TypeError("A short, non-empty clear signal is required");
  }
  return JSON.stringify({
    version: CLEAR_MARKER_VERSION,
    signal,
    clearedAt,
    status: "failed",
  });
}

export function parseClearMarker(raw) {
  if (typeof raw !== "string" || !raw) return null;
  try {
    const marker = JSON.parse(raw);
    if (
      (marker?.version !== CLEAR_MARKER_VERSION &&
        marker?.version !== LEGACY_CLEAR_MARKER_VERSION) ||
      typeof marker.signal !== "string" ||
      !marker.signal ||
      marker.signal.length > MAX_SIGNAL_LENGTH ||
      typeof marker.clearedAt !== "string" ||
      !Number.isFinite(Date.parse(marker.clearedAt))
    ) return null;
    if (marker.version === LEGACY_CLEAR_MARKER_VERSION) {
      return {
        signal: marker.signal,
        clearedAt: marker.clearedAt,
        status: "complete",
        completedGeneration: null,
      };
    }
    if (marker.status === "pending") {
      return {
        signal: marker.signal,
        clearedAt: marker.clearedAt,
        status: "pending",
        completedGeneration: null,
      };
    }
    if (marker.status === "failed") {
      return {
        signal: marker.signal,
        clearedAt: marker.clearedAt,
        status: "failed",
        completedGeneration: null,
      };
    }
    if (
      marker.status !== "complete" ||
      typeof marker.completedGeneration !== "string" ||
      !marker.completedGeneration ||
      marker.completedGeneration.length > MAX_GENERATION_LENGTH
    ) return null;
    return {
      signal: marker.signal,
      clearedAt: marker.clearedAt,
      status: "complete",
      completedGeneration: marker.completedGeneration,
    };
  } catch {
    return null;
  }
}

/**
 * Decides how hydration should treat a persisted clear boundary without
 * exposing or interpreting the snapshot's personal payload.
 *
 * @param {{status: string, signal: string, completedGeneration: string | null} | null} marker
 * @param {{clearSignal?: string, cloudGeneration?: string} | null} snapshotEnvelope
 * @param {boolean} incompatibleSnapshot
 */
export function clearMarkerHydrationAction(
  marker,
  snapshotEnvelope,
  incompatibleSnapshot = false,
) {
  if (!marker) return "hydrate";
  if (marker.status === "pending") return "recover-pending";
  if (marker.status === "failed") return "hold-failed";
  if (marker.status !== "complete" || !marker.completedGeneration) return "hydrate";
  if (
    snapshotEnvelope?.clearSignal === marker.signal &&
    snapshotEnvelope?.cloudGeneration === marker.completedGeneration
  ) return "hydrate";
  return incompatibleSnapshot ? "preserve-future" : "reset-known";
}

export function snapshotMatchesClearSignal(snapshotSignal, activeSignal) {
  const normalizedSnapshot = typeof snapshotSignal === "string" && snapshotSignal
    ? snapshotSignal
    : null;
  const normalizedActive = typeof activeSignal === "string" && activeSignal
    ? activeSignal
    : null;
  return normalizedSnapshot === normalizedActive;
}

export function guardedSnapshotWrite(observedSignal, activeSignal, write) {
  if (!snapshotMatchesClearSignal(observedSignal, activeSignal)) return "superseded";
  return write();
}

export function clearMutationAction(status, expectedGeneration, authoritativeGeneration) {
  if (Number.isInteger(status) && status >= 200 && status < 300) return "complete";
  if (
    status === 409 &&
    typeof authoritativeGeneration === "string" &&
    authoritativeGeneration &&
    authoritativeGeneration !== expectedGeneration
  ) return "stale";
  return "failed";
}
