import { useDeferredValue, useEffect, useLayoutEffect, useMemo, useRef, type MouseEvent } from "react";
import { api } from "../api";
import { renderDrawings, renderMermaid } from "../lib/diagrams";
import { renderNote } from "../lib/render";
import { followLink, isDark, openPath, openSearch, toast, updateNote, useStore } from "../store";

type Props = { path: string; content: string };

export function Preview({ path, content }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const deferred = useDeferredValue(content);
  const indexVersion = useStore((s) => s.indexVersion);
  const dark = useStore(isDark);
  const jump = useStore((s) => (s.jump?.path === path ? s.jump : null));
  const html = useMemo(() => renderNote(path, deferred), [path, deferred, indexVersion]);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const files = useStore.getState().files;
    const mtime = (p: string) => files.find((f) => f.path === p)?.mtime ?? 0;
    void renderMermaid(el, dark);
    void renderDrawings(el, dark, mtime);
  }, [html, dark]);

  useEffect(() => {
    const el = ref.current;
    if (!el || !jump) return;
    const blocks = [...el.querySelectorAll<HTMLElement>("[data-line]")];
    const target = blocks.filter((b) => Number(b.dataset.line) <= jump.line).pop();
    target?.scrollIntoView({ block: "start", behavior: "smooth" });
  }, [jump]);

  const onClick = (e: MouseEvent<HTMLDivElement>) => {
    const el = e.target as HTMLElement;
    const newTab = e.ctrlKey || e.metaKey || e.button === 1;
    const link = el.closest<HTMLElement>("a.wikilink");
    if (link) {
      e.preventDefault();
      void followLink(link.dataset.href || "", { newTab, heading: link.dataset.heading || undefined, from: path });
      return;
    }
    const tag = el.closest<HTMLElement>("a.tag");
    if (tag) {
      e.preventDefault();
      openSearch(`#${tag.dataset.tag}`);
      return;
    }
    const ext = el.closest<HTMLAnchorElement>("a.external, a[href^='http'], a[href^='mailto']");
    if (ext) {
      e.preventDefault();
      void api.app.openExternal(ext.href);
      return;
    }
    const copy = el.closest<HTMLElement>(".copy-code");
    if (copy) {
      void navigator.clipboard.writeText(decodeURIComponent(copy.dataset.code || "")).then(() => toast("Kod kopyalandı"));
      return;
    }
    const drawing = el.closest<HTMLElement>(".drawing-embed");
    if (drawing?.dataset.path) {
      void openPath(drawing.dataset.path, { newTab });
      return;
    }
    if (el instanceof HTMLInputElement && el.classList.contains("task-box")) {
      const line = Number(el.dataset.line);
      const src = useStore.getState().notes[path] ?? "";
      const lines = src.split("\n");
      if (line >= 0 && line < lines.length) {
        lines[line] = lines[line].replace(/\[( |x|X)\]/, (_m, c: string) => (c === " " ? "[x]" : "[ ]"));
        updateNote(path, lines.join("\n"));
      }
    }
  };

  return (
    <div className="preview-scroll">
      <article key={dark ? "dark" : "light"} ref={ref} className="markdown" onClick={onClick} onAuxClick={onClick} dangerouslySetInnerHTML={{ __html: html }} />
    </div>
  );
}
