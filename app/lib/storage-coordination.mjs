const CLEAR_MARKER_VERSION = 1;
const MAX_SIGNAL_LENGTH = 100;

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

export function serializeClearMarker(signal, clearedAt = new Date().toISOString()) {
  if (typeof signal !== "string" || !signal || signal.length > MAX_SIGNAL_LENGTH) {
    throw new TypeError("A short, non-empty clear signal is required");
  }
  return JSON.stringify({ version: CLEAR_MARKER_VERSION, signal, clearedAt });
}

export function parseClearMarker(raw) {
  if (typeof raw !== "string" || !raw) return null;
  try {
    const marker = JSON.parse(raw);
    if (
      marker?.version !== CLEAR_MARKER_VERSION ||
      typeof marker.signal !== "string" ||
      !marker.signal ||
      marker.signal.length > MAX_SIGNAL_LENGTH ||
      typeof marker.clearedAt !== "string" ||
      !Number.isFinite(Date.parse(marker.clearedAt))
    ) return null;
    return { signal: marker.signal, clearedAt: marker.clearedAt };
  } catch {
    return null;
  }
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
