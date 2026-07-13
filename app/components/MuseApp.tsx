/* eslint-disable @next/next/no-img-element -- user-selected object URLs and private R2 images should not pass through a public optimizer */
"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Avatar3D, type AvatarOutfit, type BodyMetrics } from "./Avatar3D";
import {
  BODY_PRESETS,
  PRODUCTS,
  SAMPLE_WARDROBE,
  type ClosetCategory,
  type Product,
  type ShopCategory,
  type WardrobeItem,
} from "../lib/muse-data";

type View = "home" | "shop" | "closet" | "studio" | "daily";
type OutfitSelection = {
  topId?: string;
  bottomId?: string;
  dressId?: string;
  outerwearId?: string;
};

const LOCAL_SNAPSHOT_KEY = "songsong-closet:device-state:v1";

type LocalSnapshot = {
  wardrobe: WardrobeItem[];
  metrics: BodyMetrics;
};

const NAV_ITEMS: { id: View; label: string; short: string; icon: string }[] = [
  { id: "home", label: "今天", short: "今天", icon: "⌂" },
  { id: "shop", label: "松松逛", short: "逛逛", icon: "⌁" },
  { id: "closet", label: "我的衣橱", short: "衣橱", icon: "◇" },
  { id: "studio", label: "试穿间", short: "试穿", icon: "◎" },
  { id: "daily", label: "今日搭配", short: "搭配", icon: "✦" },
];

const DEFAULT_METRICS: BodyMetrics = {
  height: 165,
  weight: 58,
  shoulder: 40,
  chest: 90,
  waist: 74,
  hips: 96,
  torso: 50,
  legs: 82,
  skinTone: "#d7a883",
  bodyShape: "hourglass",
};

const INITIAL_OUTFIT: OutfitSelection = {
  topId: "w-cream-tee",
  bottomId: "w-green-pants",
  outerwearId: "w-oat-coat",
};

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

const CLOSET_CATEGORIES: ("全部" | ClosetCategory)[] = [
  "全部",
  "上装",
  "下装",
  "连衣裙",
  "外套",
  "鞋履",
  "配饰",
];

function colorNameFromHex(color: string) {
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

function ProductVisual({ visual, color }: { visual: string; color: string }) {
  return (
    <div className={`product-visual product-visual--${visual}`} style={{ "--item-color": color } as React.CSSProperties}>
      <span className="visual-shape" aria-hidden="true" />
      <span className="visual-shadow" aria-hidden="true" />
    </div>
  );
}

function MiniGarment({ item }: { item: Pick<WardrobeItem, "category" | "color"> }) {
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

function outfitColors(outfit: OutfitSelection, wardrobe: WardrobeItem[]): AvatarOutfit {
  const findColor = (id?: string) => wardrobe.find((item) => item.id === id)?.color;
  return {
    top: findColor(outfit.topId),
    bottom: findColor(outfit.bottomId),
    dress: findColor(outfit.dressId),
    outerwear: findColor(outfit.outerwearId),
  };
}

function createItemFromProduct(product: Product): WardrobeItem | null {
  if (!["上装", "下装", "连衣裙", "外套", "鞋履", "配饰"].includes(product.category)) return null;
  return {
    id: `virtual-${product.id}`,
    name: product.name,
    category: product.category as ClosetCategory,
    color: product.color,
    colorName: product.colorName,
    size: "M",
    source: "虚拟商品",
    season: product.season,
    style: product.style,
    confidence: "待确认",
  };
}

function todayLabel() {
  return new Intl.DateTimeFormat("zh-CN", {
    month: "long",
    day: "numeric",
    weekday: "long",
  }).format(new Date());
}

function readLocalSnapshot(): LocalSnapshot | null {
  try {
    const raw = window.localStorage.getItem(LOCAL_SNAPSHOT_KEY);
    return raw ? (JSON.parse(raw) as LocalSnapshot) : null;
  } catch {
    return null;
  }
}

function writeLocalSnapshot(wardrobe: WardrobeItem[], metrics: BodyMetrics) {
  const snapshot = JSON.stringify({ wardrobe, metrics });
  try {
    window.localStorage.setItem(LOCAL_SNAPSHOT_KEY, snapshot);
  } catch {
    const withoutPhotos = wardrobe.map((item) => ({
      ...item,
      imageUrl: item.imageUrl?.startsWith("data:") ? undefined : item.imageUrl,
    }));
    try {
      window.localStorage.setItem(
        LOCAL_SNAPSHOT_KEY,
        JSON.stringify({ wardrobe: withoutPhotos, metrics }),
      );
    } catch {
      // Device storage may be disabled or full; the current session still works.
    }
  }
}

async function photoToDeviceImage(file?: File) {
  if (!file) return undefined;
  try {
    const bitmap = await createImageBitmap(file);
    const maxEdge = 900;
    const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const context = canvas.getContext("2d");
    if (!context) return undefined;
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    return canvas.toDataURL("image/jpeg", 0.76);
  } catch {
    return undefined;
  }
}

export function MuseApp() {
  const [view, setView] = useState<View>("home");
  const [metrics, setMetrics] = useState<BodyMetrics>(DEFAULT_METRICS);
  const [wardrobe, setWardrobe] = useState<WardrobeItem[]>(SAMPLE_WARDROBE);
  const [outfit, setOutfit] = useState<OutfitSelection>(INITIAL_OUTFIT);
  const [cart, setCart] = useState<Product[]>([]);
  const [cartOpen, setCartOpen] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [celebrationOpen, setCelebrationOpen] = useState(false);
  const [toast, setToast] = useState("");
  const [mood, setMood] = useState(62);
  const [dataMode, setDataMode] = useState<"连接中" | "已保存" | "本机保存">("连接中");
  const hydrated = useRef(false);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      fetch("/api/wardrobe").then((response) => (response.ok ? response.json() : Promise.reject())),
      fetch("/api/profile").then((response) => (response.ok ? response.json() : Promise.reject())),
    ])
      .then(([closetData, profileData]) => {
        if (cancelled) return;
        const savedItems = (closetData.items ?? []) as WardrobeItem[];
        if (savedItems.length) {
          setWardrobe((current) => [
            ...current,
            ...savedItems.filter((saved) => !current.some((item) => item.id === saved.id)),
          ]);
        }
        if (profileData.profile) {
          setMetrics((current) => ({ ...current, ...profileData.profile }));
        }
        setDataMode("已保存");
        hydrated.current = true;
      })
      .catch(() => {
        if (!cancelled) {
          const local = readLocalSnapshot();
          if (local?.wardrobe?.length) setWardrobe(local.wardrobe);
          if (local?.metrics) setMetrics((current) => ({ ...current, ...local.metrics }));
          setDataMode("本机保存");
          hydrated.current = true;
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!hydrated.current || dataMode !== "本机保存") return;
    writeLocalSnapshot(wardrobe, metrics);
  }, [wardrobe, metrics, dataMode]);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(""), 2600);
    return () => window.clearTimeout(timer);
  }, [toast]);

  const avatarOutfit = useMemo(() => outfitColors(outfit, wardrobe), [outfit, wardrobe]);

  function navigate(next: View) {
    setView(next);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function addToCart(product: Product) {
    setCart((current) => [...current, product]);
    setToast(`${product.name} 已放进虚拟购物袋`);
  }

  function tryProduct(product: Product) {
    const item = createItemFromProduct(product);
    if (!item) {
      setToast(product.category === "美妆" ? "已加入妆容灵感板" : "已加入房间灵感板");
      return;
    }
    setWardrobe((current) => (current.some((entry) => entry.id === item.id) ? current : [item, ...current]));
    wearItem(item);
    navigate("studio");
    setToast("已经穿到分身上，慢慢看看");
  }

  function wearItem(item: WardrobeItem) {
    setOutfit((current) => {
      if (item.category === "上装") return { ...current, topId: item.id, dressId: undefined };
      if (item.category === "下装") return { ...current, bottomId: item.id, dressId: undefined };
      if (item.category === "连衣裙") return { dressId: item.id, outerwearId: current.outerwearId };
      if (item.category === "外套") return { ...current, outerwearId: item.id };
      return current;
    });
  }

  function checkout() {
    const wearable = cart.map(createItemFromProduct).filter(Boolean) as WardrobeItem[];
    setWardrobe((current) => [
      ...wearable.filter((item) => !current.some((entry) => entry.id === item.id)),
      ...current,
    ]);
    setCart([]);
    setCartOpen(false);
    setCelebrationOpen(true);
    setMood((current) => Math.min(100, current + 11));
  }

  async function saveMetrics() {
    try {
      const response = await fetch("/api/profile", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(metrics),
      });
      if (!response.ok) throw new Error();
      setDataMode("已保存");
      setToast("分身参数已安心保存");
    } catch {
      setDataMode("本机保存");
      writeLocalSnapshot(wardrobe, metrics);
      setToast("分身参数已保存在这台设备");
    }
  }

  async function addWardrobeItem(item: WardrobeItem, photo?: File) {
    try {
      const form = new FormData();
      Object.entries(item).forEach(([key, value]) => {
        if (value !== undefined) form.append(key, String(value));
      });
      if (photo) form.append("photo", photo);
      const response = await fetch("/api/wardrobe", { method: "POST", body: form });
      if (!response.ok) throw new Error();
      const data = (await response.json()) as { item: WardrobeItem };
      setWardrobe((current) => [data.item, ...current]);
      setDataMode("已保存");
    } catch {
      const deviceImage = await photoToDeviceImage(photo);
      const localItem = { ...item, imageUrl: deviceImage ?? item.imageUrl };
      setWardrobe((current) => {
        const next = [localItem, ...current];
        writeLocalSnapshot(next, metrics);
        return next;
      });
      setDataMode("本机保存");
    }
    setAddOpen(false);
    setToast("这件衣服已经住进你的衣橱");
  }

  return (
    <div className="site-shell">
      <header className="topbar">
        <button type="button" className="brand" onClick={() => navigate("home")} aria-label="回到松松逛首页">
          <span className="brand-mark" aria-hidden="true">松</span>
          <span><strong>松松逛</strong><small>MELLOW CLOSET</small></span>
        </button>
        <nav className="desktop-nav" aria-label="主导航">
          {NAV_ITEMS.map((item) => (
            <button
              type="button"
              key={item.id}
              className={view === item.id ? "is-active" : ""}
              onClick={() => navigate(item.id)}
              aria-current={view === item.id ? "page" : undefined}
            >
              {item.label}
            </button>
          ))}
        </nav>
        <div className="top-actions">
          <span className={`sync-state sync-state--${dataMode === "已保存" || dataMode === "本机保存" ? "saved" : "demo"}`}>
            <span aria-hidden="true">●</span> {dataMode}
          </span>
          <button type="button" className="bag-button" onClick={() => setCartOpen(true)} aria-label={`打开虚拟购物袋，共 ${cart.length} 件`}>
            <span aria-hidden="true">▢</span>
            <span>虚拟购物袋</span>
            <b>{cart.length}</b>
          </button>
        </div>
      </header>

      <main>
        {view === "home" && (
          <HomeView
            metrics={metrics}
            avatarOutfit={avatarOutfit}
            wardrobe={wardrobe}
            mood={mood}
            setMood={setMood}
            onNavigate={navigate}
            onWear={(item) => {
              wearItem(item);
              navigate("studio");
            }}
          />
        )}
        {view === "shop" && <ShopView onAdd={addToCart} onTry={tryProduct} />}
        {view === "closet" && (
          <ClosetView
            wardrobe={wardrobe}
            onAdd={() => setAddOpen(true)}
            onWear={(item) => {
              wearItem(item);
              navigate("studio");
            }}
          />
        )}
        {view === "studio" && (
          <StudioView
            wardrobe={wardrobe}
            metrics={metrics}
            setMetrics={setMetrics}
            outfit={outfit}
            setOutfit={setOutfit}
            avatarOutfit={avatarOutfit}
            onWear={wearItem}
            onSave={saveMetrics}
          />
        )}
        {view === "daily" && (
          <DailyView
            wardrobe={wardrobe}
            metrics={metrics}
            onApply={(selection) => {
              setOutfit(selection);
              navigate("studio");
              setToast("这套已经穿到分身上");
            }}
          />
        )}
      </main>

      <nav className="mobile-nav" aria-label="移动端主导航">
        {NAV_ITEMS.map((item) => (
          <button
            type="button"
            key={item.id}
            className={view === item.id ? "is-active" : ""}
            onClick={() => navigate(item.id)}
            aria-current={view === item.id ? "page" : undefined}
          >
            <span aria-hidden="true">{item.icon}</span>
            {item.short}
          </button>
        ))}
      </nav>

      {cartOpen && (
        <CartDrawer
          cart={cart}
          onClose={() => setCartOpen(false)}
          onRemove={(index) => setCart((current) => current.filter((_, itemIndex) => itemIndex !== index))}
          onCheckout={checkout}
        />
      )}
      {addOpen && <AddGarmentDialog onClose={() => setAddOpen(false)} onAdd={addWardrobeItem} />}
      {celebrationOpen && (
        <CelebrationDialog
          onClose={() => setCelebrationOpen(false)}
          onCloset={() => {
            setCelebrationOpen(false);
            navigate("closet");
          }}
        />
      )}
      {toast && <div className="toast" role="status">{toast}</div>}
    </div>
  );
}

function HomeView({
  metrics,
  avatarOutfit,
  wardrobe,
  mood,
  setMood,
  onNavigate,
  onWear,
}: {
  metrics: BodyMetrics;
  avatarOutfit: AvatarOutfit;
  wardrobe: WardrobeItem[];
  mood: number;
  setMood: (value: number) => void;
  onNavigate: (view: View) => void;
  onWear: (item: WardrobeItem) => void;
}) {
  return (
    <div className="page page--home">
      <section className="hero-section">
        <div className="hero-copy">
          <p className="eyebrow"><span aria-hidden="true">✦</span> 今天不需要做正确选择</p>
          <h1>想买就先在这里拥有，<br /><em>不用真的花钱。</em></h1>
          <p className="hero-lead">
            像逛喜欢的商店一样慢慢挑，也可以把自己的衣服穿到数字分身上。这里没有付款、银行卡和真实订单。
          </p>
          <div className="hero-actions">
            <button type="button" className="button button--primary" onClick={() => onNavigate("shop")}>开始慢慢逛 <span aria-hidden="true">→</span></button>
            <button type="button" className="button button--soft" onClick={() => onNavigate("daily")}>✦ 生成今日搭配</button>
          </div>
          <div className="reassurance-row">
            <span><i aria-hidden="true">✓</i> 永远 0 元</span>
            <span><i aria-hidden="true">✓</i> 不收集银行卡</span>
            <span><i aria-hidden="true">✓</i> 身体友好</span>
          </div>
        </div>
        <div className="hero-avatar-card">
          <div className="hero-card-top">
            <div><span>今日试穿</span><strong>{todayLabel()}</strong></div>
            <button type="button" onClick={() => onNavigate("studio")}>进入试穿间 ↗</button>
          </div>
          <Avatar3D metrics={metrics} outfit={avatarOutfit} compact />
          <div className="hero-look-note">
            <span className="look-swatches" aria-hidden="true"><i style={{ background: avatarOutfit.top }} /><i style={{ background: avatarOutfit.bottom }} /><i style={{ background: avatarOutfit.outerwear }} /></span>
            <div><strong>舒服但不无聊的一套</strong><small>适合散步、上课和不赶时间的下午</small></div>
          </div>
        </div>
      </section>

      <section className="mood-strip" aria-labelledby="mood-heading">
        <div className="mood-copy"><span className="breathing-orb" aria-hidden="true" /><div><p className="section-kicker">一小口呼吸</p><h2 id="mood-heading">现在的心情，有松一点吗？</h2></div></div>
        <div className="mood-control">
          <span>有点绷</span>
          <input aria-label="当前放松程度" type="range" min="0" max="100" value={mood} onChange={(event) => setMood(Number(event.target.value))} style={{ "--mood-value": `${mood}%` } as React.CSSProperties} />
          <span>松下来了</span>
          <b>{mood}%</b>
        </div>
      </section>

      <section className="home-grid">
        <article className="feature-card feature-card--outfit">
          <div className="card-heading"><div><p className="section-kicker">今日搭配</p><h2>衣橱已经替你想好了</h2></div><button type="button" className="text-button" onClick={() => onNavigate("daily")}>看看 3 套建议 →</button></div>
          <div className="outfit-preview-row">
            {wardrobe.slice(0, 3).map((item) => (
              <button type="button" key={item.id} className="mini-item" onClick={() => onWear(item)}>
                <MiniGarment item={item} />
                <span>{item.name}</span>
              </button>
            ))}
          </div>
        </article>
        <article className="feature-card feature-card--closet">
          <div className="closet-count"><strong>{wardrobe.length}</strong><span>件衣服正在等你重新喜欢它们</span></div>
          <div className="closet-stack" aria-hidden="true">
            {wardrobe.slice(0, 4).map((item, index) => <i key={item.id} style={{ background: item.color, transform: `rotate(${(index - 1.5) * 5}deg)` }} />)}
          </div>
          <button type="button" className="text-button" onClick={() => onNavigate("closet")}>打开我的衣橱 →</button>
        </article>
      </section>

      <section className="how-section">
        <div className="section-title"><div><p className="section-kicker">你的两个空间</p><h2>逛一会儿，也照顾好真实的自己</h2></div><p>不用先把一切准备完，从任何一步开始都可以。</p></div>
        <div className="path-grid">
          <button type="button" className="path-card path-card--shop" onClick={() => onNavigate("shop")}>
            <span className="path-number">01</span><div><small>VIRTUAL SHOPPING</small><h3>松松逛</h3><p>服装、美妆和装饰都能放进袋子。结账只是一个快乐的结束动作，不会扣款。</p></div><span className="path-arrow">↗</span>
          </button>
          <button type="button" className="path-card path-card--closet" onClick={() => onNavigate("studio")}>
            <span className="path-number">02</span><div><small>DIGITAL WARDROBE</small><h3>我的数字衣橱</h3><p>调整接近你的身形，录入自己的衣服，试出明天真正可以穿的一套。</p></div><span className="path-arrow">↗</span>
          </button>
        </div>
      </section>
    </div>
  );
}

function ShopView({ onAdd, onTry }: { onAdd: (product: Product) => void; onTry: (product: Product) => void }) {
  const [category, setCategory] = useState<(typeof SHOP_CATEGORIES)[number]>("全部");
  const [query, setQuery] = useState("");
  const [saved, setSaved] = useState<string[]>([]);
  const visible = PRODUCTS.filter(
    (product) =>
      (category === "全部" || product.category === category) &&
      (!query || product.name.includes(query) || product.colorName.includes(query)),
  );

  return (
    <div className="page page--shop">
      <section className="page-hero page-hero--shop">
        <div><p className="eyebrow">VIRTUAL SHOPPING · 0 元体验</p><h1>慢慢逛，喜欢就收下。</h1><p>所有商品都是虚拟的。没有库存提醒，没有倒计时，也没有任何真实支付。</p></div>
        <div className="imagination-balance"><span>今日想象力余额</span><strong>∞</strong><small>怎么逛都不会变少</small></div>
      </section>
      <section className="shop-toolbar">
        <div className="search-box"><span aria-hidden="true">⌕</span><input aria-label="搜索虚拟商品" placeholder="搜一件让你开心的东西" value={query} onChange={(event) => setQuery(event.target.value)} /></div>
        <div className="chip-row" aria-label="商品分类">
          {SHOP_CATEGORIES.map((item) => <button type="button" key={item} className={category === item ? "is-active" : ""} onClick={() => setCategory(item)}>{item}</button>)}
        </div>
      </section>
      <section className="product-grid" aria-live="polite">
        {visible.map((product) => (
          <article className="product-card" key={product.id}>
            <div className="product-image-wrap">
              <span className="virtual-pill">虚拟商品</span>
              <button type="button" className={`save-button ${saved.includes(product.id) ? "is-saved" : ""}`} onClick={() => setSaved((current) => current.includes(product.id) ? current.filter((id) => id !== product.id) : [...current, product.id])} aria-label={saved.includes(product.id) ? `取消收藏${product.name}` : `收藏${product.name}`}>♡</button>
              <ProductVisual visual={product.visual} color={product.color} />
            </div>
            <div className="product-info">
              <p className="product-meta"><span>{product.category}</span><i style={{ background: product.color }} /> {product.colorName}</p>
              <h2>{product.name}</h2><p>{product.subtitle}</p>
              <div className="product-bottom"><strong><small>虚拟价</small> {product.points} 松松币</strong><span>不会扣款</span></div>
              <div className="product-actions"><button type="button" className="button button--soft" onClick={() => onTry(product)}>试试看</button><button type="button" className="button button--dark" onClick={() => onAdd(product)}>放进袋子</button></div>
            </div>
          </article>
        ))}
      </section>
      {!visible.length && <div className="empty-state"><span>⌁</span><h2>这里暂时是空的</h2><p>换个关键词，或者回到“全部”慢慢看看。</p></div>}
      <div className="no-pressure-note"><span aria-hidden="true">☁</span><div><strong>这里不制造“错过焦虑”</strong><p>没有限时、库存紧张和消费排名。你可以收藏、离开，任何时候再回来。</p></div></div>
    </div>
  );
}

function ClosetView({ wardrobe, onAdd, onWear }: { wardrobe: WardrobeItem[]; onAdd: () => void; onWear: (item: WardrobeItem) => void }) {
  const [category, setCategory] = useState<(typeof CLOSET_CATEGORIES)[number]>("全部");
  const visible = wardrobe.filter((item) => category === "全部" || item.category === category);
  return (
    <div className="page page--closet">
      <section className="page-title-row">
        <div><p className="eyebrow">MY DIGITAL WARDROBE</p><h1>我的衣橱</h1><p>{wardrobe.length} 件衣服，每一件都可以重新被搭配。</p></div>
        <button type="button" className="button button--primary" onClick={onAdd}>＋ 添加一件衣服</button>
      </section>
      <section className="closet-summary">
        <div><span>本周重新穿了</span><strong>4<small> 件</small></strong><p>比买新的更了解自己一点</p></div>
        <div className="closet-summary-art" aria-hidden="true"><i /><i /><i /><i /></div>
        <div><span>资料完整度</span><strong>78<small>%</small></strong><p>补充尺寸会让参考更可靠</p></div>
      </section>
      <div className="closet-toolbar">
        <div className="chip-row" aria-label="衣橱分类">{CLOSET_CATEGORIES.map((item) => <button type="button" key={item} className={category === item ? "is-active" : ""} onClick={() => setCategory(item)}>{item}</button>)}</div>
        <span className="privacy-note">⌁ 身体与衣物资料默认保持私密</span>
      </div>
      <section className="wardrobe-grid">
        <button type="button" className="add-card" onClick={onAdd}><span>＋</span><strong>添加一件衣服</strong><small>拍照、链接或手动录入</small></button>
        {visible.map((item) => (
          <article className="wardrobe-card" key={item.id}>
            <div className="wardrobe-visual"><span className={`source-pill ${item.source === "虚拟商品" ? "source-pill--virtual" : ""}`}>{item.source}</span>{item.imageUrl ? <img src={item.imageUrl} alt={item.name} /> : <MiniGarment item={item} />}</div>
            <div className="wardrobe-info"><div><span>{item.category} · {item.size}</span><i style={{ background: item.color }} /></div><h2>{item.name}</h2><p>{item.season} · {item.style}</p><div className="confidence-line"><span>资料可信度</span><b className={`confidence confidence--${item.confidence === "高" ? "high" : item.confidence === "中" ? "mid" : "low"}`}>{item.confidence}</b></div><button type="button" className="button button--dark button--full" onClick={() => onWear(item)}>穿上看看</button></div>
          </article>
        ))}
      </section>
    </div>
  );
}

function StudioView({
  wardrobe,
  metrics,
  setMetrics,
  outfit,
  setOutfit,
  avatarOutfit,
  onWear,
  onSave,
}: {
  wardrobe: WardrobeItem[];
  metrics: BodyMetrics;
  setMetrics: React.Dispatch<React.SetStateAction<BodyMetrics>>;
  outfit: OutfitSelection;
  setOutfit: React.Dispatch<React.SetStateAction<OutfitSelection>>;
  avatarOutfit: AvatarOutfit;
  onWear: (item: WardrobeItem) => void;
  onSave: () => void;
}) {
  const [closetCategory, setClosetCategory] = useState<(typeof CLOSET_CATEGORIES)[number]>("全部");
  const visible = wardrobe.filter((item) => closetCategory === "全部" || item.category === closetCategory);
  const selectedIds = [outfit.topId, outfit.bottomId, outfit.dressId, outfit.outerwearId].filter(Boolean);
  const selected = wardrobe.filter((item) => selectedIds.includes(item.id));
  const fitItem = selected.find((item) => item.category === "上装" || item.category === "连衣裙");
  const ease = fitItem?.chest ? fitItem.chest - metrics.chest : null;
  const fitLabel = ease === null ? "信息不足" : ease < 3 ? "可能偏贴身" : ease < 12 ? "常规松量" : "可能偏宽松";

  function choosePreset(shape: BodyMetrics["bodyShape"]) {
    const preset = BODY_PRESETS[shape];
    setMetrics((current) => ({ ...current, ...preset, bodyShape: shape }));
  }

  return (
    <div className="page page--studio">
      <section className="studio-heading"><div><p className="eyebrow">3D FITTING STUDIO</p><h1>让分身更像你</h1><p>没有标准身材，调到看起来像你就好。</p></div><div className="studio-disclaimer"><span aria-hidden="true">i</span><p><strong>视觉参考，不是合身保证</strong>面料垂坠、弹性和真实松量可能不同。</p></div></section>
      <section className="studio-grid">
        <aside className="studio-panel studio-closet-panel">
          <div className="panel-title"><div><p>我的衣橱</p><strong>{wardrobe.length} 件</strong></div><span>点击穿上</span></div>
          <div className="mini-chip-row" aria-label="试穿衣物分类">{CLOSET_CATEGORIES.slice(0, 5).map((item) => <button type="button" key={item} className={closetCategory === item ? "is-active" : ""} onClick={() => setClosetCategory(item)}>{item}</button>)}</div>
          <div className="studio-item-list">{visible.map((item) => <button type="button" key={item.id} className={selectedIds.includes(item.id) ? "is-wearing" : ""} onClick={() => onWear(item)}><div className="studio-thumb">{item.imageUrl ? <img src={item.imageUrl} alt="" /> : <MiniGarment item={item} />}</div><span><strong>{item.name}</strong><small>{item.category} · {item.size}</small></span><i aria-hidden="true">{selectedIds.includes(item.id) ? "✓" : "+"}</i></button>)}</div>
        </aside>
        <div className="studio-avatar-wrap">
          <div className="studio-status"><span><i className="status-dot" /> 三维身形示意</span><b>{metrics.height} cm · {metrics.weight} kg</b></div>
          <Avatar3D metrics={metrics} outfit={avatarOutfit} />
          <div className="wearing-dock"><div><span>当前穿搭</span><div className="wearing-chips">{selected.length ? selected.map((item) => <button type="button" key={item.id} onClick={() => setOutfit((current) => ({ ...current, ...(item.category === "上装" ? { topId: undefined } : item.category === "下装" ? { bottomId: undefined } : item.category === "连衣裙" ? { dressId: undefined } : item.category === "外套" ? { outerwearId: undefined } : {}) }))}><i style={{ background: item.color }} />{item.name}<b>×</b></button>) : <span>还没有穿上衣服</span>}</div></div><button type="button" className="reset-button" onClick={() => setOutfit({})}>恢复初始</button></div>
        </div>
        <aside className="studio-panel body-panel">
          <div className="panel-title"><div><p>我的分身</p><strong>手动微调</strong></div><span>实时更新</span></div>
          <div className="preset-group"><label>身形起点</label><div className="preset-grid">{([ ["straight", "直筒"], ["pear", "梨形"], ["hourglass", "沙漏"], ["inverted", "倒三角"], ["apple", "苹果形"] ] as const).map(([value, label]) => <button type="button" key={value} className={metrics.bodyShape === value ? "is-active" : ""} onClick={() => choosePreset(value)}>{label}</button>)}</div></div>
          <div className="metric-pair"><MetricInput label="身高" value={metrics.height} min={145} max={195} unit="cm" onChange={(height) => setMetrics((current) => ({ ...current, height }))} /><MetricInput label="体重" value={metrics.weight} min={38} max={120} unit="kg" onChange={(weight) => setMetrics((current) => ({ ...current, weight }))} /></div>
          <div className="slider-list">
            <BodySlider label="肩线" value={metrics.shoulder} min={32} max={52} left="窄" right="宽" onChange={(shoulder) => setMetrics((current) => ({ ...current, shoulder }))} />
            <BodySlider label="胸围" value={metrics.chest} min={72} max={126} left="小" right="大" onChange={(chest) => setMetrics((current) => ({ ...current, chest }))} />
            <BodySlider label="腰围" value={metrics.waist} min={56} max={118} left="小" right="大" onChange={(waist) => setMetrics((current) => ({ ...current, waist }))} />
            <BodySlider label="臀围" value={metrics.hips} min={76} max={132} left="小" right="大" onChange={(hips) => setMetrics((current) => ({ ...current, hips }))} />
            <BodySlider label="上身比例" value={metrics.torso} min={42} max={58} left="短" right="长" onChange={(torso) => setMetrics((current) => ({ ...current, torso }))} />
            <BodySlider label="腿长比例" value={metrics.legs} min={72} max={94} left="短" right="长" onChange={(legs) => setMetrics((current) => ({ ...current, legs }))} />
          </div>
          <div className="skin-row"><label>肤色示意</label><div>{["#f2d4bd", "#dfb08d", "#c98e68", "#9d654a", "#684235"].map((tone) => <button type="button" key={tone} aria-label={`选择肤色 ${tone}`} className={metrics.skinTone === tone ? "is-active" : ""} style={{ background: tone }} onClick={() => setMetrics((current) => ({ ...current, skinTone: tone }))} />)}</div></div>
          <button type="button" className="button button--primary button--full" onClick={onSave}>这就是现在的我</button>
          <div className="fit-readout"><div><span>当前上身松量</span><b>{fitLabel}</b></div><p>{ease === null ? "补充衣物胸围后，可以得到更可靠的参考。" : `根据已填数据，衣物与身体胸围相差约 ${ease} cm。`}</p><small>尺码建议不代表实际舒适度。</small></div>
        </aside>
      </section>
    </div>
  );
}

function MetricInput({ label, value, min, max, unit, onChange }: { label: string; value: number; min: number; max: number; unit: string; onChange: (value: number) => void }) {
  return <label className="metric-input"><span>{label}</span><span><input type="number" value={value} min={min} max={max} onChange={(event) => onChange(Number(event.target.value))} /><b>{unit}</b></span></label>;
}

function BodySlider({ label, value, min, max, left, right, onChange }: { label: string; value: number; min: number; max: number; left: string; right: string; onChange: (value: number) => void }) {
  return <label className="body-slider"><span><b>{label}</b><i>{value} cm</i></span><input type="range" min={min} max={max} value={value} onChange={(event) => onChange(Number(event.target.value))} /><small><i>{left}</i><i>{right}</i></small></label>;
}

function DailyView({ wardrobe, metrics, onApply }: { wardrobe: WardrobeItem[]; metrics: BodyMetrics; onApply: (selection: OutfitSelection) => void }) {
  const [weather, setWeather] = useState("温和");
  const [occasion, setOccasion] = useState("通勤");
  const [feeling, setFeeling] = useState("轻松");
  const [comfort, setComfort] = useState("方便走动");
  const [seed, setSeed] = useState(0);
  const tops = wardrobe.filter((item) => item.category === "上装");
  const bottoms = wardrobe.filter((item) => item.category === "下装");
  const dresses = wardrobe.filter((item) => item.category === "连衣裙");
  const outers = wardrobe.filter((item) => item.category === "外套");
  const suggestionCount = 3;
  const suggestions = Array.from({ length: suggestionCount }, (_, index) => {
    const offset = index + seed;
    if (index === 2 && dresses.length) return { dressId: dresses[offset % dresses.length].id, outerwearId: weather === "偏凉" && outers.length ? outers[offset % outers.length].id : undefined };
    return { topId: tops.length ? tops[offset % tops.length].id : undefined, bottomId: bottoms.length ? bottoms[(offset + 1) % bottoms.length].id : undefined, outerwearId: (weather === "偏凉" || weather === "下雨") && outers.length ? outers[offset % outers.length].id : undefined };
  });
  const names = ["呼吸感通勤", "不费力的温柔", "今天有一点亮"];

  return (
    <div className="page page--daily">
      <section className="daily-hero"><div><p className="eyebrow">TODAY&apos;S OUTFIT</p><h1>今天穿什么，交给衣橱。</h1><p>只使用你已经拥有的衣服，根据天气、场景和今天的感觉给出三套建议。</p></div><div className="daily-date"><span>{todayLabel()}</span><strong>{weather} · 22°C</strong><small>天气为体验示例，可手动选择</small></div></section>
      <section className="preference-panel">
        <ChoiceGroup label="天气" options={["炎热", "温和", "偏凉", "下雨"]} value={weather} onChange={setWeather} />
        <ChoiceGroup label="场景" options={["通勤", "上课", "约会", "运动", "宅家"]} value={occasion} onChange={setOccasion} />
        <ChoiceGroup label="今天的感觉" options={["轻松", "利落", "温柔", "有点亮眼"]} value={feeling} onChange={setFeeling} />
        <ChoiceGroup label="舒适偏好" options={["方便走动", "宽松", "不露肤", "保暖"]} value={comfort} onChange={setComfort} />
        <button type="button" className="button button--primary" onClick={() => setSeed((current) => current + 1)}>✦ 换三套看看</button>
      </section>
      <div className="suggestion-heading"><div><span>从 {wardrobe.length} 件衣服中组合</span><h2>为现在的你准备了 3 套</h2></div><p>身高 {metrics.height} cm · 偏好「{comfort}」</p></div>
      <section className="suggestion-grid">
        {suggestions.map((selection, index) => {
          const items = wardrobe.filter((item) => [selection.topId, selection.bottomId, selection.dressId, selection.outerwearId].includes(item.id));
          return <article className={`suggestion-card suggestion-card--${index + 1}`} key={`${seed}-${index}`}><div className="suggestion-number">0{index + 1}</div><div className="suggestion-visual">{items.map((item) => <div key={item.id} className="suggestion-piece"><MiniGarment item={item} /></div>)}</div><div className="suggestion-copy"><span className="suggestion-tag">{index === 0 ? "最符合今天" : index === 1 ? "换一种心情" : "衣橱惊喜"}</span><h2>{names[index]}</h2><p>{occasion}需要一点{feeling}感；{items.map((item) => item.colorName).join("、")}放在一起不会太用力，也符合“{comfort}”的偏好。</p><div className="suggestion-items">{items.map((item) => <span key={item.id}><i style={{ background: item.color }} />{item.name}</span>)}</div><div className="suggestion-actions"><button type="button" className="button button--dark" onClick={() => onApply(selection)}>穿上看看</button><button type="button" className="button button--soft" onClick={() => setSeed((current) => current + index + 1)}>换一件</button></div></div></article>;
        })}
      </section>
      <p className="daily-footnote">推荐来自你的现有衣橱与已选偏好，不评价身材，也不会建议为了搭配而购买新衣服。</p>
    </div>
  );
}

function ChoiceGroup({ label, options, value, onChange }: { label: string; options: string[]; value: string; onChange: (value: string) => void }) {
  return <fieldset className="choice-group"><legend>{label}</legend><div>{options.map((option) => <button type="button" key={option} className={value === option ? "is-active" : ""} onClick={() => onChange(option)} aria-pressed={value === option}>{option}</button>)}</div></fieldset>;
}

function CartDrawer({ cart, onClose, onRemove, onCheckout }: { cart: Product[]; onClose: () => void; onRemove: (index: number) => void; onCheckout: () => void }) {
  const total = cart.reduce((sum, item) => sum + item.points, 0);
  return <div className="modal-layer" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}><aside className="cart-drawer" role="dialog" aria-modal="true" aria-labelledby="cart-title"><div className="drawer-header"><div><p>VIRTUAL BAG</p><h2 id="cart-title">虚拟购物袋 <span>{cart.length}</span></h2></div><button type="button" className="icon-button" onClick={onClose} aria-label="关闭购物袋">×</button></div><div className="payment-reassurance"><span aria-hidden="true">♡</span><p><strong>放心，这里不会扣款</strong>不需要银行卡、地址，也不会产生真实订单。</p></div><div className="cart-list">{cart.length ? cart.map((item, index) => <article key={`${item.id}-${index}`}><div className="cart-thumb"><ProductVisual visual={item.visual} color={item.color} /></div><div><span>{item.category} · 虚拟商品</span><h3>{item.name}</h3><p>{item.points} 松松币</p></div><button type="button" onClick={() => onRemove(index)} aria-label={`移除${item.name}`}>×</button></article>) : <div className="cart-empty"><span>▢</span><h3>袋子还是轻轻的</h3><p>看到喜欢的再放进来，不急。</p></div>}</div><div className="drawer-footer"><div><span>虚拟合计</span><strong>{total} 松松币</strong></div><button type="button" className="button button--primary button--full" disabled={!cart.length} onClick={onCheckout}>完成这次虚拟购物</button><small>点击只会完成体验，不会提交付款或真实订单。</small></div></aside></div>;
}

function AddGarmentDialog({ onClose, onAdd }: { onClose: () => void; onAdd: (item: WardrobeItem, photo?: File) => void }) {
  const [mode, setMode] = useState<"photo" | "link" | "manual">("photo");
  const [photo, setPhoto] = useState<File | undefined>();
  const [preview, setPreview] = useState<string>();
  const [analyzed, setAnalyzed] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [name, setName] = useState("浅色宽松上衣");
  const [category, setCategory] = useState<ClosetCategory>("上装");
  const [size, setSize] = useState("M");
  const [color, setColor] = useState("#d7dff0");
  const [sourceUrl, setSourceUrl] = useState("");
  const [chest, setChest] = useState("104");
  const [waist, setWaist] = useState("");
  const [hips, setHips] = useState("");
  const [length, setLength] = useState("65");

  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview); }, [preview]);

  function choosePhoto(file?: File) {
    setPhoto(file);
    if (preview) URL.revokeObjectURL(preview);
    setPreview(file ? URL.createObjectURL(file) : undefined);
    setAnalyzed(false);
  }

  function runEstimate() {
    setAnalyzing(true);
    window.setTimeout(() => { setAnalyzing(false); setAnalyzed(true); }, 850);
  }

  function submit(event: React.FormEvent) {
    event.preventDefault();
    onAdd({ id: `w-${Date.now()}`, name: name.trim() || "未命名衣物", category, color, colorName: colorNameFromHex(color), size, source: "我的衣服", sourceUrl: sourceUrl || undefined, season: "四季", style: "日常", chest: chest ? Number(chest) : undefined, waist: waist ? Number(waist) : undefined, hips: hips ? Number(hips) : undefined, length: length ? Number(length) : undefined, confidence: analyzed ? "中" : "待确认", imageUrl: preview }, photo);
  }

  return <div className="modal-layer modal-layer--center" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}><div className="add-dialog" role="dialog" aria-modal="true" aria-labelledby="add-title"><div className="drawer-header"><div><p>ADD TO WARDROBE</p><h2 id="add-title">添加一件衣服</h2></div><button type="button" className="icon-button" onClick={onClose} aria-label="关闭添加衣物窗口">×</button></div><div className="import-tabs" role="tablist" aria-label="衣物录入方式"><button type="button" role="tab" aria-selected={mode === "photo"} className={mode === "photo" ? "is-active" : ""} onClick={() => setMode("photo")}><span>▣</span>拍照识别</button><button type="button" role="tab" aria-selected={mode === "link"} className={mode === "link" ? "is-active" : ""} onClick={() => setMode("link")}><span>↗</span>购买链接</button><button type="button" role="tab" aria-selected={mode === "manual"} className={mode === "manual" ? "is-active" : ""} onClick={() => setMode("manual")}><span>⌨</span>手动录入</button></div><form onSubmit={submit}><div className="add-dialog-body">{mode === "photo" && <div className="photo-import"><label className={`upload-zone ${preview ? "has-preview" : ""}`}>{preview ? <img src={preview} alt="待录入衣物预览" /> : <><span>＋</span><strong>上传衣物正面照</strong><small>点击选择或直接拍照</small></>}<input type="file" accept="image/*" capture="environment" onChange={(event) => choosePhoto(event.target.files?.[0])} /></label><div className="photo-tip"><span aria-hidden="true">☀</span><p><strong>这样拍，估算会更可靠</strong>把衣服平铺在纯色背景上，相机尽量垂直；旁边放 A4 纸或尺子作为比例参照。</p></div><button type="button" className="button button--soft button--full" onClick={runEstimate} disabled={!photo || analyzing}>{analyzing ? "正在生成演示估算…" : "识别颜色、分类与大致尺寸"}</button></div>}{mode === "link" && <div className="link-import"><label><span>商品购买链接</span><div><span aria-hidden="true">↗</span><input type="url" placeholder="https://example.com/product" value={sourceUrl} onChange={(event) => setSourceUrl(event.target.value)} /></div></label><button type="button" className="button button--soft button--full" onClick={runEstimate} disabled={!sourceUrl || analyzing}>{analyzing ? "正在读取演示信息…" : "尝试读取公开商品信息"}</button><p className="inline-note">不同网站提供的信息不同；读取结果需要你确认，失败时仍可保留链接并手动填写。</p></div>}<div className="garment-fields"><div className="form-section-title"><h3>{mode === "manual" ? "衣物信息" : "确认识别结果"}</h3>{analyzed && <span>演示估算 · 6 项待确认</span>}</div><label className="field field--wide"><span>名称</span><input value={name} onChange={(event) => setName(event.target.value)} required /></label><div className="field-row"><label className="field"><span>分类</span><select value={category} onChange={(event) => setCategory(event.target.value as ClosetCategory)}>{CLOSET_CATEGORIES.slice(1).map((item) => <option key={item}>{item}</option>)}</select></label><label className="field"><span>尺码标签</span><input value={size} onChange={(event) => setSize(event.target.value)} /></label><label className="field color-field"><span>主色</span><div><input type="color" value={color} onChange={(event) => setColor(event.target.value)} /><b>{colorNameFromHex(color)}</b></div></label></div><div className="measurement-grid"><label><span>胸围</span><div><input inputMode="decimal" value={chest} onChange={(event) => setChest(event.target.value)} /><b>cm</b></div></label><label><span>腰围</span><div><input inputMode="decimal" value={waist} onChange={(event) => setWaist(event.target.value)} placeholder="可跳过" /><b>cm</b></div></label><label><span>臀围</span><div><input inputMode="decimal" value={hips} onChange={(event) => setHips(event.target.value)} placeholder="可跳过" /><b>cm</b></div></label><label><span>衣长</span><div><input inputMode="decimal" value={length} onChange={(event) => setLength(event.target.value)} /><b>cm</b></div></label></div>{analyzed && <div className="analysis-result"><div><span>照片轮廓</span><b>中等可信度</b></div><div><span>尺寸来源</span><b>{mode === "link" ? "商家公开信息 + 演示估算" : "参照物比例 + 演示估算"}</b></div><p>照片估算只用于视觉预览，不代表衣服的实际尺寸、弹性或垂坠。</p></div>}</div></div><div className="dialog-footer"><button type="button" className="button button--soft" onClick={onClose}>暂时不加</button><button type="submit" className="button button--primary">确认，放进衣橱</button></div></form></div></div>;
}

function CelebrationDialog({ onClose, onCloset }: { onClose: () => void; onCloset: () => void }) {
  return <div className="modal-layer modal-layer--center celebration-layer" role="presentation"><div className="celebration-dialog" role="dialog" aria-modal="true" aria-labelledby="celebration-title"><div className="confetti" aria-hidden="true">{Array.from({ length: 12 }, (_, index) => <i key={index} />)}</div><span className="celebration-icon" aria-hidden="true">♡</span><p>VIRTUAL CHECKOUT COMPLETE</p><h2 id="celebration-title">喜欢的东西已经装进袋子，<br />这次不用花一分钱。</h2><p className="celebration-copy">服装类虚拟商品也放进了衣橱，随时可以让分身试穿。这里没有付款，也没有真实订单。</p><div><button type="button" className="button button--primary" onClick={onCloset}>去衣橱看看</button><button type="button" className="button button--soft" onClick={onClose}>继续慢慢逛</button></div></div></div>;
}
