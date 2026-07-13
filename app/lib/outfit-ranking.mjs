// @ts-check

/** @typedef {{ id: string }} OutfitItem */
/**
 * @typedef {{
 *   topId?: string,
 *   bottomId?: string,
 *   dressId?: string,
 *   outerwearId?: string,
 * }} OutfitSelection
 */

/**
 * Builds complete outfits before ranking them, so the first suggestion is the
 * highest-scoring look rather than a pair of independently rotated items.
 *
 * @template {OutfitItem} T
 * @param {{
 *   tops: T[],
 *   bottoms: T[],
 *   dresses: T[],
 *   outers: T[],
 *   needsOuterwear: boolean,
 *   scoreItem: (item: T) => number,
 * }} input
 */
export function rankOutfitSelections({
  tops,
  bottoms,
  dresses,
  outers,
  needsOuterwear,
  scoreItem,
}) {
  const outerOptions = needsOuterwear && outers.length ? outers.slice(0, 3) : [undefined];
  /** @type {Array<{ selection: OutfitSelection, score: number, key: string }>} */
  const looks = [];

  /** @param {T[]} items @param {OutfitSelection} selection */
  const addLook = (items, selection) => {
    for (const outer of outerOptions) {
      const nextSelection = outer ? { ...selection, outerwearId: outer.id } : selection;
      const key = [
        nextSelection.topId,
        nextSelection.bottomId,
        nextSelection.dressId,
        nextSelection.outerwearId,
      ].filter(Boolean).join("|");
      looks.push({
        selection: nextSelection,
        score: items.reduce((total, item) => total + scoreItem(item), 0) / items.length +
          (outer ? scoreItem(outer) : 0),
        key,
      });
    }
  };

  for (const top of tops) {
    for (const bottom of bottoms) addLook([top, bottom], { topId: top.id, bottomId: bottom.id });
  }
  for (const dress of dresses) addLook([dress], { dressId: dress.id });

  return looks.sort((left, right) => right.score - left.score || left.key.localeCompare(right.key));
}
