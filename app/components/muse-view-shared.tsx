import type { WardrobeItem } from "../lib/muse-data";

export const DAILY_OPTIONS = {
  weather: ["炎热", "温和", "偏凉", "下雨"],
  occasion: ["通勤", "上课", "约会", "运动", "宅家"],
  feeling: ["轻松", "利落", "温柔", "有点亮眼"],
  comfort: ["方便走动", "宽松", "不露肤", "保暖"],
} as const;

export function ProductVisual({
  visual,
  color,
  spriteIndex,
}: {
  visual: string;
  color: string;
  spriteIndex?: number;
}) {
  if (typeof spriteIndex === "number") {
    const column = spriteIndex % 4;
    const row = Math.floor(spriteIndex / 4);
    return (
      <div
        aria-hidden="true"
        className="product-photo-sprite"
        style={{
          "--sprite-x": `${(column / 3) * 100}%`,
          "--sprite-y": `${(row / 3) * 100}%`,
        } as React.CSSProperties}
      />
    );
  }
  return (
    <div className={`product-visual product-visual--${visual}`} style={{ "--item-color": color } as React.CSSProperties}>
      <span className="visual-shape" aria-hidden="true" />
      <span className="visual-shadow" aria-hidden="true" />
    </div>
  );
}

export function MiniGarment({ item }: { item: Pick<WardrobeItem, "category" | "color"> }) {
  const visual =
    item.category === "下装"
      ? "pants"
      : item.category === "连衣裙"
        ? "dress"
        : item.category === "外套"
          ? "coat"
          : item.category === "鞋履"
            ? "shoes"
            : item.category === "配饰"
              ? "bag"
              : "shirt";
  return <ProductVisual visual={visual} color={item.color} />;
}

export function todayLabel() {
  return new Intl.DateTimeFormat("zh-CN", {
    month: "long",
    day: "numeric",
    weekday: "long",
  }).format(new Date());
}
