export const OFFICIAL_STORE_HOSTS = Object.freeze([
  "www.taobao.com",
  "www.tmall.com",
  "www.zara.cn",
  "www.aritzia.com",
  "www.uniqlo.cn",
  "www.lululemon.cn",
  "snidel.us",
]);

const officialStoreHosts = new Set(OFFICIAL_STORE_HOSTS);

/**
 * Only accepts the exact HTTPS hosts used by the curated store directory.
 * This intentionally does not use suffix matching, which could accept a
 * lookalike such as `www.zara.cn.example.com`.
 */
export function isOfficialStoreUrl(value) {
  try {
    const url = new URL(value);
    return (
      url.protocol === "https:" &&
      !url.username &&
      !url.password &&
      (!url.port || url.port === "443") &&
      officialStoreHosts.has(url.hostname.toLowerCase())
    );
  } catch {
    return false;
  }
}

export const OFFICIAL_STORES = Object.freeze([
  {
    id: "taobao",
    name: "淘宝",
    mark: "淘",
    href: "https://www.taobao.com/",
    hostLabel: "taobao.com",
    market: "中国大陆 · 综合平台",
    verification: "平台入口",
    summary: "搜索女装和店铺；下单前请在平台内确认店铺身份、尺码与退换规则。",
    accent: "#f0a16f",
  },
  {
    id: "tmall",
    name: "天猫",
    mark: "天",
    href: "https://www.tmall.com/",
    hostLabel: "tmall.com",
    market: "中国大陆 · 综合平台",
    verification: "平台入口",
    summary: "浏览品牌店与女装商品；真实价格、库存和店铺资质以天猫页面为准。",
    accent: "#d88991",
  },
  {
    id: "zara",
    name: "ZARA",
    mark: "Z",
    href: "https://www.zara.cn/cn/zh/woman-new-in-l1180.html",
    hostLabel: "zara.cn",
    market: "中国大陆 · 女士新品",
    verification: "域名已核对",
    summary: "进入 ZARA 中国女士新品页；购买、配送和退换货由品牌官网处理。",
    accent: "#c7b8ae",
  },
  {
    id: "aritzia",
    name: "Aritzia",
    mark: "A",
    href: "https://www.aritzia.com/intl/en/new",
    hostLabel: "aritzia.com",
    market: "国际站 · 女士新品",
    verification: "域名已核对",
    summary: "国际站可查看中国配送选项；币种、运费、税费与时效以结账页为准。",
    accent: "#d9c9bc",
  },
  {
    id: "uniqlo",
    name: "UNIQLO",
    mark: "U",
    href: "https://www.uniqlo.cn/",
    hostLabel: "uniqlo.cn",
    market: "中国大陆 · 网络旗舰店",
    verification: "域名已核对",
    summary: "进入 UNIQLO 中国网络旗舰店，再按女装、尺码和系列慢慢筛选。",
    accent: "#df9994",
  },
  {
    id: "lululemon",
    name: "lululemon",
    mark: "L",
    href: "https://www.lululemon.cn/gallery-25.html",
    hostLabel: "lululemon.cn",
    market: "中国大陆 · 女士全品类",
    verification: "域名已核对",
    summary: "进入中国大陆官方商城女装页；尺码、库存和售后以商品页面为准。",
    accent: "#c9a5ae",
  },
  {
    id: "snidel",
    name: "SNIDEL",
    mark: "S",
    href: "https://snidel.us/collections/whats-new",
    hostLabel: "snidel.us",
    market: "国际站 · 女士新品",
    verification: "域名已核对",
    summary: "官方国际站支持选择中国币种；是否配送到你的地址请在结账页确认。",
    accent: "#cfb7c4",
  },
]);

if (!OFFICIAL_STORES.every((store) => isOfficialStoreUrl(store.href))) {
  throw new Error("Official store directory contains an unapproved URL");
}
