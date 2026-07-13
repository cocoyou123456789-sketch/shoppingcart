import type { ClosetCategory } from "./muse-data";

export const CLOSET_CATEGORIES: readonly ("全部" | ClosetCategory)[] = [
  "全部",
  "上装",
  "下装",
  "连衣裙",
  "外套",
  "鞋履",
  "配饰",
];

export const SEASON_OPTIONS = ["四季", "春夏", "春秋"] as const;
export const STYLE_OPTIONS = ["轻松", "利落", "温柔", "有点亮眼"] as const;
export const CLIENT_IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
export const MAX_CLIENT_IMAGE_BYTES = 6 * 1024 * 1024;

export function colorNameFromHex(color: string) {
  const names: Record<string, string> = {
    "#d7dff0": "雾霾蓝",
    "#e9b8aa": "蜜桃粉",
    "#6d7169": "鼠尾草灰",
    "#73678f": "暮色紫",
    "#b6a38d": "燕麦杏",
    "#d9d5cb": "奶油白",
    "#c77868": "柔珊瑚",
    "#a6b39d": "苔藓绿",
  };
  return names[color] ?? "自定义颜色";
}
