/* eslint-disable @next/next/no-img-element -- user-selected object URLs should not pass through a public optimizer */
"use client";

import {
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type FormEvent,
  type KeyboardEvent,
  type RefObject,
  type SetStateAction,
} from "react";
import {
  CLIENT_IMAGE_TYPES,
  CLOSET_CATEGORIES,
  MAX_CLIENT_IMAGE_BYTES,
  SEASON_OPTIONS,
  STYLE_OPTIONS,
  colorNameFromHex,
} from "../lib/garment-form-options";
import { useDialogAccessibility } from "../lib/use-dialog-accessibility";
import type { ClosetCategory, WardrobeItem } from "../lib/muse-data";

export type AddGarmentDialogProps = {
  onClose: () => void;
  onAdd: (item: WardrobeItem, photo?: File) => Promise<string | null> | string | null;
  returnFocusRef: RefObject<HTMLElement | null>;
};

export function AddGarmentDialog({
  onClose,
  onAdd,
  returnFocusRef,
}: AddGarmentDialogProps) {
  const submittingRef = useRef(false);
  const closeWhenReady = () => {
    if (!submittingRef.current) onClose();
  };
  const dialogRef = useDialogAccessibility<HTMLDivElement>(closeWhenReady, returnFocusRef);
  const submitErrorRef = useRef<HTMLDivElement>(null);
  const estimateTimer = useRef<number | null>(null);
  const estimateGeneration = useRef(0);
  const [mode, setMode] = useState<"photo" | "link" | "manual">("photo");
  const [photo, setPhoto] = useState<File | undefined>();
  const [preview, setPreview] = useState<string>();
  const [analyzed, setAnalyzed] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [name, setName] = useState("");
  const [category, setCategory] = useState<ClosetCategory>("上装");
  const [size, setSize] = useState("M");
  const [color, setColor] = useState("#d7dff0");
  const [season, setSeason] = useState<(typeof SEASON_OPTIONS)[number]>("四季");
  const [style, setStyle] = useState<(typeof STYLE_OPTIONS)[number]>("轻松");
  const [sourceUrl, setSourceUrl] = useState("");
  const [sizeChartText, setSizeChartText] = useState("");
  const [importError, setImportError] = useState("");
  const [submitError, setSubmitError] = useState("");
  const [analysisMessage, setAnalysisMessage] = useState("");
  const [matchedMeasurements, setMatchedMeasurements] = useState<string[]>([]);
  const [chest, setChest] = useState("");
  const [waist, setWaist] = useState("");
  const [hips, setHips] = useState("");
  const [length, setLength] = useState("");

  useEffect(
    () => () => {
      if (preview) URL.revokeObjectURL(preview);
    },
    [preview],
  );
  useEffect(
    () => () => {
      estimateGeneration.current += 1;
      if (estimateTimer.current !== null)
        window.clearTimeout(estimateTimer.current);
    },
    [],
  );

  function choosePhoto(file?: File) {
    setImportError("");
    invalidateRecognizedMeasurements();
    if (
      file &&
      (!CLIENT_IMAGE_TYPES.has(file.type.toLowerCase()) ||
        file.size > MAX_CLIENT_IMAGE_BYTES)
    ) {
      setPhoto(undefined);
      if (preview) URL.revokeObjectURL(preview);
      setPreview(undefined);
      setAnalyzed(false);
      setImportError("请选择小于 6 MB 的 JPEG、PNG 或 WebP 图片。");
      return;
    }
    setPhoto(file);
    if (preview) URL.revokeObjectURL(preview);
    setPreview(file ? URL.createObjectURL(file) : undefined);
    setAnalyzed(false);
    setMatchedMeasurements([]);
    setAnalysisMessage("");
  }

  function invalidateRecognizedMeasurements() {
    estimateGeneration.current += 1;
    setImportError("");
    if (estimateTimer.current !== null) {
      window.clearTimeout(estimateTimer.current);
      estimateTimer.current = null;
    }
    const recognized = new Set(matchedMeasurements);
    if (recognized.has("chest")) setChest("");
    if (recognized.has("waist")) setWaist("");
    if (recognized.has("hips")) setHips("");
    if (recognized.has("length")) setLength("");
    setMatchedMeasurements([]);
    setAnalysisMessage("");
    setAnalyzed(false);
    setAnalyzing(false);
  }

  function changeMode(nextMode: "photo" | "link" | "manual") {
    if (nextMode === mode) return;
    estimateGeneration.current += 1;
    if (estimateTimer.current !== null) {
      window.clearTimeout(estimateTimer.current);
      estimateTimer.current = null;
    }
    setAnalyzing(false);
    setAnalyzed(false);
    setMatchedMeasurements([]);
    setAnalysisMessage("");
    setImportError("");
    setMode(nextMode);
  }

  function runEstimate() {
    const requestGeneration = ++estimateGeneration.current;
    const requestedMode = mode;
    const requestedSizeChartText = sizeChartText;
    const previouslyRecognized = new Set(matchedMeasurements);
    setAnalyzing(true);
    setImportError("");
    if (estimateTimer.current !== null)
      window.clearTimeout(estimateTimer.current);
    estimateTimer.current = window.setTimeout(() => {
      estimateTimer.current = null;
      void (async () => {
        try {
          if (requestedMode === "link") {
            const { extractGarmentMeasurements } = await import(
              "../lib/garment-analysis.mjs"
            );
            if (estimateGeneration.current !== requestGeneration) return;
            const { measurements, matched } = extractGarmentMeasurements(
              requestedSizeChartText,
            );
            const applyRecognizedValue = (
              field: "chest" | "waist" | "hips" | "length",
              value: number | undefined,
              setter: Dispatch<SetStateAction<string>>,
            ) => {
              if (value !== undefined) setter(String(value));
              else if (previouslyRecognized.has(field)) setter("");
            };
            applyRecognizedValue("chest", measurements.chest, setChest);
            applyRecognizedValue("waist", measurements.waist, setWaist);
            applyRecognizedValue("hips", measurements.hips, setHips);
            applyRecognizedValue("length", measurements.length, setLength);
            setMatchedMeasurements(matched);
            setAnalysisMessage(
              matched.length
                ? `已从你粘贴的尺码文字中识别 ${matched.length} 项；请对照原网页确认后再保存。`
                : "没有找到带名称的尺寸。请粘贴“胸围 104 cm、衣长 67 cm”这类文字，或直接手动填写。",
            );
          } else {
            if (estimateGeneration.current !== requestGeneration) return;
            setMatchedMeasurements([]);
            setAnalysisMessage(
              "照片已准备好。请根据照片中的 A4 纸或尺子手动填写尺寸；当前不会凭一张照片猜测厘米数。",
            );
          }
          if (estimateGeneration.current !== requestGeneration) return;
          setAnalyzing(false);
          setAnalyzed(true);
        } catch {
          if (estimateGeneration.current !== requestGeneration) return;
          setAnalyzing(false);
          setAnalyzed(false);
          setImportError("暂时无法读取尺码文字，请直接手动填写尺寸。");
        }
      })();
    }, 260);
  }

  function setManualMeasurement(
    field: "chest" | "waist" | "hips" | "length",
    value: string,
    setter: Dispatch<SetStateAction<string>>,
  ) {
    estimateGeneration.current += 1;
    if (estimateTimer.current !== null) {
      window.clearTimeout(estimateTimer.current);
      estimateTimer.current = null;
    }
    setAnalyzing(false);
    setImportError("");
    setter(value);
    setMatchedMeasurements((current) =>
      current.filter((candidate) => candidate !== field),
    );
  }

  function handleModeKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    const modes = ["photo", "link", "manual"] as const;
    const currentIndex = modes.indexOf(mode);
    let nextIndex = currentIndex;
    if (event.key === "ArrowRight" || event.key === "ArrowDown")
      nextIndex = (currentIndex + 1) % modes.length;
    else if (event.key === "ArrowLeft" || event.key === "ArrowUp")
      nextIndex = (currentIndex - 1 + modes.length) % modes.length;
    else if (event.key === "Home") nextIndex = 0;
    else if (event.key === "End") nextIndex = modes.length - 1;
    else return;
    event.preventDefault();
    const nextMode = modes[nextIndex];
    changeMode(nextMode);
    window.requestAnimationFrame(() =>
      document.getElementById(`add-mode-${nextMode}`)?.focus(),
    );
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (submitting || analyzing) return;
    submittingRef.current = true;
    setSubmitting(true);
    setSubmitError("");
    try {
      const errorMessage = await onAdd(
        {
          id: `w-${crypto.randomUUID()}`,
          name: name.trim() || "未命名衣物",
          category,
          color,
          colorName: colorNameFromHex(color),
          size,
          source: "我的衣服",
          sourceUrl: mode === "link" && sourceUrl ? sourceUrl : undefined,
          season,
          style,
          chest: chest ? Number(chest) : undefined,
          waist: waist ? Number(waist) : undefined,
          hips: hips ? Number(hips) : undefined,
          length: length ? Number(length) : undefined,
          confidence: matchedMeasurements.length ? "中" : "待确认",
          imageUrl: mode === "photo" ? preview : undefined,
        },
        mode === "photo" ? photo : undefined,
      );
      if (errorMessage) {
        setSubmitError(errorMessage);
        window.requestAnimationFrame(() => submitErrorRef.current?.focus());
      }
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
    }
  }

  return (
    <div
      className="modal-layer modal-layer--center"
      role="presentation"
      onMouseDown={(event) =>
        event.target === event.currentTarget && !submitting && onClose()
      }
    >
      <div
        ref={dialogRef}
        tabIndex={-1}
        className="add-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="add-title"
      >
        <div className="drawer-header">
          <div>
            <p>ADD TO WARDROBE</p>
            <h2 id="add-title">添加一件衣服</h2>
          </div>
          <button
            type="button"
            className="icon-button"
            disabled={submitting}
            onClick={onClose}
            aria-label="关闭添加衣物窗口"
          >
            ×
          </button>
        </div>
        <div className="import-tabs" role="tablist" aria-label="衣物录入方式">
          <button
            id="add-mode-photo"
            aria-controls="add-mode-panel"
            tabIndex={mode === "photo" ? 0 : -1}
            type="button"
            role="tab"
            aria-selected={mode === "photo"}
            className={mode === "photo" ? "is-active" : ""}
            onKeyDown={handleModeKeyDown}
            onClick={() => changeMode("photo")}
          >
            <span aria-hidden="true">▣</span>拍照录入
          </button>
          <button
            id="add-mode-link"
            aria-controls="add-mode-panel"
            tabIndex={mode === "link" ? 0 : -1}
            type="button"
            role="tab"
            aria-selected={mode === "link"}
            className={mode === "link" ? "is-active" : ""}
            onKeyDown={handleModeKeyDown}
            onClick={() => changeMode("link")}
          >
            <span aria-hidden="true">↗</span>购买链接
          </button>
          <button
            id="add-mode-manual"
            aria-controls="add-mode-panel"
            tabIndex={mode === "manual" ? 0 : -1}
            type="button"
            role="tab"
            aria-selected={mode === "manual"}
            className={mode === "manual" ? "is-active" : ""}
            onKeyDown={handleModeKeyDown}
            onClick={() => changeMode("manual")}
          >
            <span aria-hidden="true">⌨</span>手动录入
          </button>
        </div>
        <p className="sr-only" role="status" aria-live="polite" aria-atomic="true">
          {submitting
            ? "正在保存衣物，请稍候"
            : analyzing
              ? mode === "link"
                ? "正在读取尺码文字"
                : "正在准备照片记录"
              : ""}
        </p>
        <form
          onSubmit={submit}
          aria-busy={submitting}
          aria-describedby={submitError ? "garment-submit-error" : undefined}
        >
          <div
            id="add-mode-panel"
            role="tabpanel"
            aria-labelledby={`add-mode-${mode}`}
            aria-busy={analyzing}
            className="add-dialog-body"
          >
            {mode === "photo" && (
              <div className="photo-import">
                <label
                  className={`upload-zone ${preview ? "has-preview" : ""}`}
                >
                  {preview ? (
                    <img src={preview} alt="待录入衣物预览" />
                  ) : (
                    <>
                      <span aria-hidden="true">＋</span>
                      <strong>上传衣物正面照</strong>
                      <small>点击选择或直接拍照</small>
                    </>
                  )}
                  <input
                    type="file"
                    aria-label="上传或更换衣物正面照"
                    accept="image/jpeg,image/png,image/webp"
                    capture="environment"
                    aria-invalid={importError ? true : undefined}
                    aria-errormessage={importError ? "photo-import-error" : undefined}
                    onChange={(event) => choosePhoto(event.target.files?.[0])}
                  />
                </label>
                {importError && (
                  <p id="photo-import-error" className="import-error" role="alert">
                    {importError}
                  </p>
                )}
                <div className="photo-tip">
                  <span aria-hidden="true">☀</span>
                  <p>
                    <strong>这样拍，之后测量会更可靠</strong>
                    把衣服平铺在纯色背景上，相机尽量垂直；旁边放 A4
                    纸或尺子作为比例参照。
                  </p>
                </div>
                <button
                  type="button"
                  className="button button--soft button--full"
                  onClick={runEstimate}
                  disabled={!photo || analyzing}
                >
                  {analyzing ? "正在准备照片记录…" : "使用照片并填写尺寸"}
                </button>
              </div>
            )}
            {mode === "link" && (
              <div className="link-import">
                <label>
                  <span>商品购买链接</span>
                  <div>
                    <span aria-hidden="true">↗</span>
                    <input
                      type="url"
                      placeholder="https://example.com/product"
                      value={sourceUrl}
                      maxLength={1000}
                      required
                      onChange={(event) => {
                        setSourceUrl(event.target.value);
                        invalidateRecognizedMeasurements();
                      }}
                    />
                  </div>
                </label>
                <label className="size-chart-input">
                  <span>尺码表文字（可选）</span>
                  <textarea
                    rows={5}
                    value={sizeChartText}
                    placeholder="例如：M 码 胸围 104 cm，腰围 86 cm，衣长 67 cm"
                    onChange={(event) => {
                      setSizeChartText(event.target.value);
                      invalidateRecognizedMeasurements();
                    }}
                  />
                </label>
                <button
                  type="button"
                  className="button button--soft button--full"
                  onClick={runEstimate}
                  disabled={!sourceUrl || !sizeChartText.trim() || analyzing}
                  aria-describedby={importError ? "link-import-error" : undefined}
                >
                  {analyzing ? "正在读取尺码文字…" : "识别尺码文字"}
                </button>
                {importError && (
                  <p id="link-import-error" className="import-error" role="alert">
                    {importError}
                  </p>
                )}
                <p className="inline-note">
                  为保护隐私，当前不会自动抓取商家网页。链接会保存；你可以粘贴尺码表文字，让我们只提取明确标注的尺寸。
                </p>
              </div>
            )}
            <div className="garment-fields">
              <div className="form-section-title">
                <h3>{mode === "manual" ? "衣物信息" : "确认衣物信息"}</h3>
                {analyzed && (
                  <span>
                    {matchedMeasurements.length
                      ? `已识别 ${matchedMeasurements.length} 项`
                      : "等待手动确认"}
                  </span>
                )}
              </div>
              <label className="field field--wide">
                <span>名称</span>
                <input
                  value={name}
                  placeholder="例如：浅蓝落肩衬衫"
                  onChange={(event) => setName(event.target.value)}
                  required
                />
              </label>
              <div className="field-row">
                <label className="field">
                  <span>分类</span>
                  <select
                    value={category}
                    onChange={(event) =>
                      setCategory(event.target.value as ClosetCategory)
                    }
                  >
                    {CLOSET_CATEGORIES.slice(1).map((item) => (
                      <option key={item}>{item}</option>
                    ))}
                  </select>
                </label>
                <label className="field">
                  <span>尺码标签</span>
                  <input
                    value={size}
                    onChange={(event) => setSize(event.target.value)}
                  />
                </label>
                <label className="field color-field">
                  <span>主色</span>
                  <div>
                    <input
                      type="color"
                      value={color}
                      onChange={(event) => setColor(event.target.value)}
                    />
                    <b>{colorNameFromHex(color)}</b>
                  </div>
                </label>
              </div>
              <div className="field-row field-row--two">
                <label className="field">
                  <span>适合季节</span>
                  <select
                    value={season}
                    onChange={(event) =>
                      setSeason(
                        event.target.value as (typeof SEASON_OPTIONS)[number],
                      )
                    }
                  >
                    {SEASON_OPTIONS.map((option) => (
                      <option key={option}>{option}</option>
                    ))}
                  </select>
                </label>
                <label className="field">
                  <span>穿衣感觉</span>
                  <select
                    value={style}
                    onChange={(event) =>
                      setStyle(
                        event.target.value as (typeof STYLE_OPTIONS)[number],
                      )
                    }
                  >
                    {STYLE_OPTIONS.map((option) => (
                      <option key={option}>{option}</option>
                    ))}
                  </select>
                </label>
              </div>
              <div className="measurement-grid">
                <label>
                  <span>胸围</span>
                  <div>
                    <input
                      type="number"
                      min="20"
                      max="250"
                      step="0.1"
                      inputMode="decimal"
                      value={chest}
                      onChange={(event) =>
                        setManualMeasurement("chest", event.target.value, setChest)
                      }
                    />
                    <b>cm</b>
                  </div>
                </label>
                <label>
                  <span>腰围</span>
                  <div>
                    <input
                      type="number"
                      min="20"
                      max="250"
                      step="0.1"
                      inputMode="decimal"
                      value={waist}
                      onChange={(event) =>
                        setManualMeasurement("waist", event.target.value, setWaist)
                      }
                      placeholder="可跳过"
                    />
                    <b>cm</b>
                  </div>
                </label>
                <label>
                  <span>臀围</span>
                  <div>
                    <input
                      type="number"
                      min="20"
                      max="250"
                      step="0.1"
                      inputMode="decimal"
                      value={hips}
                      onChange={(event) =>
                        setManualMeasurement("hips", event.target.value, setHips)
                      }
                      placeholder="可跳过"
                    />
                    <b>cm</b>
                  </div>
                </label>
                <label>
                  <span>衣长</span>
                  <div>
                    <input
                      type="number"
                      min="10"
                      max="300"
                      step="0.1"
                      inputMode="decimal"
                      value={length}
                      onChange={(event) =>
                        setManualMeasurement("length", event.target.value, setLength)
                      }
                    />
                    <b>cm</b>
                  </div>
                </label>
              </div>
              {analyzed && (
                <div className="analysis-result" role="status" aria-live="polite" aria-atomic="true">
                  <div>
                    <span>记录状态</span>
                    <b>
                      {matchedMeasurements.length
                        ? `识别到 ${matchedMeasurements.length} 项尺寸`
                        : "没有自动填写尺寸"}
                    </b>
                  </div>
                  <div>
                    <span>数据来源</span>
                    <b>
                      {mode === "link"
                        ? "你粘贴的尺码文字"
                        : "照片留存 + 手动确认"}
                    </b>
                  </div>
                  <p>{analysisMessage}</p>
                </div>
              )}
            </div>
          </div>
          {submitError && (
            <div
              ref={submitErrorRef}
              id="garment-submit-error"
              className="submit-error"
              role="alert"
              tabIndex={-1}
            >
              <strong>还没有保存成功</strong>
              <span>{submitError}</span>
            </div>
          )}
          <div className="dialog-footer">
            <button
              type="button"
              className="button button--soft"
              disabled={submitting}
              onClick={onClose}
            >
              暂时不加
            </button>
            <button
              type="submit"
              className="button button--primary"
              disabled={submitting || analyzing}
            >
              {submitting
                ? "正在保存…"
                : analyzing
                  ? "请等待尺码读取完成"
                  : "确认，放进衣橱"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
