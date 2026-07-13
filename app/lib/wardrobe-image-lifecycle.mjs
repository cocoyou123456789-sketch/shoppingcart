export const IMAGE_UPLOAD_STATE = {
  uploading: "uploading",
  ready: "ready",
};

export const ABANDONED_IMAGE_UPLOAD_MINUTES = 15;

/**
 * A clear may delete an image only after its writer has reached a terminal
 * state. An abandoned lease is terminal because no supported wardrobe upload
 * can remain active for the lease timeout.
 *
 * Rows without a cleanup state are stable wardrobe images captured directly
 * from wardrobe_items, so they are immediately safe to delete.
 */
export function planClearedImageDrain(rows) {
  const deletableKeys = [];
  const pendingKeys = [];

  for (const row of rows) {
    const activeUpload =
      row.upload_state === IMAGE_UPLOAD_STATE.uploading &&
      Number(row.upload_abandoned) !== 1;
    const safeToDelete =
      row.upload_state == null ||
      row.upload_state === IMAGE_UPLOAD_STATE.ready ||
      (row.upload_state === IMAGE_UPLOAD_STATE.uploading &&
        Number(row.upload_abandoned) === 1);
    if (activeUpload || !safeToDelete) {
      pendingKeys.push(row.image_key);
    } else {
      deletableKeys.push(row.image_key);
    }
  }

  return { deletableKeys, pendingKeys };
}

/**
 * Resolves an ambiguous D1 insert result without deleting an image that may
 * already be the authoritative wardrobe attachment.
 */
export function stagedImageResolution(stagedImageKey, replayImageKey) {
  if (!stagedImageKey) return "none";
  return stagedImageKey === replayImageKey ? "attached" : "discard";
}

/**
 * Runs the R2 write only after D1 has durably reserved an uploading lease.
 * markReady must finish before callers may attach the key to a wardrobe item.
 * If either external write or final handoff fails, discard keeps the lease
 * until R2 deletion is confirmed.
 */
export async function stageTrackedWardrobeImage({
  reserve,
  put,
  markReady,
  markFailed = markReady,
  discard,
}) {
  if (!(await reserve())) return { status: "stale" };

  try {
    await put();
    await markReady();
    return { status: "ready" };
  } catch (error) {
    try {
      // The writer is now terminal, including after an ambiguous put error.
      // Moving the lease out of uploading lets clear retry immediately even
      // when R2 deletion succeeds but the later metadata delete fails.
      await markFailed();
    } catch {
      // Keep the original uploading lease if D1 itself is unavailable. It is
      // still safe and will be reclaimed by the abandoned-lease path.
    }
    try {
      await discard();
    } catch {
      // The durable uploading/ready lease remains. Clear and request-driven
      // cleanup can retry after the writer has stopped.
    }
    throw error;
  }
}
