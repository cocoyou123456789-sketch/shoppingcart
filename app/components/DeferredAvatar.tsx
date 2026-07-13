"use client";

import { Component, useEffect, useState, type ComponentType, type ReactNode } from "react";
import type { AvatarOutfit, BodyMetrics } from "./Avatar3D";

type AvatarProps = {
  metrics: BodyMetrics;
  outfit: AvatarOutfit;
  compact?: boolean;
  focusOnReady?: boolean;
};

type IdleWindow = Window & {
  requestIdleCallback?: (callback: () => void, options?: { timeout: number }) => number;
  cancelIdleCallback?: (handle: number) => void;
};

function AvatarLoading({ compact = false }: { compact?: boolean }) {
  return (
    <div className={`avatar-stage ${compact ? "avatar-stage--compact" : ""}`}>
      <div className="avatar-loading" role="status">
        <span aria-hidden="true" />
        <p>正在准备三维分身…</p>
      </div>
    </div>
  );
}

function AvatarLoadError({ compact = false, onRetry }: { compact?: boolean; onRetry: () => void }) {
  return (
    <div className={`avatar-stage ${compact ? "avatar-stage--compact" : ""}`}>
      <div className="avatar-unavailable" role="status">
        <span aria-hidden="true">◎</span>
        <strong>三维分身暂时没有加载出来</strong>
        <p>衣橱、身材参数和搭配都还在，可以稍后再试。</p>
        <button type="button" className="button button--soft" onClick={onRetry}>重新加载 3D</button>
      </div>
    </div>
  );
}

function AvatarDataSaver({ compact = false, onLoad }: { compact?: boolean; onLoad: () => void }) {
  return (
    <div className={`avatar-stage ${compact ? "avatar-stage--compact" : ""}`}>
      <div className="avatar-unavailable" role="status">
        <span aria-hidden="true">◌</span>
        <strong>已为你暂停自动加载 3D</strong>
        <p>检测到省流量模式；衣橱和搭配仍可正常使用。</p>
        <button type="button" className="button button--soft" onClick={onLoad}>仍要加载 3D</button>
      </div>
    </div>
  );
}

class AvatarErrorBoundary extends Component<
  { compact?: boolean; children: ReactNode; onRetry: () => void },
  { failed: boolean }
> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  render() {
    if (this.state.failed) {
      return <AvatarLoadError compact={this.props.compact} onRetry={this.props.onRetry} />;
    }
    return this.props.children;
  }
}

export function DeferredAvatar({
  metrics,
  outfit,
  compact = false,
  priority = false,
}: AvatarProps & { priority?: boolean }) {
  const [Avatar, setAvatar] = useState<ComponentType<AvatarProps> | null>(null);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [boundaryAttempt, setBoundaryAttempt] = useState(0);
  const [dataSaverPaused, setDataSaverPaused] = useState(false);
  const [forceLoad, setForceLoad] = useState(false);
  const [focusOnReady, setFocusOnReady] = useState(false);

  useEffect(() => {
    let active = true;
    let idleHandle: number | undefined;
    let timer: number | undefined;
    const idleWindow = window as IdleWindow;

    const saveData = Boolean(
      (navigator as Navigator & { connection?: { saveData?: boolean } }).connection?.saveData,
    );
    if (saveData && !forceLoad) {
      timer = window.setTimeout(() => setDataSaverPaused(true), 0);
      return () => {
        active = false;
        if (timer !== undefined) window.clearTimeout(timer);
      };
    }

    const loadAvatar = () => {
      void import("./Avatar3D")
        .then((module) => {
          if (!active) return;
          setAvatar(() => module.Avatar3D);
          setFailed(false);
          setDataSaverPaused(false);
        })
        .catch(() => {
          if (!active) return;
          setAvatar(null);
          setFailed(true);
        });
    };

    if (priority) {
      loadAvatar();
    } else if (idleWindow.requestIdleCallback) {
      idleHandle = idleWindow.requestIdleCallback(loadAvatar, { timeout: 800 });
    } else {
      timer = window.setTimeout(loadAvatar, 800);
    }

    return () => {
      active = false;
      if (idleHandle !== undefined) idleWindow.cancelIdleCallback?.(idleHandle);
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [attempt, forceLoad, priority]);

  if (dataSaverPaused && !forceLoad) {
    return (
      <AvatarDataSaver
        compact={compact}
        onLoad={() => {
          setDataSaverPaused(false);
          setForceLoad(true);
          setFocusOnReady(true);
        }}
      />
    );
  }

  if (failed) {
    return (
      <AvatarLoadError
        compact={compact}
        onRetry={() => {
          setAvatar(null);
          setFailed(false);
          setFocusOnReady(true);
          setAttempt((current) => current + 1);
        }}
      />
    );
  }
  if (!Avatar) return <AvatarLoading compact={compact} />;
  return (
    <AvatarErrorBoundary
      key={boundaryAttempt}
      compact={compact}
      onRetry={() => {
        setFocusOnReady(true);
        setBoundaryAttempt((current) => current + 1);
      }}
    >
      <Avatar metrics={metrics} outfit={outfit} compact={compact} focusOnReady={focusOnReady} />
    </AvatarErrorBoundary>
  );
}
