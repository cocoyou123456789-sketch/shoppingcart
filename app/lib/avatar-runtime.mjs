export function replaceRuntimeAvatar(runtime, nextAvatar, disposeAvatar) {
  const previousAvatar = runtime.avatar;
  runtime.scene.add(nextAvatar);
  runtime.avatar = nextAvatar;
  runtime.scene.remove(previousAvatar);
  disposeAvatar(previousAvatar);
  runtime.renderer.shadowMap.needsUpdate = true;
  return previousAvatar;
}

export function isActiveAvatarRuntime(currentRuntime, candidateRuntime, tornDown = false) {
  return Boolean(
    !tornDown &&
    candidateRuntime &&
    currentRuntime === candidateRuntime &&
    candidateRuntime.disposed !== true
  );
}

export function disposeUniqueResources(resources, retained, disposeResource) {
  const retainedResources = retained instanceof Set ? retained : new Set(retained);
  let disposed = 0;
  for (const resource of new Set(resources)) {
    if (retainedResources.has(resource)) continue;
    disposeResource(resource);
    disposed += 1;
  }
  return disposed;
}

const FULL_GEOMETRY_DETAIL = Object.freeze({
  head: [32, 24],
  hair: [28, 20],
  eye: [10, 8],
  body: [32, 24],
  cylinder: 32,
  capsule: [8, 16],
  shoe: [20, 14],
  floor: 48,
});

const REDUCED_GEOMETRY_DETAIL = Object.freeze({
  head: [24, 18],
  hair: [20, 16],
  eye: [8, 6],
  body: [24, 18],
  cylinder: 24,
  capsule: [6, 12],
  shoe: [16, 12],
  floor: 36,
});

export const AVATAR_AUTO_ROTATE_MS = 4_500;
export const AVATAR_MAX_PHYSICAL_PIXELS = 1_100_000;

export function avatarPixelRatio(width, height, devicePixelRatio, reducedDetail) {
  const measuredWidth = Math.max(1, Number(width) || 1);
  const measuredHeight = Math.max(1, Number(height) || 1);
  const measuredCssPixels = measuredWidth * measuredHeight;
  const cssPixels = Number.isFinite(measuredCssPixels)
    ? Math.max(1, measuredCssPixels)
    : AVATAR_MAX_PHYSICAL_PIXELS;
  const displayRatio = Math.max(1, Number(devicePixelRatio) || 1);
  const qualityLimit = reducedDetail ? 1.25 : 2;
  const budgetLimit = Math.sqrt(AVATAR_MAX_PHYSICAL_PIXELS / cssPixels);
  return Math.min(displayRatio, qualityLimit, budgetLimit);
}

export function avatarZoomPercent(defaultDistance, currentDistance) {
  const parsedBaseline = Number(defaultDistance);
  if (!Number.isFinite(parsedBaseline) || parsedBaseline <= 0) return 100;
  const baseline = parsedBaseline;
  const parsedDistance = Number(currentDistance);
  const distance = Number.isFinite(parsedDistance) && parsedDistance > 0
    ? parsedDistance
    : baseline;
  return Math.round(Math.max(50, Math.min(200, baseline / distance * 100)));
}

export function createVisibleTimeBudget(durationMs) {
  return {
    remainingMs: Math.max(0, durationMs),
    startedAt: null,
  };
}

export function resumeVisibleTimeBudget(budget, now) {
  if (budget.remainingMs > 0 && budget.startedAt === null) {
    budget.startedAt = now;
  }
  return budget.remainingMs;
}

export function pauseVisibleTimeBudget(budget, now) {
  if (budget.startedAt !== null) {
    budget.remainingMs = Math.max(
      0,
      budget.remainingMs - Math.max(0, now - budget.startedAt),
    );
    budget.startedAt = null;
  }
  return budget.remainingMs;
}

export function cancelVisibleTimeBudget(budget) {
  budget.remainingMs = 0;
  budget.startedAt = null;
  return 0;
}

export function avatarGeometryDetail(reduced) {
  return reduced ? REDUCED_GEOMETRY_DETAIL : FULL_GEOMETRY_DETAIL;
}

export function avatarAriaDescription(metrics, outfit) {
  const bodyShapeNames = {
    straight: "直筒型",
    pear: "梨型",
    hourglass: "沙漏型",
    inverted: "倒三角型",
    apple: "苹果型",
  };
  const garmentLabel = (garment, fallback) => {
    if (!garment) return null;
    const name = typeof garment.name === "string" ? garment.name.trim() : "";
    return name || fallback;
  };
  const garments = outfit?.dress
    ? [garmentLabel(outfit.dress, "连衣裙")]
    : [
        garmentLabel(outfit?.top, "上装"),
        garmentLabel(outfit?.bottom, "下装"),
      ].filter(Boolean);
  const outerwear = garmentLabel(outfit?.outerwear, "外套");
  if (outerwear) garments.push(outerwear);
  const outfitLabel = garments.length ? garments.join("、") : "尚未选择衣物";
  return `三维数字分身预览：身高 ${metrics.height} 厘米，${bodyShapeNames[metrics.bodyShape] ?? "自定义体型"}，${outfitLabel}。可使用下方按钮查看正面、侧面和背面，并放大或缩小。`;
}
