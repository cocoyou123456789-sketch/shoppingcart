/* eslint-disable @next/next/no-img-element -- generated fitting-room assets are served directly on both Sites and GitHub Pages */
"use client";

import { useEffect, useState, type CSSProperties } from "react";
import type { AvatarGarment, AvatarOutfit, BodyMetrics } from "./Avatar3D";

const BODY_SHAPE_NAMES: Record<BodyMetrics["bodyShape"], string> = {
  straight: "直筒型",
  pear: "梨型",
  hourglass: "沙漏型",
  inverted: "倒三角型",
  apple: "苹果型",
};

function garmentText(garment: AvatarGarment | undefined) {
  return `${garment?.name ?? ""} ${garment?.style ?? ""}`;
}

function garmentLooksLike(garment: AvatarGarment | undefined, pattern: RegExp) {
  return pattern.test(garmentText(garment));
}

function garmentStyle(color: string) {
  const hex = /^#([0-9a-f]{6})$/i.exec(color)?.[1];
  const luminance = hex
    ? (Number.parseInt(hex.slice(0, 2), 16) * 0.2126 +
      Number.parseInt(hex.slice(2, 4), 16) * 0.7152 +
      Number.parseInt(hex.slice(4, 6), 16) * 0.0722) / 255
    : 0;
  const light = luminance >= 0.72;
  return {
    "--photo-garment-color": color,
    "--photo-garment-blend": light ? "screen" : "multiply",
    "--photo-garment-opacity": light ? 0.8 : 0.68,
  } as CSSProperties;
}

function outfitDescription(outfit: AvatarOutfit) {
  const garments = outfit.dress
    ? [outfit.dress.name || "连衣裙"]
    : [outfit.top?.name || (outfit.top ? "上装" : ""), outfit.bottom?.name || (outfit.bottom ? "下装" : "")].filter(Boolean);
  if (outfit.outerwear) garments.push(outfit.outerwear.name || "外套");
  return garments.length ? garments.join("、") : "中性打底衣";
}

export function RealisticAvatar({
  metrics,
  outfit,
  compact = false,
  priority = false,
}: {
  metrics: BodyMetrics;
  outfit: AvatarOutfit;
  compact?: boolean;
  priority?: boolean;
}) {
  const usesDress = Boolean(outfit.dress);
  const topIsSleeveless = garmentLooksLike(outfit.top, /无袖|背心|tank|sleeveless/i);
  const topIsCropped = garmentLooksLike(outfit.top, /短款|露腰|crop/i);
  const bottomIsSkirt = garmentLooksLike(outfit.bottom, /裙|skirt/i);
  const bottomIsShort = garmentLooksLike(outfit.bottom, /短裤|shorts?/i) || (outfit.bottom?.length ?? 100) < 58;
  const desiredSource = usesDress ? "avatar/real-model-dress-v1.jpg" : "avatar/real-model-base-v1.jpg";
  const [visibleSource, setVisibleSource] = useState(desiredSource);
  const [failedSource, setFailedSource] = useState<string | null>(null);
  const description = `真人风格模特参考：已保存身高 ${metrics.height} 厘米，身形起点为${BODY_SHAPE_NAMES[metrics.bodyShape]}，当前用${outfitDescription(outfit)}的颜色与大致款式作示意。这张照片不随身材参数变化，也不是用户本人照片；请切换三维模式查看量体、侧面和背面。`;

  useEffect(() => {
    if (desiredSource === visibleSource) return;
    let active = true;
    const nextImage = new Image();
    nextImage.onload = () => {
      if (!active) return;
      setFailedSource(null);
      setVisibleSource(desiredSource);
    };
    nextImage.onerror = () => {
      if (active) setFailedSource(desiredSource);
    };
    nextImage.src = desiredSource;
    return () => {
      active = false;
      nextImage.onload = null;
      nextImage.onerror = null;
    };
  }, [desiredSource, visibleSource]);

  return (
    <div
      className={`avatar-stage realistic-avatar-stage ${compact ? "avatar-stage--compact realistic-avatar-stage--compact" : ""}`}
      role="img"
      aria-label={description}
    >
      <div className="realistic-avatar-figure">
        <img
          key={visibleSource}
          src={visibleSource}
          alt=""
          aria-hidden="true"
          loading={priority ? "eager" : "lazy"}
          fetchPriority={priority ? "high" : "auto"}
          decoding="async"
          onLoad={() => setFailedSource((current) => current === visibleSource ? null : current)}
          onError={() => setFailedSource(visibleSource)}
        />

        {outfit.dress ? (
          <div
            className="photo-garment photo-garment--dress"
            style={garmentStyle(outfit.dress.color)}
            aria-hidden="true"
          />
        ) : (
          <>
            {outfit.top ? (
              <div
                className={`photo-garment photo-garment--top ${topIsSleeveless ? "photo-garment--sleeveless" : "photo-garment--sleeved"} ${topIsCropped ? "photo-garment--cropped" : ""}`}
                style={garmentStyle(outfit.top.color)}
                aria-hidden="true"
              />
            ) : null}
            {outfit.bottom ? (
              bottomIsSkirt ? (
                <div
                  className="photo-garment photo-garment--skirt"
                  style={garmentStyle(outfit.bottom.color)}
                  aria-hidden="true"
                />
              ) : bottomIsShort ? (
                <div
                  className="photo-garment photo-garment--shorts"
                  style={garmentStyle(outfit.bottom.color)}
                  aria-hidden="true"
                />
              ) : (
                <div
                  className="photo-garment photo-garment--trousers"
                  style={garmentStyle(outfit.bottom.color)}
                  aria-hidden="true"
                >
                  <span />
                  <span />
                </div>
              )
            ) : null}
          </>
        )}

        {outfit.outerwear ? (
          <div
            className="photo-garment photo-garment--outerwear"
            style={garmentStyle(outfit.outerwear.color)}
            aria-hidden="true"
          >
            <span />
            <span />
          </div>
        ) : null}
      </div>
      {failedSource === desiredSource ? <span className="realistic-avatar-error" role="status">真人风格照片暂未加载，请切换 3D 查看</span> : null}
      <span className="realistic-avatar-label">摄影风格参考 · 照片不随身材参数变化</span>
    </div>
  );
}
