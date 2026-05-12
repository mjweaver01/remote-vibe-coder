import { useEffect, useImperativeHandle, useRef, forwardRef } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";

export interface XTermHandle {
  focus(): void;
  fit(): { cols: number; rows: number } | null;
  write(data: string): void;
  writeln(data: string): void;
  scrollToBottom(): void;
}

interface Props {
  initialReplay?: string;
  onData(data: string): void;
  onResize(cols: number, rows: number): void;
  onScrollAwayChange?(awayFromBottom: boolean): void;
}

export const XTerm = forwardRef<XTermHandle, Props>(function XTerm(
  { initialReplay, onData, onResize, onScrollAwayChange },
  ref
) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const lastSizeRef = useRef<{ cols: number; rows: number }>({ cols: 0, rows: 0 });
  const onDataRef = useRef(onData);
  const onResizeRef = useRef(onResize);
  const onScrollAwayRef = useRef(onScrollAwayChange);

  useEffect(() => {
    onDataRef.current = onData;
    onResizeRef.current = onResize;
    onScrollAwayRef.current = onScrollAwayChange;
  }, [onData, onResize, onScrollAwayChange]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const readTheme = () => {
      const root = getComputedStyle(document.documentElement);
      const v = (name: string, fallback: string) =>
        (root.getPropertyValue(name).trim() || fallback);
      return {
        background: v("--bg-black", "#000000"),
        foreground: v("--text", "#e9e9ec"),
        cursor: v("--accent", "#ff8a4c"),
        cursorAccent: v("--bg-black", "#000000"),
        selectionBackground: "rgba(255,138,76,0.35)",
      };
    };

    const term = new Terminal({
      cursorBlink: true,
      fontSize: 13,
      fontFamily: 'ui-monospace, "SF Mono", Menlo, monospace',
      theme: readTheme(),
      allowProposedApi: true,
      scrollback: 5000,
    });

    const refreshTheme = () => {
      term.options.theme = readTheme();
    };
    const themeObserver = new MutationObserver(refreshTheme);
    themeObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme"],
    });
    const mql = window.matchMedia("(prefers-color-scheme: light)");
    mql.addEventListener("change", refreshTheme);
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.loadAddon(new WebLinksAddon());
    term.open(container);

    if (initialReplay) term.write(initialReplay);

    const dataDispose = term.onData((d) => onDataRef.current(d));

    let lastAway = false;
    const checkAway = () => {
      const buf = term.buffer.active;
      const away = buf.viewportY < buf.baseY;
      if (away !== lastAway) {
        lastAway = away;
        onScrollAwayRef.current?.(away);
      }
    };
    const scrollDispose = term.onScroll(checkAway);
    // onScroll fires on user scroll but not when new output advances baseY
    // while viewportY stays put. Poll covers that case cheaply.
    const awayPoll = window.setInterval(checkAway, 300);

    const fitNow = () => {
      try {
        fit.fit();
        const { cols, rows } = term;
        const last = lastSizeRef.current;
        if (cols !== last.cols || rows !== last.rows) {
          lastSizeRef.current = { cols, rows };
          onResizeRef.current(cols, rows);
        }
      } catch (err) {
        // Expected when container is hidden during a tab switch; log real errors
        if (container.offsetParent !== null) {
          console.error("xterm fit error:", err);
        }
      }
    };

    const ro = new ResizeObserver(() => fitNow());
    ro.observe(container);

    // xterm.js has no native touch scrolling (xtermjs/xterm.js#1007). Translate
    // single-finger drags into term.scrollLines. Capture-phase + non-passive so
    // we win over xterm's internal pointer/textarea handling and can preventDefault.
    let touchStartY = 0;
    let touchLastY = 0;
    let touchScrolling = false;
    let touchPxPerLine = 8;
    let touchVelocity = 0;
    let touchLastT = 0;
    let momentumRaf = 0;

    const cancelMomentum = () => {
      if (momentumRaf) {
        cancelAnimationFrame(momentumRaf);
        momentumRaf = 0;
      }
    };

    const onTouchStart = (e: TouchEvent) => {
      cancelMomentum();
      if (e.touches.length !== 1) return;
      const t = e.touches[0]!;
      touchStartY = t.clientY;
      touchLastY = t.clientY;
      touchLastT = e.timeStamp;
      touchVelocity = 0;
      touchScrolling = false;
      // Sensitivity: roughly half a row per pixel of finger travel feels close
      // to native iOS momentum. Computed live so it stays sane across zooms.
      const rowH = Math.max(8, container.clientHeight / Math.max(term.rows, 1));
      touchPxPerLine = Math.max(4, rowH * 0.5);
    };

    const onTouchMove = (e: TouchEvent) => {
      if (e.touches.length !== 1) return;
      const y = e.touches[0]!.clientY;
      if (!touchScrolling) {
        if (Math.abs(y - touchStartY) < 4) return;
        touchScrolling = true;
      }
      const dy = y - touchLastY;
      const dt = Math.max(1, e.timeStamp - touchLastT);
      touchVelocity = dy / dt; // px per ms; negative = swiping up
      const lines = Math.round(-dy / touchPxPerLine);
      if (lines !== 0) {
        term.scrollLines(lines);
        touchLastY = touchLastY - lines * touchPxPerLine;
      }
      touchLastT = e.timeStamp;
      if (e.cancelable) e.preventDefault();
    };

    const onTouchEnd = (e: TouchEvent) => {
      if (!touchScrolling) return;
      touchScrolling = false;
      // Momentum: decay velocity each frame, scroll proportionally.
      let v = touchVelocity;
      if (Math.abs(v) < 0.05) return;
      let leftover = 0;
      const step = () => {
        v *= 0.94;
        if (Math.abs(v) < 0.02) {
          momentumRaf = 0;
          return;
        }
        // 16ms per frame approx; pixels of inertia per frame:
        const dy = v * 16;
        leftover += -dy / touchPxPerLine;
        const lines = Math.trunc(leftover);
        if (lines !== 0) {
          term.scrollLines(lines);
          leftover -= lines;
        }
        momentumRaf = requestAnimationFrame(step);
      };
      momentumRaf = requestAnimationFrame(step);
      if (e.cancelable) e.preventDefault();
    };

    container.addEventListener("touchstart", onTouchStart, { passive: true, capture: true });
    container.addEventListener("touchmove", onTouchMove, { passive: false, capture: true });
    container.addEventListener("touchend", onTouchEnd, { passive: false, capture: true });
    container.addEventListener("touchcancel", cancelMomentum, { passive: true, capture: true });
    // Double rAF ensures fit runs after layout is painted; timeout covers
    // mobile browsers that settle dvh/safe-area after the first frame.
    requestAnimationFrame(() => requestAnimationFrame(fitNow));
    const fitTimer = setTimeout(fitNow, 150);

    termRef.current = term;
    fitRef.current = fit;

    return () => {
      clearTimeout(fitTimer);
      themeObserver.disconnect();
      mql.removeEventListener("change", refreshTheme);
      ro.disconnect();
      cancelMomentum();
      container.removeEventListener("touchstart", onTouchStart, { capture: true });
      container.removeEventListener("touchmove", onTouchMove, { capture: true });
      container.removeEventListener("touchend", onTouchEnd, { capture: true });
      container.removeEventListener("touchcancel", cancelMomentum, { capture: true });
      clearInterval(awayPoll);
      dataDispose.dispose();
      scrollDispose.dispose();
      term.dispose();
      termRef.current = null;
      fitRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useImperativeHandle(ref, () => ({
    focus: () => termRef.current?.focus(),
    fit: () => {
      if (!termRef.current || !fitRef.current) return null;
      try {
        fitRef.current.fit();
        return { cols: termRef.current.cols, rows: termRef.current.rows };
      } catch {
        return null;
      }
    },
    write: (data) => termRef.current?.write(data),
    writeln: (data) => termRef.current?.writeln(data),
    scrollToBottom: () => termRef.current?.scrollToBottom(),
  }));

  return <div ref={containerRef} className="xterm-host" />;
});
