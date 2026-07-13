"use client";

import {
  Component,
  Suspense,
  lazy,
  useState,
  type ReactNode,
} from "react";
import type { AddGarmentDialogProps } from "./AddGarmentDialog";
import { useDialogAccessibility } from "../lib/use-dialog-accessibility";

function createLazyAddGarmentDialog() {
  return lazy(() =>
    import("./AddGarmentDialog").then((module) => ({
      default: module.AddGarmentDialog,
    })),
  );
}

const initialLazyAddGarmentDialog = createLazyAddGarmentDialog();

class AddGarmentDialogLoadBoundary extends Component<
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

function AddGarmentDialogLoading({
  onClose,
  returnFocusRef,
}: Pick<AddGarmentDialogProps, "onClose" | "returnFocusRef">) {
  const dialogRef = useDialogAccessibility<HTMLDivElement>(onClose, returnFocusRef);
  return (
    <div
      className="modal-layer modal-layer--center"
      role="presentation"
      onMouseDown={(event) => event.target === event.currentTarget && onClose()}
    >
      <div
        ref={dialogRef}
        tabIndex={-1}
        className="add-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="add-loading-title"
      >
        <div className="drawer-header">
          <div>
            <p>WARDROBE TOOL</p>
            <h2 id="add-loading-title">正在打开录入窗口…</h2>
          </div>
          <button
            type="button"
            className="icon-button"
            onClick={onClose}
            aria-label="取消打开添加衣物窗口"
          >
            ×
          </button>
        </div>
        <div
          className="analysis-result"
          role="status"
          aria-live="polite"
          aria-atomic="true"
        >
          <div>
            <span>衣橱工具</span>
            <b>正在打开录入窗口</b>
          </div>
          <p>正在载入衣橱工具，请稍候。</p>
        </div>
      </div>
    </div>
  );
}

function AddGarmentDialogLoadError({
  onClose,
  onRetry,
  returnFocusRef,
}: Pick<AddGarmentDialogProps, "onClose" | "returnFocusRef"> & {
  onRetry: () => void;
}) {
  const dialogRef = useDialogAccessibility<HTMLDivElement>(onClose, returnFocusRef);
  return (
    <div
      className="modal-layer modal-layer--center"
      role="presentation"
      onMouseDown={(event) => event.target === event.currentTarget && onClose()}
    >
      <div
        ref={dialogRef}
        tabIndex={-1}
        className="add-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="add-load-error-title"
        aria-describedby="add-load-error-copy"
      >
        <div className="drawer-header">
          <div>
            <p>WARDROBE TOOL</p>
            <h2 id="add-load-error-title">录入窗口暂时没有打开</h2>
          </div>
          <button
            type="button"
            className="icon-button"
            onClick={onClose}
            aria-label="关闭添加衣物窗口"
          >
            ×
          </button>
        </div>
        <div className="submit-error" role="alert">
          <strong>衣橱和已保存资料都还在</strong>
          <span id="add-load-error-copy">可能是网络暂时中断，可以重新打开录入工具。</span>
        </div>
        <div className="dialog-footer">
          <button type="button" className="button button--soft" onClick={onClose}>
            暂时不加
          </button>
          <button type="button" className="button button--primary" onClick={onRetry}>
            重新打开
          </button>
        </div>
      </div>
    </div>
  );
}

export function DeferredAddGarmentDialog(props: AddGarmentDialogProps) {
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [LazyAddGarmentDialog, setLazyAddGarmentDialog] = useState(
    () => initialLazyAddGarmentDialog,
  );

  const retryLoad = () => {
    const nextLazyAddGarmentDialog = createLazyAddGarmentDialog();
    setLazyAddGarmentDialog(() => nextLazyAddGarmentDialog);
    setLoadAttempt((current) => current + 1);
  };

  return (
    <AddGarmentDialogLoadBoundary
      key={loadAttempt}
      fallback={
        <AddGarmentDialogLoadError
          onClose={props.onClose}
          returnFocusRef={props.returnFocusRef}
          onRetry={retryLoad}
        />
      }
    >
      <Suspense
        fallback={
          <AddGarmentDialogLoading
            onClose={props.onClose}
            returnFocusRef={props.returnFocusRef}
          />
        }
      >
        <LazyAddGarmentDialog {...props} />
      </Suspense>
    </AddGarmentDialogLoadBoundary>
  );
}
