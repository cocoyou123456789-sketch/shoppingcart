"use client";

import {
  Component,
  Suspense,
  createElement,
  lazy,
  useEffect,
  useRef,
  useState,
  type ComponentType,
  type LazyExoticComponent,
  type ReactNode,
} from "react";
import type {
  ClosetViewProps,
  DailyViewProps,
  ShopViewProps,
  StudioViewProps,
} from "./muse-view-types";

type ReadyProps = { onReady: () => void };
type ViewLoader<Props extends object> = () => Promise<{ default: ComponentType<Props> }>;

const loadShopView: ViewLoader<ShopViewProps> = () =>
  import("./ShopView").then((module) => ({ default: module.ShopView }));
const loadClosetView: ViewLoader<ClosetViewProps> = () =>
  import("./ClosetView").then((module) => ({ default: module.ClosetView }));
const loadStudioView: ViewLoader<StudioViewProps> = () =>
  import("./StudioView").then((module) => ({ default: module.StudioView }));
const loadDailyView: ViewLoader<DailyViewProps> = () =>
  import("./DailyView").then((module) => ({ default: module.DailyView }));

class ViewLoadBoundary extends Component<
  { children: ReactNode; fallback: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

function ViewReadySignal({ onReady }: ReadyProps) {
  useEffect(() => {
    onReady();
  }, [onReady]);
  return null;
}

function ViewLoading({ label }: { label: string }) {
  const headingRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => headingRef.current?.focus({ preventScroll: true }), []);
  return (
    <section className="page empty-state" role="status" aria-live="polite" aria-busy="true">
      <span aria-hidden="true">◌</span>
      <h1 ref={headingRef} tabIndex={-1}>正在打开{label}…</h1>
      <p>正在准备这个空间，已保存的衣橱和搭配不会受影响。</p>
    </section>
  );
}

function ViewLoadError({ label, onRetry }: { label: string; onRetry: () => void }) {
  const headingRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => headingRef.current?.focus({ preventScroll: true }), []);
  return (
    <section className="page empty-state" role="alert">
      <span aria-hidden="true">◎</span>
      <h1 ref={headingRef} tabIndex={-1}>{label}暂时没有打开</h1>
      <p>你的衣橱和已保存资料都还在，可以重新加载这个空间。</p>
      <button type="button" className="button button--primary" onClick={onRetry}>
        重新加载{label}
      </button>
    </section>
  );
}

function DeferredMuseView<Props extends object>({
  label,
  load,
  viewProps,
  onReady,
}: {
  label: string;
  load: ViewLoader<Props>;
  viewProps: Props;
  onReady: () => void;
}) {
  const [attempt, setAttempt] = useState(0);
  const [LazyView, setLazyView] = useState<LazyExoticComponent<ComponentType<Props>>>(
    () => lazy(load),
  );

  const retry = () => {
    setLazyView(() => lazy(load));
    setAttempt((current) => current + 1);
  };

  return (
    <ViewLoadBoundary
      key={attempt}
      fallback={<ViewLoadError label={label} onRetry={retry} />}
    >
      <Suspense fallback={<ViewLoading label={label} />}>
        <ViewReadySignal onReady={onReady} />
        {createElement(LazyView, viewProps)}
      </Suspense>
    </ViewLoadBoundary>
  );
}

export function DeferredShopView({ onReady, ...viewProps }: ShopViewProps & ReadyProps) {
  return <DeferredMuseView label="松松逛" load={loadShopView} viewProps={viewProps} onReady={onReady} />;
}

export function DeferredClosetView({ onReady, ...viewProps }: ClosetViewProps & ReadyProps) {
  return <DeferredMuseView label="我的衣橱" load={loadClosetView} viewProps={viewProps} onReady={onReady} />;
}

export function DeferredStudioView({ onReady, ...viewProps }: StudioViewProps & ReadyProps) {
  return <DeferredMuseView label="试穿间" load={loadStudioView} viewProps={viewProps} onReady={onReady} />;
}

export function DeferredDailyView({ onReady, ...viewProps }: DailyViewProps & ReadyProps) {
  return <DeferredMuseView label="今日搭配" load={loadDailyView} viewProps={viewProps} onReady={onReady} />;
}
