"use client";

import { useEffect, useRef, type RefObject } from "react";

export function useDialogAccessibility<T extends HTMLElement>(
  onClose: () => void,
  returnFocusRef?: RefObject<HTMLElement | null>,
) {
  const dialogRef = useRef<T>(null);
  const onCloseRef = useRef(onClose);

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    const previouslyFocused = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    const configuredReturnTarget = returnFocusRef?.current ?? null;
    const selector = [
      "button:not([disabled])",
      "input:not([disabled])",
      "select:not([disabled])",
      "textarea:not([disabled])",
      "a[href]",
      '[tabindex]:not([tabindex="-1"])',
    ].join(",");
    const focusable = () =>
      Array.from(dialog.querySelectorAll<HTMLElement>(selector)).filter(
        (item) => item.offsetParent !== null,
      );
    const focusFrame = window.requestAnimationFrame(() => {
      (focusable()[0] ?? dialog).focus();
    });
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onCloseRef.current();
        return;
      }
      if (event.key !== "Tab") return;
      const items = focusable();
      if (!items.length) {
        event.preventDefault();
        dialog.focus();
        return;
      }
      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement;
      if (
        !(active instanceof HTMLElement) ||
        !dialog.contains(active) ||
        !items.includes(active)
      ) {
        event.preventDefault();
        (event.shiftKey ? last : first).focus();
        return;
      }
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      window.cancelAnimationFrame(focusFrame);
      document.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = previousOverflow;
      const returnTarget = returnFocusRef ? configuredReturnTarget : previouslyFocused;
      window.requestAnimationFrame(() => {
        const active = document.activeElement;
        if (
          !returnTarget?.isConnected ||
          returnTarget.closest("[inert]") ||
          (active instanceof HTMLElement && active !== document.body)
        ) return;
        returnTarget.focus();
      });
    };
  }, [returnFocusRef]);

  return dialogRef;
}
