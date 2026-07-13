export type ClosetCategory =
  | "上装"
  | "下装"
  | "连衣裙"
  | "外套"
  | "鞋履"
  | "配饰";

export type ShopCategory = ClosetCategory | "美妆" | "装饰";

export type WardrobeItem = {
  id: string;
  clientId?: string;
  name: string;
  category: ClosetCategory;
  color: string;
  colorName: string;
  size: string;
  source: "我的衣服" | "虚拟商品" | "示例衣物";
  sourceUrl?: string;
  imageUrl?: string;
  season: string;
  style: string;
  chest?: number;
  waist?: number;
  hips?: number;
  length?: number;
  confidence: "高" | "中" | "待确认";
};

export type Product = {
  id: string;
  name: string;
  category: ShopCategory;
  color: string;
  colorName: string;
  points: number;
  subtitle: string;
  style: string;
  season: string;
  visual: string;
};

export const PRODUCTS: Product[] = [
  {
    id: "p-soft-shirt",
    name: "云朵感宽松衬衫",
    category: "上装",
    color: "#d7dff0",
    colorName: "雾霾蓝",
    points: 168,
    subtitle: "轻薄棉感 · 微落肩",
    style: "轻松",
    season: "春秋",
    visual: "shirt",
  },
  {
    id: "p-knit",
    name: "柔光针织短开衫",
    category: "上装",
    color: "#e9b8aa",
    colorName: "蜜桃粉",
    points: 139,
    subtitle: "亲肤针织 · 常规版",
    style: "温柔",
    season: "春秋",
    visual: "cardigan",
  },
  {
    id: "p-trousers",
    name: "散步感阔腿裤",
    category: "下装",
    color: "#6d7169",
    colorName: "鼠尾草灰",
    points: 189,
    subtitle: "高腰垂感 · 宽松版",
    style: "利落",
    season: "四季",
    visual: "pants",
  },
  {
    id: "p-dress",
    name: "傍晚微风连衣裙",
    category: "连衣裙",
    color: "#73678f",
    colorName: "暮色紫",
    points: 239,
    subtitle: "收腰 A 摆 · 中长款",
    style: "温柔",
    season: "春夏",
    visual: "dress",
  },
  {
    id: "p-coat",
    name: "杏仁拿铁薄风衣",
    category: "外套",
    color: "#b6a38d",
    colorName: "燕麦杏",
    points: 299,
    subtitle: "微廓形 · 轻量防风",
    style: "利落",
    season: "春秋",
    visual: "coat",
  },
  {
    id: "p-shoes",
    name: "慢慢走德训鞋",
    category: "鞋履",
    color: "#d9d5cb",
    colorName: "奶油白",
    points: 159,
    subtitle: "软底 · 适合走动",
    style: "轻松",
    season: "四季",
    visual: "shoes",
  },
  {
    id: "p-lip",
    name: "好气色雾面唇泥",
    category: "美妆",
    color: "#a85b5b",
    colorName: "烤杏红",
    points: 89,
    subtitle: "柔雾妆效 · 低饱和",
    style: "有点亮眼",
    season: "四季",
    visual: "lip",
  },
  {
    id: "p-lamp",
    name: "睡前月亮氛围灯",
    category: "装饰",
    color: "#d8b883",
    colorName: "暖月光",
    points: 129,
    subtitle: "柔和暖光 · 三档亮度",
    style: "治愈",
    season: "四季",
    visual: "lamp",
  },
  {
    id: "p-bag",
    name: "装下小事帆布包",
    category: "配饰",
    color: "#a6b39d",
    colorName: "苔藓绿",
    points: 119,
    subtitle: "轻量帆布 · 大容量",
    style: "轻松",
    season: "四季",
    visual: "bag",
  },
];

export const SAMPLE_WARDROBE: WardrobeItem[] = [
  {
    id: "w-cream-tee",
    name: "奶油白基础 T 恤",
    category: "上装",
    color: "#e8e1d3",
    colorName: "奶油白",
    size: "M",
    source: "示例衣物",
    season: "四季",
    style: "轻松",
    chest: 100,
    length: 62,
    confidence: "高",
  },
  {
    id: "w-blue-shirt",
    name: "浅蓝落肩衬衫",
    category: "上装",
    color: "#aebfd1",
    colorName: "晨雾蓝",
    size: "M",
    source: "示例衣物",
    season: "春秋",
    style: "利落",
    chest: 108,
    length: 68,
    confidence: "中",
  },
  {
    id: "w-green-pants",
    name: "苔绿直筒长裤",
    category: "下装",
    color: "#626b58",
    colorName: "苔藓绿",
    size: "M",
    source: "示例衣物",
    season: "四季",
    style: "利落",
    waist: 76,
    hips: 102,
    length: 101,
    confidence: "高",
  },
  {
    id: "w-lilac-skirt",
    name: "浅紫伞摆半裙",
    category: "下装",
    color: "#9d8fb5",
    colorName: "浅丁香",
    size: "L",
    source: "示例衣物",
    season: "春夏",
    style: "温柔",
    waist: 78,
    hips: 112,
    length: 76,
    confidence: "中",
  },
  {
    id: "w-coral-dress",
    name: "珊瑚色系带连衣裙",
    category: "连衣裙",
    color: "#c77868",
    colorName: "柔珊瑚",
    size: "L",
    source: "示例衣物",
    season: "春夏",
    style: "有点亮眼",
    chest: 98,
    waist: 84,
    hips: 110,
    length: 114,
    confidence: "待确认",
  },
  {
    id: "w-oat-coat",
    name: "燕麦色轻薄风衣",
    category: "外套",
    color: "#b9a68f",
    colorName: "燕麦杏",
    size: "M",
    source: "示例衣物",
    season: "春秋",
    style: "利落",
    chest: 112,
    length: 83,
    confidence: "高",
  },
];

export const BODY_PRESETS = {
  straight: { shoulder: 40, chest: 88, waist: 76, hips: 91 },
  pear: { shoulder: 38, chest: 86, waist: 72, hips: 101 },
  hourglass: { shoulder: 40, chest: 94, waist: 70, hips: 98 },
  inverted: { shoulder: 45, chest: 96, waist: 76, hips: 89 },
  apple: { shoulder: 41, chest: 98, waist: 91, hips: 96 },
} as const;
