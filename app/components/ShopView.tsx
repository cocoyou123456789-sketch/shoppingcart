"use client";

import { lazy, Suspense, useState } from "react";
import type { ShopViewProps } from "./muse-view-types";

const RealShopView = lazy(() =>
  import("./RealShopView").then((module) => ({ default: module.RealShopView })),
);
const VirtualShopView = lazy(() =>
  import("./VirtualShopView").then((module) => ({ default: module.VirtualShopView })),
);

type ShopMode = "real" | "virtual";

export function ShopView({ onImportLink, ...virtualProps }: ShopViewProps) {
  const [mode, setMode] = useState<ShopMode>("real");
  const [modeAnnouncement, setModeAnnouncement] = useState("");

  function selectMode(nextMode: ShopMode) {
    if (nextMode === mode) return;
    setMode(nextMode);
    setModeAnnouncement(
      nextMode === "real"
        ? "已切换到真实好物，共 7 个商家入口"
        : "已切换到 0 元虚拟逛，不会产生付款或真实订单",
    );
  }

  const isReal = mode === "real";
  return (
    <div className="page page--shop">
      <section className={`page-hero page-hero--shop ${isReal ? "page-hero--real" : "page-hero--virtual"}`}>
        <div>
          <p className="eyebrow">{isReal ? "REAL SHOPS · 官方与平台入口" : "DREAM BOUTIQUE · 0 元假购物"}</p>
          <h1>{isReal ? "真实好物，先看看再决定。" : "逛够喜欢，不花一分钱。"}</h1>
          <p>{isReal ? "去真实商家完成购买；也可以把商品链接带回数字衣橱，先做搭配和试穿参考。" : "像真的一样搜索、收藏、加袋和试穿；结账只完成想象，不填卡、不扣款，也不会产生订单。"}</p>
        </div>
        {isReal ? (
          <div className="real-shop-count" aria-label="七个已核验购物入口"><strong>7</strong><span>个入口</span><small>域名已核对</small></div>
        ) : (
          <div className="imagination-balance"><span>ACTUAL PAYMENT</span><strong>¥0</strong><small>实际支付永远为零</small></div>
        )}
      </section>

      <div className="shop-mode-switch" role="group" aria-label="购物模式">
        <button type="button" className={isReal ? "is-active" : ""} aria-pressed={isReal} onClick={() => selectMode("real")}><strong>真实好物</strong><span>去商家购买</span></button>
        <button type="button" className={!isReal ? "is-active" : ""} aria-pressed={!isReal} onClick={() => selectMode("virtual")}><strong>0 元虚拟逛</strong><span>只体验，不扣款</span></button>
      </div>
      <p className="sr-only" role="status" aria-live="polite" aria-atomic="true">{modeAnnouncement}</p>

      <Suspense fallback={<section className="shop-surface-loading" role="status" aria-live="polite" aria-busy="true"><span aria-hidden="true">◌</span><p>正在准备{isReal ? "真实店铺入口" : "0 元虚拟商品"}…</p></section>}>
        {isReal ? <RealShopView onImportLink={onImportLink} /> : <VirtualShopView {...virtualProps} />}
      </Suspense>
    </div>
  );
}
