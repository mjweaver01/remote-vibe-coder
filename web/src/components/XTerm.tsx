import { useEffect, useImperativeHandle, useRef, forwardRef } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";

export interface XTermHandle {
  focus(): void;
  fit(): { cols: number; rows: number } | null;
  write(data: string): void;
  writeln(data: string): void;
}

interface Props {
  initialReplay?: string;
  onData(data: string): void;
  onResize(cols: number, rows: number): void;
}

export const XTerm = forwardRef<XTermHandle, Props>(function XTerm(
  { initialReplay, onData, onResize },
  ref
) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const lastSizeRef = useRef<{ cols: number; rows: number }>({ cols: 0, rows: 0 });
  const onDataRef = useRef(onData);
  const onResizeRef = useRef(onResize);

  useEffect(() => {
    onDataRef.current = onData;
    onResizeRef.current = onResize;
  }, [onData, onResize]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const term = new Terminal({
      cursorBlink: true,
      fontSize: 13,
      fontFamily: 'ui-monospace, "SF Mono", Menlo, monospace',
      theme: {
        background: "#000000",
        foreground: "#e9e9ec",
        cursor: "#ff8a4c",
        cursorAccent: "#000000",
        selectionBackground: "rgba(255,138,76,0.35)",
      },
      allowProposedApi: true,
      scrollback: 5000,
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.loadAddon(new WebLinksAddon());
    term.open(container);

    if (initialReplay) term.write(initialReplay);

    const dataDispose = term.onData((d) => onDataRef.current(d));

    const fitNow = () => {
      try {
        fit.fit();
        const { cols, rows } = term;
        const last = lastSizeRef.current;
        if (cols !== last.cols || rows !== last.rows) {
          lastSizeRef.current = { cols, rows };
          onResizeRef.current(cols, rows);
        }
      } catch {
        // container may be hidden during a tab switch
      }
    };

    const ro = new ResizeObserver(() => fitNow());
    ro.observe(container);
    requestAnimationFrame(fitNow);

    termRef.current = term;
    fitRef.current = fit;

    return () => {
      ro.disconnect();
      dataDispose.dispose();
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
  }));

  return <div ref={containerRef} className="xterm-host" />;
});
