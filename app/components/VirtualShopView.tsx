"use client";

import { useEffect, useRef, useState } from "react";
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
  "美妆",
  "装饰",
];

type VirtualShopViewProps = Omit<ShopViewProps, "onImportLink">;

export function VirtualShopView({
  saved,
  onToggleSaved,
  onAdd,
  onTry,
}: VirtualShopViewProps) {
  const [category, setCategory] = useState<(typeof SHOP_CATEGORIES)[number]>("全部");
  const [query, setQuery] = useState("");
  const [savedOnly, setSavedOnly] = useState(false);
  const savedFilterRef = useRef<HTMLButtonElement>(null);
  const normalizedQuery = query.trim().toLocaleLowerCase("zh-CN");
  const visible = PRODUCTS.filter(
    (product) =>
      (category === "全部" || product.category === category) &&
      (!normalizedQuery ||
        product.name.toLocaleLowerCase("zh-CN").includes(normalizedQuery) ||
        product.colorName.toLocaleLowerCase("zh-CN").includes(normalizedQuery)) &&
      (!savedOnly || saved.includes(product.id)),
  );
  const [resultAnnouncement, setResultAnnouncement] = useState("");

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
    const willDisappear = savedOnly && saved.includes(productId);
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
      const scope = savedOnly ? "收藏中" : category === "全部" ? "全部分类中" : `${category}分类中`;
      const search = normalizedQuery ? `搜索“${query.trim()}”时，` : "";
      setResultAnnouncement(`${search}${scope}找到 ${visible.length} 件虚拟商品`);
    }, 300);
    return () => window.clearTimeout(timer);
  }, [category, normalizedQuery, query, savedOnly, visible.length]);

  return (
    <>
      <section className="shop-toolbar">
        <div className="search-box"><span aria-hidden="true">⌕</span><input type="search" aria-label="搜索虚拟商品" placeholder="搜一件让你开心的东西" value={query} onChange={(event) => setQuery(event.target.value)} /></div>
        <div className="chip-row" role="group" aria-label="商品筛选">
          {SHOP_CATEGORIES.map((item) => <button type="button" key={item} aria-pressed={category === item} className={category === item ? "is-active" : ""} onClick={() => setCategory(item)}>{item}</button>)}
          <button ref={savedFilterRef} type="button" aria-pressed={savedOnly} className={savedOnly ? "is-active" : ""} onClick={() => setSavedOnly((current) => !current)}>♡ 收藏 {saved.length}</button>
        </div>
      </section>
      <p className="sr-only" role="status" aria-live="polite" aria-atomic="true">
        {resultAnnouncement}
      </p>
      <section className="product-grid" aria-label="0 元虚拟商品">
        {visible.map((product) => {
          const wardrobeCandidate = createVirtualWardrobeItem(product);
          return <article className="product-card" key={product.id}>
            <div className="product-image-wrap">
              <span className="virtual-pill">虚拟商品</span>
              <button type="button" className={`save-button ${saved.includes(product.id) ? "is-saved" : ""}`} onClick={(event) => toggleSavedAndRestoreFocus(product.id, event)} aria-label={saved.includes(product.id) ? `取消收藏${product.name}` : `收藏${product.name}`} aria-pressed={saved.includes(product.id)}>♡</button>
              <ProductVisual visual={product.visual} color={product.color} />
            </div>
            <div className="product-info">
              <p className="product-meta"><span>{product.category}</span><i style={{ background: product.color }} /> {product.colorName}</p>
              <h2>{product.name}</h2><p>{product.subtitle}</p>
              <div className="product-bottom"><strong><small>虚拟价</small> {product.points} 松松币</strong><span>不会扣款</span></div>
              <div className={`product-actions ${wardrobeCandidate ? "" : "product-actions--single"}`}>
                {wardrobeCandidate && (
                  <button type="button" className="button button--soft" onClick={() => onTry(product)}>
                    {supportsAvatarTryOn(product.category) ? "试穿看看" : "收入衣橱"}
                  </button>
                )}
                <button type="button" className="button button--dark" onClick={() => onAdd(product)}>放进虚拟袋</button>
              </div>
            </div>
          </article>;
        })}
      </section>
      {!visible.length && <div className="empty-state"><span>⌁</span><h2>{savedOnly ? "还没有收藏的虚拟商品" : "这里暂时是空的"}</h2><p>{savedOnly ? "遇到喜欢的就点一下爱心，之后还会在这里。" : "换个关键词，或者回到“全部”慢慢看看。"}</p></div>}
      <div className="no-pressure-note"><span aria-hidden="true">☁</span><div><strong>这里不制造“错过焦虑”</strong><p>没有限时、库存紧张和消费排名。你可以收藏、离开，任何时候再回来。</p></div></div>
    </>
  );
}
