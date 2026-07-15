"use client";

import type { CSSProperties } from "react";
import { OFFICIAL_STORES } from "../lib/official-stores.mjs";

export function RealShopView({
  onImportLink,
}: {
  onImportLink: (opener: HTMLButtonElement) => void;
}) {
  return (
    <>
      <section className="real-shop-intro" aria-labelledby="real-shop-intro-title">
        <div>
          <p className="section-kicker">可添加的商品来源</p>
          <h2 id="real-shop-intro-title">先去真实店铺看看，喜欢再决定。</h2>
          <p>这些是经过核对的平台或品牌网站入口，不代表品牌赞助或合作。松松逛不会代收款，也不会把你的身材和衣橱资料提供给商家。</p>
        </div>
        <button type="button" className="button button--primary" onClick={(event) => onImportLink(event.currentTarget)}>
          ＋ 录入购买链接
        </button>
      </section>

      <section className="official-store-grid" aria-label={`真实购物网站，共 ${OFFICIAL_STORES.length} 个入口`}>
        {OFFICIAL_STORES.map((store) => {
          const noteId = `official-store-note-${store.id}`;
          return (
            <article
              className="official-store-card"
              key={store.id}
              style={{ "--store-accent": store.accent } as CSSProperties}
            >
              <div className="official-store-mark" aria-hidden="true"><span>{store.mark}</span></div>
              <div className="official-store-copy">
                <div className="official-store-meta"><span>{store.verification}</span><small>{store.market}</small></div>
                <h2>{store.name}</h2>
                <p>{store.summary}</p>
                <code>{store.hostLabel}</code>
              </div>
              <a
                className="button button--dark official-store-link"
                href={store.href}
                target="_blank"
                rel="noopener noreferrer external"
                referrerPolicy="no-referrer"
                aria-describedby={noteId}
                aria-label={`前往 ${store.name} 商家网站，将在新标签页打开`}
              >
                去商家看看 <span aria-hidden="true">↗</span>
              </a>
              <p className="official-store-note" id={noteId}>新标签页打开；价格、库存、配送与售后以商家页面为准。</p>
            </article>
          );
        })}
      </section>

      <section className="real-shop-handoff" aria-labelledby="real-shop-handoff-title">
        <span aria-hidden="true">♡</span>
        <div>
          <h2 id="real-shop-handoff-title">看到喜欢的，不必马上买</h2>
          <p>复制商品链接回来，先录入衣橱、补充尺码并试穿参考。订单、付款、配送与退换货都由对应商家处理。</p>
        </div>
        <button type="button" className="button button--soft" onClick={(event) => onImportLink(event.currentTarget)}>把链接放进衣橱</button>
      </section>
      <p className="store-relationship-note">松松逛与上述平台、品牌及其关联公司不存在隶属、授权或赞助关系，除非页面另有明确说明。品牌名称及商标归各自权利人所有。</p>
    </>
  );
}
