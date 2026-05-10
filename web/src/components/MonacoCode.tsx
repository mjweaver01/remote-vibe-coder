import { useEffect, useRef } from "react";
import { languageForFile, loadMonaco } from "../lib/monaco.ts";

interface Props {
  /** When provided, renders a side-by-side / inline diff editor. */
  diff?: { original: string; modified: string };
  /** Plain code mode. */
  code?: string;
  /** Used to choose Monaco language mode. */
  fileName: string;
}

/**
 * Single-shot Monaco editor wrapper. Internally creates a fresh editor for the
 * `code` path or a DiffEditor for the `diff` path; switching paths disposes the
 * old editor and creates the new one. This keeps the API trivial and avoids
 * state bugs from re-using one editor for both modes.
 */
export function MonacoCode({ diff, code, fileName }: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const editorRef = useRef<any>(null);
  const diffEditorRef = useRef<any>(null);
  const cancelledRef = useRef(false);

  useEffect(() => {
    cancelledRef.current = false;
    const container = containerRef.current;
    if (!container) return;

    let cleanup: (() => void) | null = null;
    let resizeObs: ResizeObserver | null = null;

    void (async () => {
      const monaco = await loadMonaco();
      if (cancelledRef.current) return;

      const isWide = window.innerWidth >= 900;
      const lang = languageForFile(fileName);

      // Tear down any previous editor in this container.
      editorRef.current?.dispose();
      diffEditorRef.current?.dispose();
      editorRef.current = null;
      diffEditorRef.current = null;
      container.innerHTML = "";

      if (diff) {
        const ed = monaco.editor.createDiffEditor(container, {
          readOnly: true,
          theme: "vs-dark",
          automaticLayout: true,
          renderSideBySide: isWide,
          scrollBeyondLastLine: false,
          fontSize: 13,
        });
        const original = monaco.editor.createModel(diff.original, lang);
        const modified = monaco.editor.createModel(diff.modified, lang);
        ed.setModel({ original, modified });
        diffEditorRef.current = ed;
        cleanup = () => {
          ed.dispose();
          original.dispose();
          modified.dispose();
        };
      } else {
        const ed = monaco.editor.create(container, {
          value: code ?? "",
          language: lang,
          readOnly: true,
          theme: "vs-dark",
          automaticLayout: true,
          minimap: { enabled: isWide },
          scrollBeyondLastLine: false,
          fontSize: 13,
          renderWhitespace: "selection",
        });
        editorRef.current = ed;
        cleanup = () => ed.dispose();
      }

      resizeObs = new ResizeObserver(() => {
        editorRef.current?.layout();
        diffEditorRef.current?.layout();
      });
      resizeObs.observe(container);
    })();

    return () => {
      cancelledRef.current = true;
      resizeObs?.disconnect();
      cleanup?.();
      editorRef.current = null;
      diffEditorRef.current = null;
    };
  }, [diff?.original, diff?.modified, code, fileName]);

  return <div ref={containerRef} className="monaco-host" />;
}
