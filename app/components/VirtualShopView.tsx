"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  createVirtualWardrobeItem,
  supportsAvatarTryOn,
} from "../lib/try-on-state.mjs";
import { PRODUCTS, type ShopCategory } from "../lib/muse-data";
import { ProductVisual } from "./muse-view-shared";
import type { ShopViewProps } from "./muse-view-types";

const SHOP_CATEGORIES: ("全部" | ShopCategory)[] = [
  "全部",
  "上装",
  "下装",
  "连衣裙",
  "外套",
  "鞋履",
  "配饰",
  "美妆",
  "装饰",
];

const SHOP_STYLES = [
  "全部风格",
  "静奢感",
  "极简",
  "浪漫",
  "通勤",
  "假日",
  "约会",
] as const;

const COLLECTIONS: {
  style: Exclude<(typeof SHOP_STYLES)[number], "全部风格">;
  eyebrow: string;
  title: string;
  copy: string;
  spriteIndex: number;
}[] = [
  {
    style: "静奢感",
    eyebrow: "QUIET CONFIDENCE",
    title: "安静高级",
    copy: "奶油色、柔软材质与利落轮廓",
    spriteIndex: 4,
  },
  {
    style: "约会",
    eyebrow: "DATE NIGHT",
    title: "约会微光",
    copy: "缎面、珍珠，再加一点酒红",
    spriteIndex: 8,
  },
  {
    style: "通勤",
    eyebrow: "OFFICE EASE",
    title: "通勤松弛",
    copy: "从上午会议穿到傍晚散步",
    spriteIndex: 2,
  },
  {
    style: "假日",
    eyebrow: "SLOW WEEKEND",
    title: "周末慢游",
    copy: "轻装、软底与没有安排的下午",
    spriteIndex: 5,
  },
];

type SortOption = "featured" | "price-low" | "price-high" | "newest";
type VirtualShopViewProps = Omit<ShopViewProps, "onImportLink">;

export function VirtualShopView({
  saved,
  onToggleSaved,
  onAdd,
  onTry,
}: VirtualShopViewProps) {
  const [category, setCategory] = useState<(typeof SHOP_CATEGORIES)[number]>("全部");
  const [style, setStyle] = useState<(typeof SHOP_STYLES)[number]>("全部风格");
  const [sort, setSort] = useState<SortOption>("featured");
  const [query, setQuery] = useState("");
  const [savedOnly, setSavedOnly] = useState(false);
  const [resultAnnouncement, setResultAnnouncement] = useState("");
  const savedFilterRef = useRef<HTMLButtonElement>(null);
  const catalogRef = useRef<HTMLElement>(null);
  const normalizedQuery = query.trim().toLocaleLowerCase("zh-CN");
  const savedSet = useMemo(() => new Set(saved), [saved]);
  const visible = useMemo(() => {
    const matches = PRODUCTS.filter((product) => {
      const searchable = [
        product.name,
        product.brand,
        product.colorName,
        product.subtitle,
        ...product.shopStyles,
      ].join(" ").toLocaleLowerCase("zh-CN");
      return (
        (category === "全部" || product.category === category) &&
        (style === "全部风格" || product.shopStyles.includes(style)) &&
        (!normalizedQuery || searchable.includes(normalizedQuery)) &&
        (!savedOnly || savedSet.has(product.id))
      );
    });
    return matches.sort((a, b) => {
      if (sort === "price-low") return a.points - b.points;
      if (sort === "price-high") return b.points - a.points;
      if (sort === "newest") return b.newnessRank - a.newnessRank;
      return a.featuredRank - b.featuredRank;
    });
  }, [category, normalizedQuery, savedOnly, savedSet, sort, style]);

  function chooseCollection(nextStyle: (typeof COLLECTIONS)[number]["style"]) {
    setCategory("全部");
    setQuery("");
    setSavedOnly(false);
    setStyle(nextStyle);
    window.requestAnimationFrame(() => {
      catalogRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  }

  function toggleSavedAndRestoreFocus(
    productId: string,
    event: React.MouseEvent<HTMLButtonElement>,
  ) {
    const button = event.currentTarget;
    const grid = button.closest<HTMLElement>(".product-grid");
    const buttonsBefore = grid
      ? Array.from(grid.querySelectorAll<HTMLButtonElement>(".save-button"))
      : [];
    const focusIndex = Math.max(0, buttonsBefore.indexOf(button));
    const willDisappear = savedOnly && savedSet.has(productId);
    onToggleSaved(productId);
    if (!willDisappear) return;
    window.requestAnimationFrame(() => {
      const buttonsAfter = grid?.isConnected
        ? Array.from(grid.querySelectorAll<HTMLButtonElement>(".save-button"))
        : [];
      const target = buttonsAfter[Math.min(focusIndex, buttonsAfter.length - 1)];
      (target ?? savedFilterRef.current)?.focus();
    });
  }

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const filters = [
        category === "全部" ? "全部品类" : category,
        style === "全部风格" ? "" : style,
        savedOnly ? "收藏" : "",
      ].filter(Boolean).join("、");
      const search = normalizedQuery ? `搜索“${query.trim()}”时，` : "";
      setResultAnnouncement(`${search}${filters}中找到 ${visible.length} 件虚拟商品`);
    }, 300);
    return () => window.clearTimeout(timer);
  }, [category, normalizedQuery, query, savedOnly, style, visible.length]);

  return (
    <>
      <section className="virtual-collections" aria-labelledby="collection-title">
        <div className="virtual-section-heading">
          <div>
            <p className="eyebrow">CURATED MOODS · 按今天的心情逛</p>
            <h2 id="collection-title">先从一种感觉开始。</h2>
          </div>
          <p>不用想“该不该买”，只看看什么会让今天更像你。</p>
        </div>
        <div className="collection-grid">
          {COLLECTIONS.map((collection) => (
            <button
              type="button"
              className="collection-card"
              key={collection.style}
              onClick={() => chooseCollection(collection.style)}
              aria-label={`查看${collection.title}系列`}
            >
              <span className="collection-art">
                <ProductVisual
                  visual=""
                  color=""
                  spriteIndex={collection.spriteIndex}
                />
              </span>
              <span className="collection-copy">
                <small>{collection.eyebrow}</small>
                <strong>{collection.title}</strong>
                <span>{collection.copy}</span>
                <i>逛这个系列 →</i>
              </span>
            </button>
          ))}
        </div>
      </section>

      <section
        ref={catalogRef}
        className="virtual-catalog"
        id="virtual-catalog"
        aria-labelledby="catalog-title"
      >
        <div className="virtual-section-heading virtual-section-heading--catalog">
          <div>
            <p className="eyebrow">DISCOVER · 0 元商品目录</p>
            <h2 id="catalog-title">随心发现</h2>
          </div>
          <p><strong>{visible.length}</strong> 件灵感 · 实际支付永远是 0</p>
        </div>

        <div className="shop-toolbar">
          <div className="search-box">
            <span aria-hidden="true">⌕</span>
            <input
              type="search"
              aria-label="搜索虚拟商品"
              placeholder="搜索单品、品牌、颜色或风格"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </div>
          <div className="shop-toolbar-actions">
            <label className="shop-sort">
              <span>排序</span>
              <select
                value={sort}
                onChange={(event) => setSort(event.target.value as SortOption)}
                aria-label="商品排序"
              >
                <option value="featured">编辑精选</option>
                <option value="newest">最新加入</option>
                <option value="price-low">虚拟价：低到高</option>
                <option value="price-high">虚拟价：高到低</option>
              </select>
            </label>
            <button
              ref={savedFilterRef}
              type="button"
              className={`saved-filter ${savedOnly ? "is-active" : ""}`}
              aria-pressed={savedOnly}
              onClick={() => setSavedOnly((current) => !current)}
            >
              ♡ 心动收藏 <b>{saved.length}</b>
            </button>
          </div>
        </div>

        <div className="catalog-filter-row">
          <span>品类</span>
          <div className="chip-row" role="group" aria-label="商品品类筛选">
            {SHOP_CATEGORIES.map((item) => (
              <button
                type="button"
                key={item}
                aria-pressed={category === item}
                className={category === item ? "is-active" : ""}
                onClick={() => setCategory(item)}
              >
                {item}
              </button>
            ))}
          </div>
        </div>
        <div className="catalog-filter-row">
          <span>风格</span>
          <div className="chip-row" role="group" aria-label="商品风格筛选">
            {SHOP_STYLES.map((item) => (
              <button
                type="button"
                key={item}
                aria-pressed={style === item}
                className={style === item ? "is-active" : ""}
                onClick={() => setStyle(item)}
              >
                {item}
              </button>
            ))}
          </div>
        </div>
      </section>

      <p className="sr-only" role="status" aria-live="polite" aria-atomic="true">
        {resultAnnouncement}
      </p>
      <section className="product-grid" aria-label="0 元虚拟商品">
        {visible.map((product) => {
          const wardrobeCandidate = createVirtualWardrobeItem(product);
          const isSaved = savedSet.has(product.id);
          return (
            <article className="product-card" key={product.id}>
              <div className="product-image-wrap">
                {product.newnessRank >= 13 && <span className="virtual-pill">NEW</span>}
                <button
                  type="button"
                  className={`save-button ${isSaved ? "is-saved" : ""}`}
                  onClick={(event) => toggleSavedAndRestoreFocus(product.id, event)}
                  aria-label={isSaved ? `取消收藏${product.name}` : `收藏${product.name}`}
                  aria-pressed={isSaved}
                >
                  ♡
                </button>
                <ProductVisual
                  visual={product.visual}
                  color={product.color}
                  spriteIndex={product.spriteIndex}
                />
              </div>
              <div className="product-info">
                <p className="product-brand">{product.brand}</p>
                <h2>{product.name}</h2>
                <p>{product.subtitle}</p>
                <div className="product-style-tags" aria-label={`风格：${product.shopStyles.join("、")}`}>
                  {product.shopStyles.slice(0, 2).map((tag) => <span key={tag}>{tag}</span>)}
                </div>
                <div className="product-bottom">
                  <strong><small>虚拟价</small> {product.points} 松松币</strong>
                  <span>实际 ¥0</span>
                </div>
                <div className={`product-actions ${wardrobeCandidate ? "" : "product-actions--single"}`}>
                  {wardrobeCandidate && (
                    <button type="button" className="button button--soft" onClick={() => onTry(product)}>
                      {supportsAvatarTryOn(product.category) ? "试穿看看" : "收入衣橱"}
                    </button>
                  )}
                  <button type="button" className="button button--dark" onClick={() => onAdd(product)}>
                    放进梦想袋
                  </button>
                </div>
              </div>
            </article>
          );
        })}
      </section>
      {!visible.length && (
        <div className="empty-state">
          <span>⌁</span>
          <h2>{savedOnly ? "还没有心动收藏" : "这一格暂时空着"}</h2>
          <p>{savedOnly ? "遇到喜欢的就点一下爱心，之后会留在这里。" : "换个关键词，或者清掉一项筛选再看看。"}</p>
        </div>
      )}
      <div className="no-pressure-note virtual-promise">
        <span aria-hidden="true">♡</span>
        <div>
          <small>THE 0 YUAN PROMISE</small>
          <strong>灵感留下，钱包还是好好的。</strong>
          <p>没有限时、库存紧张和消费排名。收藏、加袋、离开，任何时候都可以。</p>
        </div>
      </div>
    </>
  );
}
