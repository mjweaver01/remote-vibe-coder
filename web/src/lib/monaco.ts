// Lazy loader for Monaco. Monaco ships as an AMD bundle; we inject its loader
// the first time anyone needs it, then cache the resulting module.

declare global {
  interface Window {
    require: any;
    monaco: any;
  }
}

let pending: Promise<any> | null = null;

export function loadMonaco(): Promise<any> {
  if (pending) return pending;
  pending = new Promise((resolve, reject) => {
    if (window.monaco) {
      resolve(window.monaco);
      return;
    }

    const timeout = setTimeout(() => {
      pending = null;
      reject(new Error("Monaco editor timed out loading"));
    }, 15_000);

    const done = (result: unknown, err?: Error) => {
      clearTimeout(timeout);
      if (err) {
        pending = null;
        reject(err);
      } else {
        resolve(result);
      }
    };

    const script = document.createElement("script");
    script.src = "/assets/monaco/vs/loader.js";
    script.onload = () => {
      try {
        window.require.config({ paths: { vs: "/assets/monaco/vs" } });
        window.require(["vs/editor/editor.main"], () => done(window.monaco), (err: unknown) => done(null, err instanceof Error ? err : new Error(String(err))));
      } catch (err) {
        done(null, err instanceof Error ? err : new Error(String(err)));
      }
    };
    script.onerror = () => done(null, new Error("Failed to load Monaco editor assets"));
    document.head.appendChild(script);
  });
  return pending;
}

const LANG_BY_EXT: Record<string, string> = {
  ts: "typescript",
  tsx: "typescript",
  js: "javascript",
  jsx: "javascript",
  mjs: "javascript",
  cjs: "javascript",
  json: "json",
  css: "css",
  scss: "scss",
  less: "less",
  html: "html",
  xml: "xml",
  svg: "xml",
  md: "markdown",
  markdown: "markdown",
  py: "python",
  go: "go",
  rs: "rust",
  rb: "ruby",
  java: "java",
  c: "c",
  h: "c",
  cpp: "cpp",
  cc: "cpp",
  hpp: "cpp",
  swift: "swift",
  kt: "kotlin",
  yml: "yaml",
  yaml: "yaml",
  toml: "ini",
  ini: "ini",
  sh: "shell",
  bash: "shell",
  zsh: "shell",
  sql: "sql",
  graphql: "graphql",
  gql: "graphql",
  vue: "html",
  svelte: "html",
};

export function languageForFile(name: string): string {
  const lower = name.toLowerCase();
  if (lower === "dockerfile") return "dockerfile";
  const dot = lower.lastIndexOf(".");
  if (dot < 0) return "plaintext";
  return LANG_BY_EXT[lower.slice(dot + 1)] ?? "plaintext";
}
