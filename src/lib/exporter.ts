/** Notu tek parca HTML ya da PDF olarak disa aktarir (semalar ve resimler gomulu). */
import katexCss from "katex/dist/katex.min.css?inline";
import hljsCss from "highlight.js/styles/github.css?inline";
import mdCss from "../styles/markdown.css?inline";
import { api } from "../api";
import { toast, useStore } from "../store";
import { renderDrawings, renderMermaid } from "./diagrams";
import { esc } from "./markdown";
import { title } from "./paths";
import { renderNote } from "./render";

async function toDataUrl(url: string): Promise<string> {
  const blob = await (await fetch(url)).blob();
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
}

export async function buildExportHtml(path: string): Promise<string> {
  const s = useStore.getState();
  const box = document.createElement("div");
  box.className = "markdown export";
  box.style.cssText = "position:fixed;left:-10000px;top:0;width:800px";
  box.innerHTML = renderNote(path, s.notes[path] ?? "");
  document.body.appendChild(box);
  try {
    const mtime = (p: string) => s.files.find((f) => f.path === p)?.mtime ?? 0;
    await Promise.all([renderMermaid(box, false), renderDrawings(box, false, mtime)]);
    for (const img of [...box.querySelectorAll("img")]) {
      if (img.src.startsWith("atolye:")) {
        try {
          img.src = await toDataUrl(img.src);
        } catch {
          /* resim okunamadi */
        }
      }
    }
    box.querySelectorAll(".copy-code").forEach((b) => b.remove());
    box.querySelectorAll("input.task-box").forEach((i) => i.setAttribute("disabled", ""));
    const name = title(path);
    return `<!doctype html><html lang="tr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(name)}</title><style>${katexCss}\n${hljsCss}\n${mdCss}\n
:root{--text:#1f2329;--muted:#5f6673;--faint:#a3a9b4;--accent:#6c5ce7;--border:#e0e3e8;--code-bg:#f3f4f7;--bg:#fff;--bg-2:#f7f8fa}
body{margin:0;background:#fff;color:var(--text);font-family:"Segoe UI Variable Text","Segoe UI",system-ui,sans-serif;font-size:15px}
.markdown{max-width:760px;margin:40px auto;padding:0 24px}@page{margin:18mm}
@media print{.markdown{margin:0;max-width:none;padding:0}}</style></head>
<body><article class="markdown">${box.innerHTML}</article></body></html>`;
  } finally {
    box.remove();
  }
}

export async function exportNote(path: string, kind: "pdf" | "html"): Promise<void> {
  try {
    const html = await buildExportHtml(path);
    const ok = kind === "pdf" ? await api.exporter.pdf(html, title(path)) : await api.exporter.html(html, title(path));
    if (ok) toast(kind === "pdf" ? "PDF kaydedildi" : "HTML kaydedildi");
  } catch (e) {
    toast(`Dışa aktarma başarısız: ${String((e as Error)?.message || e)}`, "error");
  }
}
