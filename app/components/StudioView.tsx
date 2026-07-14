/* eslint-disable @next/next/no-img-element -- private and device-local wardrobe images should not pass through a public optimizer */
"use client";

import { useEffect, useState } from "react";
import { BODY_PRESETS } from "../lib/muse-data";
import {
  supportsAvatarTryOn,
  wearWardrobeItemAnnouncement,
} from "../lib/try-on-state.mjs";
import { DeferredAvatar } from "./DeferredAvatar";
import { RealisticAvatar } from "./RealisticAvatar";
import { MiniGarment } from "./muse-view-shared";
import type { StudioViewProps } from "./muse-view-types";

const STUDIO_CATEGORIES = ["全部", "上装", "下装", "连衣裙", "外套"] as const;
const SKIN_TONES = [
  ["#f2d4bd", "浅暖色"],
  ["#dfb08d", "暖米色"],
  ["#c98e68", "蜜糖色"],
  ["#9d654a", "深暖色"],
  ["#684235", "深棕色"],
] as const;

export function StudioView({
  wardrobe,
  metrics,
  setMetrics,
  outfit,
  setOutfit,
  avatarOutfit,
  onWear,
  initialOutfitStatus,
  onInitialOutfitStatusAnnounced,
  onSave,
  profileSaving,
}: StudioViewProps) {
  const [closetCategory, setClosetCategory] = useState<(typeof STUDIO_CATEGORIES)[number]>("全部");
  const [outfitStatus, setOutfitStatus] = useState("");
  const [previewMode, setPreviewMode] = useState<"realistic" | "3d">("realistic");
  const previewableWardrobe = wardrobe.filter((item) => supportsAvatarTryOn(item.category));
  const visible = previewableWardrobe.filter((item) => closetCategory === "全部" || item.category === closetCategory);
  const selected = wardrobe.filter((item) =>
    (item.category === "上装" && item.id === outfit.topId) ||
    (item.category === "下装" && item.id === outfit.bottomId) ||
    (item.category === "连衣裙" && item.id === outfit.dressId) ||
    (item.category === "外套" && item.id === outfit.outerwearId),
  );
  const selectedIds = selected.map((item) => item.id);
  const fitItem = selected.find((item) => item.category === "上装" || item.category === "连衣裙");
  const ease = fitItem?.chest ? fitItem.chest - metrics.chest : null;
  const fitLabel = ease === null ? "信息不足" : ease < 3 ? "可能偏贴身" : ease < 12 ? "常规松量" : "可能偏宽松";

  useEffect(() => {
    if (!initialOutfitStatus) return;
    const frame = window.requestAnimationFrame(() => {
      setOutfitStatus(initialOutfitStatus);
      onInitialOutfitStatusAnnounced?.();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [initialOutfitStatus, onInitialOutfitStatusAnnounced]);

  function choosePreset(shape: StudioViewProps["metrics"]["bodyShape"]) {
    const preset = BODY_PRESETS[shape];
    setMetrics((current) => ({ ...current, ...preset, bodyShape: shape }));
  }

  function removeFromOutfit(item: StudioViewProps["wardrobe"][number]) {
    setOutfit((current) => ({
      ...current,
      ...(item.category === "上装"
        ? { topId: undefined }
        : item.category === "下装"
          ? { bottomId: undefined }
          : item.category === "连衣裙"
            ? { dressId: undefined }
            : item.category === "外套"
              ? { outerwearId: undefined }
              : {}),
    }));
    setOutfitStatus(`${item.name}已脱下`);
  }

  function wearAndAnnounce(item: StudioViewProps["wardrobe"][number]) {
    setOutfitStatus(wearWardrobeItemAnnouncement(outfit, item));
    onWear(item);
  }

  return (
    <div className="page page--studio">
      <section className="studio-heading"><div><p className="eyebrow">3D FITTING STUDIO</p><h1>让分身更像你</h1><p>没有标准身材，调到看起来像你就好。</p></div><div className="studio-disclaimer"><span aria-hidden="true">i</span><p><strong>视觉参考，不是合身保证</strong>面料垂坠、弹性和真实松量可能不同。</p></div></section>
      <section className="studio-grid">
        <aside className="studio-panel studio-closet-panel" aria-labelledby="studio-closet-title">
          <div className="panel-title"><div><p id="studio-closet-title">可试穿衣物</p><strong>{visible.length} 件</strong></div><span>{closetCategory === "全部" ? "点击穿上" : `${closetCategory}分类`}</span></div>
          <div className="mini-chip-row" role="group" aria-label="试穿衣物分类">{STUDIO_CATEGORIES.map((item) => <button type="button" key={item} aria-pressed={closetCategory === item} className={closetCategory === item ? "is-active" : ""} onClick={() => setClosetCategory(item)}>{item}</button>)}</div>
          <p className="sr-only" role="status" aria-live="polite" aria-atomic="true">
            {closetCategory === "全部" ? `共有 ${visible.length} 件可试穿衣物` : `${closetCategory}分类共有 ${visible.length} 件可试穿衣物`}
          </p>
          <div className="studio-item-list">{visible.length ? visible.map((item) => {
            const isWearing = selectedIds.includes(item.id);
            return <button type="button" key={item.id} aria-pressed={isWearing} aria-label={`${isWearing ? "脱下" : "穿上"}${item.name}，${item.category}，${item.size} 码`} className={isWearing ? "is-wearing" : ""} onClick={() => isWearing ? removeFromOutfit(item) : wearAndAnnounce(item)}><div className="studio-thumb">{item.imageUrl ? <img src={item.imageUrl} alt="" loading="lazy" decoding="async" /> : <MiniGarment item={item} />}</div><span><strong>{item.name}</strong><small>{item.category} · {item.size}</small></span><i aria-hidden="true">{isWearing ? "✓" : "+"}</i></button>;
          }) : <div className="studio-list-empty"><span aria-hidden="true">◇</span><strong>这里还没有可试穿衣物</strong><p>上装、下装、连衣裙和外套会出现在这里。</p></div>}</div>
        </aside>
        <div className="studio-avatar-wrap">
          <div className="studio-avatar-toolbar">
            <div className="studio-status"><span><i className="status-dot" /> {previewMode === "realistic" ? "真人风格模特预览" : "可调三维量体预览"}</span><b>{previewMode === "realistic" ? "颜色与大致款式参考" : `量体参考 · ${metrics.height} cm · ${metrics.weight} kg`}</b></div>
            <div className="studio-preview-tabs" role="group" aria-label="分身预览模式">
              <button type="button" aria-pressed={previewMode === "realistic"} className={previewMode === "realistic" ? "is-active" : ""} onClick={() => setPreviewMode("realistic")}>真人风格</button>
              <button type="button" aria-pressed={previewMode === "3d"} className={previewMode === "3d" ? "is-active" : ""} onClick={() => setPreviewMode("3d")}>可旋转 3D</button>
            </div>
          </div>
          <div className="studio-avatar-viewport">
            {previewMode === "realistic" ? (
              <RealisticAvatar metrics={metrics} outfit={avatarOutfit} priority />
            ) : (
              <DeferredAvatar metrics={metrics} outfit={avatarOutfit} priority />
            )}
            {previewMode === "3d" ? <>
              <p className="studio-input-hint studio-input-hint--pointer">拖动旋转 · 滚轮缩放 · 也可使用上方按钮</p>
              <p className="studio-input-hint studio-input-hint--touch">单指横向拖动旋转 · 使用上方按钮缩放</p>
            </> : null}
          </div>
          <section className="wearing-dock" aria-labelledby="wearing-dock-title">
            <div>
              <span id="wearing-dock-title">当前穿搭</span>
              <div className="wearing-chips">{selected.length ? selected.map((item) => <button type="button" key={item.id} aria-label={`脱下${item.name}`} onClick={() => removeFromOutfit(item)}><i aria-hidden="true" style={{ background: item.color }} />{item.name}<b aria-hidden="true">×</b></button>) : <span>还没有穿上衣服</span>}</div>
            </div>
            <button type="button" className="reset-button" aria-label="清空当前试穿" disabled={!selected.length} onClick={() => { setOutfitStatus(`已清空当前试穿，共脱下 ${selected.length} 件衣物`); setOutfit({}); }}>清空试穿</button>
          </section>
          <p className="sr-only" role="status" aria-live="polite" aria-atomic="true">{outfitStatus}</p>
        </div>
        <aside className="studio-panel body-panel" aria-labelledby="studio-body-title">
          <div className="panel-title"><div><p id="studio-body-title">我的分身</p><strong>手动微调</strong></div><span>实时更新</span></div>
          <div className="preset-group"><span id="body-shape-label">身形起点</span><div className="preset-grid" role="group" aria-labelledby="body-shape-label">{([ ["straight", "直筒"], ["pear", "梨形"], ["hourglass", "沙漏"], ["inverted", "倒三角"], ["apple", "苹果形"] ] as const).map(([value, label]) => <button type="button" key={value} aria-pressed={metrics.bodyShape === value} className={metrics.bodyShape === value ? "is-active" : ""} onClick={() => choosePreset(value)}>{label}</button>)}</div></div>
          <div className="metric-pair"><MetricInput label="身高" value={metrics.height} min={145} max={195} unit="cm" onChange={(height) => setMetrics((current) => ({ ...current, height }))} /><MetricInput label="体重" value={metrics.weight} min={38} max={120} unit="kg" onChange={(weight) => setMetrics((current) => ({ ...current, weight }))} /></div>
          <div className="slider-list">
            <BodySlider label="肩线" value={metrics.shoulder} min={32} max={52} left="窄" right="宽" onChange={(shoulder) => setMetrics((current) => ({ ...current, shoulder }))} />
            <BodySlider label="胸围" value={metrics.chest} min={72} max={126} left="小" right="大" onChange={(chest) => setMetrics((current) => ({ ...current, chest }))} />
            <BodySlider label="腰围" value={metrics.waist} min={56} max={118} left="小" right="大" onChange={(waist) => setMetrics((current) => ({ ...current, waist }))} />
            <BodySlider label="臀围" value={metrics.hips} min={76} max={132} left="小" right="大" onChange={(hips) => setMetrics((current) => ({ ...current, hips }))} />
            <BodySlider label="上身比例" value={metrics.torso} min={42} max={58} left="短" right="长" onChange={(torso) => setMetrics((current) => ({ ...current, torso }))} />
            <BodySlider label="腿长比例" value={metrics.legs} min={72} max={94} left="短" right="长" onChange={(legs) => setMetrics((current) => ({ ...current, legs }))} />
          </div>
          <div className="skin-row"><span id="skin-tone-label">肤色示意</span><div role="group" aria-labelledby="skin-tone-label">{SKIN_TONES.map(([tone, label]) => <button type="button" key={tone} aria-label={label} aria-pressed={metrics.skinTone === tone} className={metrics.skinTone === tone ? "is-active" : ""} style={{ background: tone }} onClick={() => setMetrics((current) => ({ ...current, skinTone: tone }))} />)}</div></div>
          <button type="button" className="button button--primary button--full" disabled={profileSaving} onClick={onSave}>{profileSaving ? "正在安心保存…" : "这就是现在的我"}</button>
          <div className="fit-readout"><div><span>当前上身松量</span><b>{fitLabel}</b></div><p>{ease === null ? "补充衣物胸围后，可以得到更可靠的参考。" : `根据已填数据，衣物与身体胸围相差约 ${ease} cm。`}</p><small>尺码建议不代表实际舒适度。</small></div>
        </aside>
      </section>
    </div>
  );
}

function MetricInput({ label, value, min, max, unit, onChange }: { label: string; value: number; min: number; max: number; unit: string; onChange: (value: number) => void }) {
  const [draft, setDraft] = useState({ source: value, text: String(value) });
  const inputValue = draft.source === value ? draft.text : String(value);
  const commit = () => {
    const parsed = Number(inputValue);
    if (!Number.isFinite(parsed)) {
      setDraft({ source: value, text: String(value) });
      return;
    }
    const next = Math.min(max, Math.max(min, parsed));
    setDraft({ source: next, text: String(next) });
    onChange(next);
  };
  return <label className="metric-input"><span>{label}</span><span><input type="number" value={inputValue} min={min} max={max} onChange={(event) => setDraft({ source: value, text: event.target.value })} onBlur={commit} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); commit(); } }} /><b>{unit}</b></span></label>;
}

function BodySlider({ label, value, min, max, left, right, onChange }: { label: string; value: number; min: number; max: number; left: string; right: string; onChange: (value: number) => void }) {
  return <label className="body-slider"><span><b>{label}</b><i>{value} cm</i></span><input type="range" min={min} max={max} value={value} onChange={(event) => onChange(Number(event.target.value))} /><small><i>{left}</i><i>{right}</i></small></label>;
}
