// @ts-check

const WARDROBE_PRODUCT_CATEGORIES = new Set([
  "上装",
  "下装",
  "连衣裙",
  "外套",
  "鞋履",
  "配饰",
]);

const AVATAR_CATEGORIES = new Set(["上装", "下装", "连衣裙", "外套"]);

/** @param {string} category */
export function supportsAvatarTryOn(category) {
  return AVATAR_CATEGORIES.has(category);
}

/**
 * @param {{ id: string, name: string, category: string, color: string, colorName: string, season: string, style: string }} product
 */
export function createVirtualWardrobeItem(product) {
  if (!WARDROBE_PRODUCT_CATEGORIES.has(product.category)) return null;
  return {
    id: `virtual-${product.id}`,
    name: product.name,
    category: product.category,
    color: product.color,
    colorName: product.colorName,
    size: "M",
    source: "虚拟商品",
    season: product.season,
    style: product.style,
    confidence: "待确认",
  };
}

/**
 * @param {{ topId?: string, bottomId?: string, dressId?: string, outerwearId?: string }} current
 * @param {{ id: string, category: string }} item
 */
export function wearWardrobeItem(current, item) {
  if (item.category === "上装") {
    return { ...current, topId: item.id, dressId: undefined };
  }
  if (item.category === "下装") {
    return { ...current, bottomId: item.id, dressId: undefined };
  }
  if (item.category === "连衣裙") {
    return { dressId: item.id, outerwearId: current.outerwearId };
  }
  if (item.category === "外套") {
    return { ...current, outerwearId: item.id };
  }
  return current;
}

/**
 * Describes the visible consequence of wearing an item, including the
 * separates/dress exclusivity that would otherwise look like a silent removal.
 *
 * @param {{ topId?: string, bottomId?: string, dressId?: string, outerwearId?: string }} current
 * @param {{ id: string, name?: string, category: string }} item
 */
export function wearWardrobeItemAnnouncement(current, item) {
  const name = item.name?.trim() || "这件衣物";
  if (item.category === "连衣裙") {
    const removed = [current.topId && "上装", current.bottomId && "下装"].filter(Boolean);
    if (removed.length) return `${name}已穿上，并自动脱下原有${removed.join("和")}`;
    if (current.dressId && current.dressId !== item.id) return `${name}已穿上，并替换原有连衣裙`;
  }
  if (item.category === "上装") {
    if (current.dressId) return `${name}已穿上，并自动脱下原有连衣裙`;
    if (current.topId && current.topId !== item.id) return `${name}已穿上，并替换原有上装`;
  }
  if (item.category === "下装") {
    if (current.dressId) return `${name}已穿上，并自动脱下原有连衣裙`;
    if (current.bottomId && current.bottomId !== item.id) return `${name}已穿上，并替换原有下装`;
  }
  if (
    item.category === "外套" &&
    current.outerwearId &&
    current.outerwearId !== item.id
  ) return `${name}已穿上，并替换原有外套`;
  return `${name}已穿上`;
}

/**
 * @param {{ topId?: string, bottomId?: string, dressId?: string, outerwearId?: string }} outfit
 * @param {Array<{ id: string, category: string, color: string, chest?: number, waist?: number, hips?: number, length?: number }>} wardrobe
 */
export function avatarOutfitFromSelection(outfit, wardrobe) {
  /**
   * @param {string | undefined} id
   * @param {string} expectedCategory
   */
  const findGarment = (id, expectedCategory) => {
    const item = wardrobe.find(
      (candidate) => candidate.id === id && candidate.category === expectedCategory,
    );
    if (!item) return undefined;
    return {
      color: item.color,
      chest: item.chest,
      waist: item.waist,
      hips: item.hips,
      length: item.length,
    };
  };
  return {
    top: findGarment(outfit.topId, "上装"),
    bottom: findGarment(outfit.bottomId, "下装"),
    dress: findGarment(outfit.dressId, "连衣裙"),
    outerwear: findGarment(outfit.outerwearId, "外套"),
  };
}
