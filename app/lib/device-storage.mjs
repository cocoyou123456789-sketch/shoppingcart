// @ts-check

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
