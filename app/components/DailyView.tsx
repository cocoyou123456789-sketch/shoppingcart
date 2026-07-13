"use client";

import { useMemo, useState } from "react";
import {
  nextOutfitRotationSeed,
  rankOutfitSelections,
} from "../lib/outfit-ranking.mjs";
import type { ClosetCategory, WardrobeItem } from "../lib/muse-data";
import { DAILY_OPTIONS, MiniGarment, todayLabel } from "./muse-view-shared";
import type { DailyViewProps } from "./muse-view-types";

const OCCASION_STYLES: Record<string, string[]> = {
  通勤: ["利落", "轻松"],
  上课: ["轻松", "利落"],
  约会: ["温柔", "有点亮眼"],
  运动: ["轻松"],
  宅家: ["轻松", "温柔"],
};

const WEATHER_SEASONS: Record<string, string[]> = {
  炎热: ["春夏", "四季"],
  温和: ["春秋", "四季", "春夏"],
  偏凉: ["春秋", "四季"],
  下雨: ["四季", "春秋"],
};

export function DailyView({
  wardrobe,
  metrics,
  preferences,
  onPreferencesChange,
  onApply,
}: DailyViewProps) {
  const { weather, occasion, feeling, comfort } = preferences;
  const [seed, setSeed] = useState(0);
  const scoredLooks = useMemo(() => {
    const scoreItem = (item: WardrobeItem) => {
      let score = 0;
      if (item.style === feeling) score += 8;
      if (OCCASION_STYLES[occasion]?.includes(item.style)) score += 5;
      if (WEATHER_SEASONS[weather]?.includes(item.season)) score += 4;
      if (item.season === "四季") score += 1;
      if (comfort === "方便走动" && (item.style === "轻松" || item.category === "下装")) score += 4;
      if (comfort === "宽松" && (item.style === "轻松" || (item.chest ?? 0) - metrics.chest >= 10)) score += 4;
      if (comfort === "不露肤" && ["下装", "外套"].includes(item.category)) score += 3;
      if (comfort === "保暖" && (item.category === "外套" || item.season === "春秋")) score += 5;
      if ((weather === "偏凉" || weather === "下雨") && item.category === "外套") score += 6;
      return score;
    };
    const ranked = (category: ClosetCategory) => wardrobe
      .filter((item) => item.category === category)
      .sort((left, right) => scoreItem(right) - scoreItem(left) || left.id.localeCompare(right.id));

    return rankOutfitSelections({
      tops: ranked("上装"),
      bottoms: ranked("下装"),
      dresses: ranked("连衣裙"),
      outers: ranked("外套"),
      needsOuterwear: weather === "偏凉" || weather === "下雨" || comfort === "保暖",
      scoreItem,
    });
  }, [comfort, feeling, metrics.chest, occasion, wardrobe, weather]);
  const bestLook = scoredLooks[0];
  const alternatives = scoredLooks.slice(1);
  const alternativeOffset = alternatives.length ? seed % alternatives.length : 0;
  const suggestions = [
    bestLook,
    alternatives[alternativeOffset],
    alternatives.length > 1 ? alternatives[(alternativeOffset + 1) % alternatives.length] : undefined,
  ].filter((look): look is NonNullable<typeof look> => Boolean(look));
  const names = [`${feeling}感${occasion}`, `${comfort}的一套`, "今天的衣橱惊喜"];
  const canRotate = alternatives.length > 1;
  const rotateSuggestions = () => {
    setSeed((current) => nextOutfitRotationSeed(current, alternatives.length));
  };

  return (
    <div className="page page--daily">
      <section className="daily-hero"><div><p className="eyebrow">TODAY&apos;S OUTFIT</p><h1>今天穿什么，交给衣橱。</h1><p>使用衣橱里的衣服生成最多三套建议；内置示例衣物会清楚标出，不会冒充你的衣服。</p></div><div className="daily-date"><span>{todayLabel()}</span><strong>{weather} · 22°C</strong><small>天气为体验示例，可手动选择</small></div></section>
      <section className="preference-panel">
        <ChoiceGroup label="天气" options={[...DAILY_OPTIONS.weather]} value={weather} onChange={(value) => onPreferencesChange("weather", value)} />
        <ChoiceGroup label="场景" options={[...DAILY_OPTIONS.occasion]} value={occasion} onChange={(value) => onPreferencesChange("occasion", value)} />
        <ChoiceGroup label="今天的感觉" options={[...DAILY_OPTIONS.feeling]} value={feeling} onChange={(value) => onPreferencesChange("feeling", value)} />
        <ChoiceGroup label="舒适偏好" options={[...DAILY_OPTIONS.comfort]} value={comfort} onChange={(value) => onPreferencesChange("comfort", value)} />
        <button type="button" className="button button--primary" disabled={!canRotate} onClick={rotateSuggestions}>✦ {canRotate ? "换一组看看" : "没有更多组合"}</button>
      </section>
      <p className="sr-only" role="status" aria-live="polite" aria-atomic="true">
        已按{weather}、{occasion}、{feeling}和{comfort}更新第 {alternativeOffset + 1} 组搭配，共 {suggestions.length} 套
      </p>
      <div className="suggestion-heading"><div><span>从 {wardrobe.length} 件衣服中组合</span><h2>为现在的你准备了 {suggestions.length} 套</h2></div><p>身高 {metrics.height} cm · 偏好「{comfort}」</p></div>
      {suggestions.length ? <section className="suggestion-grid">
        {suggestions.map(({ selection, key }, index) => {
          const items = wardrobe.filter((item) => [selection.topId, selection.bottomId, selection.dressId, selection.outerwearId].includes(item.id));
          return <article className={`suggestion-card suggestion-card--${index + 1}`} key={key}><div className="suggestion-number" aria-hidden="true">0{index + 1}</div><div className="suggestion-visual">{items.map((item) => <div key={item.id} className="suggestion-piece"><MiniGarment item={item} /></div>)}</div><div className="suggestion-copy"><span className="suggestion-tag">{index === 0 ? "最符合今天" : index === 1 ? "换一种心情" : "衣橱惊喜"}</span><h2>{names[index]}</h2><p>{occasion}需要一点{feeling}感；{items.map((item) => item.colorName).join("、")}放在一起不会太用力，也符合“{comfort}”的偏好。</p><div className="suggestion-items">{items.map((item) => <span key={item.id}><i style={{ background: item.color }} />{item.name}</span>)}</div><div className="suggestion-actions"><button type="button" className="button button--dark" onClick={() => onApply(selection)}>穿上看看</button><button type="button" className="button button--soft" disabled={!canRotate} onClick={rotateSuggestions}>{canRotate ? (index === 0 ? "换一组" : "换一件") : "没有更多组合"}</button></div></div></article>;
        })}
      </section> : <div className="empty-state"><span>◇</span><h2>还缺少可以组合的衣服</h2><p>先在衣橱加入上装与下装，或一件连衣裙，再回来生成搭配。</p></div>}
      <p className="daily-footnote">推荐来自你的现有衣橱与已选偏好，不评价身材，也不会建议为了搭配而购买新衣服。</p>
    </div>
  );
}

function ChoiceGroup({ label, options, value, onChange }: { label: string; options: string[]; value: string; onChange: (value: string) => void }) {
  return <fieldset className="choice-group"><legend>{label}</legend><div>{options.map((option) => <button type="button" key={option} className={value === option ? "is-active" : ""} onClick={() => onChange(option)} aria-pressed={value === option}>{option}</button>)}</div></fieldset>;
}
