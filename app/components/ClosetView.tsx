/* eslint-disable @next/next/no-img-element -- private and device-local wardrobe images should not pass through a public optimizer */
"use client";

import { useState } from "react";
import {
  CLOSET_CATEGORIES,
  isValidGarmentSourceUrl,
} from "../lib/garment-form-options";
import { supportsAvatarTryOn } from "../lib/try-on-state.mjs";
import { MiniGarment } from "./muse-view-shared";
import type { ClosetViewProps } from "./muse-view-types";

function sourceHostLabel(sourceUrl: string) {
  try {
    return new URL(sourceUrl).hostname.replace(/^www\./, "");
  } catch {
    return "商家页面";
  }
}

export function ClosetView({
  wardrobe,
  onAdd,
  onWear,
  onDelete,
  onClearData,
  clearingData,
  clearRetryPending,
}: ClosetViewProps) {
  const [category, setCategory] = useState<(typeof CLOSET_CATEGORIES)[number]>("全部");
  const visible = wardrobe.filter((item) => category === "全部" || item.category === category);
  const previewableCount = wardrobe.filter((item) => supportsAvatarTryOn(item.category)).length;
  const completeness = wardrobe.length
    ? Math.round(wardrobe.reduce((sum, item) => sum + [item.size, item.color, item.season, item.style, item.chest ?? item.waist ?? item.length].filter(Boolean).length / 5, 0) / wardrobe.length * 100)
    : 0;

  async function deleteAndRestoreFocus(
    item: ClosetViewProps["wardrobe"][number],
    event: React.MouseEvent<HTMLButtonElement>,
  ) {
    const button = event.currentTarget;
    const grid = button.closest<HTMLElement>(".wardrobe-grid");
    const buttonsBefore = grid
      ? Array.from(grid.querySelectorAll<HTMLButtonElement>("button:not([disabled])"))
      : [];
    const focusIndex = Math.max(0, buttonsBefore.indexOf(button));
    await onDelete(item);
    window.requestAnimationFrame(() => {
      if (button.isConnected || !grid?.isConnected) return;
      const buttonsAfter = Array.from(
        grid.querySelectorAll<HTMLButtonElement>("button:not([disabled])"),
      );
      buttonsAfter[Math.min(focusIndex, buttonsAfter.length - 1)]?.focus();
    });
  }

  return (
    <div className="page page--closet">
      <section className="page-title-row">
        <div><p className="eyebrow">MY DIGITAL WARDROBE</p><h1>我的衣橱</h1><p>{wardrobe.length} 件衣服，每一件都可以重新被搭配。</p></div>
        <button type="button" className="button button--primary" onClick={(event) => onAdd(event.currentTarget)}>＋ 添加一件衣服</button>
      </section>
      <section className="closet-summary">
        <div><span>可参与 3D 试穿</span><strong>{previewableCount}<small> 件</small></strong><p>支持上装、下装、连衣裙和外套</p></div>
        <div className="closet-summary-art" aria-hidden="true"><i /><i /><i /><i /></div>
        <div><span>资料完整度</span><strong>{completeness}<small>%</small></strong><p>补充尺寸会让参考更可靠</p></div>
      </section>
      <div className="closet-toolbar">
        <div className="chip-row" role="group" aria-label="衣橱分类">{CLOSET_CATEGORIES.map((item) => <button type="button" key={item} aria-pressed={category === item} className={category === item ? "is-active" : ""} onClick={() => setCategory(item)}>{item}</button>)}</div>
        <span className="privacy-note">⌁ 身体与衣物资料默认保持私密</span>
      </div>
      <p className="sr-only" role="status" aria-live="polite" aria-atomic="true">
        {category === "全部" ? `衣橱共有 ${visible.length} 件` : `${category}分类共有 ${visible.length} 件`}
      </p>
      <section className={`privacy-controls${clearRetryPending ? " privacy-controls--retry" : ""}`} aria-labelledby="privacy-controls-title" aria-busy={clearingData}>
        <div><span aria-hidden="true">⌁</span><div><h2 id="privacy-controls-title">你的资料由你决定</h2><p>可随时清除衣橱、身体参数、搭配、收藏和虚拟购物袋；登录版会同时清除云端副本。</p>{clearRetryPending && <p className="privacy-retry-message" role="alert">页面中的资料已清空，但本机或云端副本还没有全部清除。请在网络或本机存储恢复后继续完成清除。</p>}</div></div>
        <button type="button" className="button button--soft" disabled={clearingData} onClick={onClearData}>{clearingData ? "正在清除…" : clearRetryPending ? "继续清除剩余副本" : "清除我的全部资料"}</button>
      </section>
      <section className="wardrobe-grid">
        <button type="button" className="add-card" onClick={(event) => onAdd(event.currentTarget)}><span>＋</span><strong>添加一件衣服</strong><small>拍照、链接或手动录入</small></button>
        {visible.map((item) => (
          <article className="wardrobe-card" key={item.id}>
            <div className="wardrobe-visual"><span className={`source-pill ${item.source === "虚拟商品" ? "source-pill--virtual" : item.source === "示例衣物" ? "source-pill--sample" : ""}`}>{item.source}</span>{item.imageUrl ? <img src={item.imageUrl} alt={item.name} loading="lazy" decoding="async" /> : <MiniGarment item={item} />}</div>
            <div className="wardrobe-info"><div><span>{item.category} · {item.size}</span><i style={{ background: item.color }} /></div><h2>{item.name}</h2><p>{item.season} · {item.style}</p>{item.sourceUrl && isValidGarmentSourceUrl(item.sourceUrl) && <a className="wardrobe-source-link" href={item.sourceUrl} target="_blank" rel="noopener noreferrer external nofollow ugc" referrerPolicy="no-referrer" aria-label={`返回 ${item.name} 的商家页面，将在新标签页打开`}>查看 {sourceHostLabel(item.sourceUrl)} <span aria-hidden="true">↗</span></a>}<div className="confidence-line"><span>资料可信度</span><b className={`confidence confidence--${item.confidence === "高" ? "high" : item.confidence === "中" ? "mid" : "low"}`}>{item.confidence}</b></div><div className="wardrobe-actions"><button type="button" className="button button--dark" onClick={() => onWear(item)} disabled={!supportsAvatarTryOn(item.category)}>{supportsAvatarTryOn(item.category) ? "穿上看看" : "暂不支持 3D"}</button><button type="button" className="remove-garment" onClick={(event) => void deleteAndRestoreFocus(item, event)} aria-label={`从衣橱移除${item.name}`}>移除</button></div></div>
          </article>
        ))}
      </section>
      {!visible.length && category !== "全部" && (
        <div className="empty-state"><span aria-hidden="true">◇</span><h2>这个分类还没有衣物</h2><p>可以换一个分类，或添加一件自己的衣服。</p></div>
      )}
    </div>
  );
}
