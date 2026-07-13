export function hasPendingWardrobeItems(wardrobe, cloudItemIds) {
  return wardrobe.some(
    (item) => item?.source === "我的衣服" && !cloudItemIds.has(item.id),
  );
}

export function replaceSyncedWardrobeItem(wardrobe, outfit, localId, cloudItem) {
  if (!wardrobe.some((item) => item.id === localId)) {
    return { wardrobe, outfit, applied: false };
  }
  const replaceId = (value) => (value === localId ? cloudItem.id : value);
  return {
    wardrobe: [
      cloudItem,
      ...wardrobe.filter((item) => item.id !== localId && item.id !== cloudItem.id),
    ],
    outfit: {
      topId: replaceId(outfit?.topId),
      bottomId: replaceId(outfit?.bottomId),
      dressId: replaceId(outfit?.dressId),
      outerwearId: replaceId(outfit?.outerwearId),
    },
    applied: true,
  };
}

export function removeWardrobeIdentity(wardrobe, outfit, clientId, itemIds = []) {
  const removedIds = new Set([clientId, ...itemIds].filter(Boolean));
  for (const item of wardrobe) {
    if (item.clientId === clientId) removedIds.add(item.id);
  }
  const clearId = (value) => (removedIds.has(value) ? undefined : value);
  return {
    wardrobe: wardrobe.filter(
      (item) => item.clientId !== clientId && !removedIds.has(item.id),
    ),
    outfit: {
      topId: clearId(outfit?.topId),
      bottomId: clearId(outfit?.bottomId),
      dressId: clearId(outfit?.dressId),
      outerwearId: clearId(outfit?.outerwearId),
    },
  };
}
