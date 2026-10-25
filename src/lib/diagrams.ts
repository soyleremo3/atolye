/**
 * Onizlemede sonradan cizilen icerikler: Mermaid semalari ve gomulu Excalidraw cizimleri.
 * Agir kutuphaneler sadece ilk ihtiyac aninda yuklenir ve sonuclar onbellege alinir.
 */
import { api } from "../api";
import { esc } from "./markdown";

type Mermaid = typeof import("mermaid").default;
let mermaidLoad: Promise<Mermaid> | null = null;
let mermaidTheme = "";
let seq = 0;
const mermaidCache = new Map<string, string>();
const drawingCache = new Map<string, string>();

export async function renderMermaid(root: HTMLElement, dark: boolean): Promise<void> {
  const blocks = [...root.querySelectorAll<HTMLElement>(".mermaid-block:not([data-done])")];
  if (!blocks.length) return;
  const mermaid = await (mermaidLoad ??= import("mermaid").then((m) => m.default));
  const theme = dark ? "dark" : "default";
  if (theme !== mermaidTheme) {
    mermaid.initialize({
      startOnLoad: false,
      theme,
      securityLevel: "strict",
      fontFamily: '"Segoe UI Variable Text", "Segoe UI", sans-serif',
    });
    mermaidTheme = theme;
  }
  for (const el of blocks) {
    el.dataset.done = "1";
    const code = decodeURIComponent(el.dataset.code || "");
    const key = `${theme}\u0000${code}`;
    let svg = mermaidCache.get(key);
    if (!svg) {
      const id = `mmd-${++seq}`;
      try {
        svg = (await mermaid.render(id, code)).svg;
        mermaidCache.set(key, svg);
      } catch (e) {
        document.getElementById(id)?.remove();
        document.getElementById(`d${id}`)?.remove();
        el.innerHTML = `<div class="diagram-error"><b>Şema hatası</b><br>${esc(String((e as Error)?.message || e).slice(0, 400))}</div>`;
        continue;
      }
    }
    if (el.isConnected) el.innerHTML = svg;
  }
}

export async function drawingSvg(path: string, mtime: number, dark: boolean): Promise<string> {
  const key = `${path}\u0000${mtime}\u0000${dark}`;
  const hit = drawingCache.get(key);
  if (hit) return hit;
  const [{ exportToSvg, restoreElements }, raw] = await Promise.all([import("@excalidraw/excalidraw"), api.vault.read(path)]);
  const data = JSON.parse(raw || "{}");
  const elements = restoreElements(data.elements || [], null);
  const svg = await exportToSvg({
    elements,
    appState: {
      ...(data.appState || {}),
      exportBackground: true,
      exportWithDarkMode: dark,
      viewBackgroundColor: data.appState?.viewBackgroundColor ?? "#ffffff",
    },
    files: data.files || null,
    exportPadding: 16,
  });
  svg.removeAttribute("width");
  svg.removeAttribute("height");
  const out = svg.outerHTML;
  drawingCache.set(key, out);
  return out;
}

export async function renderDrawings(root: HTMLElement, dark: boolean, mtimeOf: (path: string) => number): Promise<void> {
  const blocks = [...root.querySelectorAll<HTMLElement>(".drawing-embed:not([data-done])")];
  for (const el of blocks) {
    el.dataset.done = "1";
    const path = el.dataset.path || "";
    try {
      const svg = await drawingSvg(path, mtimeOf(path), dark);
      if (el.isConnected) el.innerHTML = svg;
    } catch (e) {
      el.innerHTML = `<div class="diagram-error">Çizim açılamadı: ${esc(String((e as Error)?.message || e))}</div>`;
    }
  }
}
