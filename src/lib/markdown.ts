/**
 * Markdown -> guvenli HTML. Obsidian uyumlu eklentiler:
 * [[wiki baglantilari]], ![[gomme]], #etiket, > [!callout], - [ ] gorev, ==vurgu==, dipnot, KaTeX matematik,
 * kod renklendirme, ```mermaid semalari (sonradan cizilir).
 */
import MarkdownIt from "markdown-it";
import type { MarkdownIt as MarkdownItType } from "markdown-it";
import footnote from "markdown-it-footnote";
import mark from "markdown-it-mark";
import katexPlugin from "@vscode/markdown-it-katex";
import katex from "katex";
import hljs from "highlight.js/lib/common";
import DOMPurify from "dompurify";
import { splitTarget } from "./links";
import { dirname, isDrawing, isImage, isNote, join, title } from "./paths";
import { vaultUrl } from "../api";

export type RenderEnv = {
  notePath: string;
  resolve: (target: string) => string | null;
  renderNote: (path: string, heading: string | undefined, depth: number) => string;
  depth: number;
};

type Token = ReturnType<MarkdownItType["parse"]>[number];

export const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

const CALLOUT_KIND: Record<string, string> = {
  note: "blue", info: "blue", todo: "blue", abstract: "cyan", summary: "cyan", tldr: "cyan",
  tip: "teal", hint: "teal", important: "teal", success: "green", check: "green", done: "green",
  question: "orange", help: "orange", faq: "orange", warning: "orange", caution: "orange", attention: "orange",
  failure: "red", fail: "red", missing: "red", danger: "red", error: "red", bug: "red",
  example: "purple", quote: "gray", cite: "gray",
};
const CALLOUT_TITLE: Record<string, string> = {
  note: "Not", info: "Bilgi", todo: "Yapılacak", abstract: "Özet", summary: "Özet", tldr: "Kısaca", tip: "İpucu",
  hint: "İpucu", important: "Önemli", success: "Başarılı", check: "Tamam", done: "Bitti", question: "Soru",
  help: "Yardım", faq: "SSS", warning: "Uyarı", caution: "Dikkat", attention: "Dikkat", failure: "Hata", fail: "Hata",
  missing: "Eksik", danger: "Tehlike", error: "Hata", bug: "Hata", example: "Örnek", quote: "Alıntı", cite: "Alıntı",
};

function highlight(code: string, lang: string): string {
  if (lang && hljs.getLanguage(lang)) {
    try {
      return hljs.highlight(code, { language: lang, ignoreIllegals: true }).value;
    } catch {
      /* duz metin */
    }
  }
  return esc(code);
}

function wikilinkPlugin(md: MarkdownItType): void {
  md.inline.ruler.before("link", "wikilink", (state, silent) => {
    const src = state.src;
    let pos = state.pos;
    let embed = false;
    if (src.charCodeAt(pos) === 0x21 && src.startsWith("[[", pos + 1)) {
      embed = true;
      pos++;
    }
    if (!src.startsWith("[[", pos)) return false;
    const end = src.indexOf("]]", pos + 2);
    if (end < 0) return false;
    const inner = src.slice(pos + 2, end);
    if (!inner.trim() || /[\n[]/.test(inner)) return false;
    if (!silent) {
      const t = state.push("wikilink", "", 0);
      t.meta = { inner, embed };
    }
    state.pos = end + 2;
    return true;
  });

  md.renderer.rules.wikilink = (tokens, idx, _opts, rawEnv) => {
    const env = rawEnv as RenderEnv;
    const { inner, embed } = tokens[idx].meta as { inner: string; embed: boolean };
    const { target, heading, alias } = splitTarget(inner);
    const resolved = target ? env.resolve(target) : env.notePath;
    if (embed) {
      if (!resolved) return `<span class="embed-missing">“${esc(inner)}” bulunamadı</span>`;
      if (isImage(resolved)) {
        const size = alias?.match(/^(\d+)(?:x(\d+))?$/);
        const dims = size ? ` width="${size[1]}"${size[2] ? ` height="${size[2]}"` : ""}` : "";
        return `<img class="embed-image" src="${vaultUrl(resolved)}" alt="${esc(size ? title(resolved) : alias || title(resolved))}"${dims}>`;
      }
      if (isDrawing(resolved))
        return `<div class="drawing-embed" data-path="${esc(resolved)}" title="Çizimi aç"><div class="embed-loading">Çizim yükleniyor…</div></div>`;
      if (isNote(resolved)) {
        if (env.depth >= 2 || resolved === env.notePath) return `<a class="wikilink" data-href="${esc(resolved)}" href="#">${esc(title(resolved))}</a>`;
        return `<div class="note-embed"><a class="note-embed-title wikilink" data-href="${esc(resolved)}" href="#">${esc(
          title(resolved) + (heading ? ` › ${heading}` : ""),
        )}</a>${env.renderNote(resolved, heading, env.depth + 1)}</div>`;
      }
      return `<a class="wikilink" data-href="${esc(resolved)}" href="#">${esc(alias || title(resolved))}</a>`;
    }
    const label = alias || (heading ? `${target ? `${target} › ` : ""}${heading}` : target);
    return `<a class="wikilink${resolved ? "" : " unresolved"}" data-href="${esc(resolved || target)}" data-heading="${esc(
      heading || "",
    )}" href="#">${esc(label)}</a>`;
  };
}

function tagPlugin(md: MarkdownItType): void {
  const TAG = /^#([\p{L}\p{N}_\-/]*[\p{L}_\-/][\p{L}\p{N}_\-/]*)/u;
  md.inline.ruler.after("emphasis", "tag", (state, silent) => {
    if (state.src.charCodeAt(state.pos) !== 0x23) return false;
    const prev = state.pos > 0 ? state.src[state.pos - 1] : " ";
    if (!/[\s(,;]/.test(prev)) return false;
    const m = state.src.slice(state.pos).match(TAG);
    if (!m) return false;
    if (!silent) {
      const t = state.push("tag", "", 0);
      t.meta = { tag: m[1] };
    }
    state.pos += m[0].length;
    return true;
  });
  md.renderer.rules.tag = (tokens, idx) => {
    const tag = (tokens[idx].meta as { tag: string }).tag;
    return `<a class="tag" data-tag="${esc(tag)}" href="#">#${esc(tag)}</a>`;
  };
}

function calloutPlugin(md: MarkdownItType): void {
  md.core.ruler.after("block", "callout", (state) => {
    const t = state.tokens;
    for (let i = 0; i < t.length - 2; i++) {
      if (t[i].type !== "blockquote_open" || t[i + 1].type !== "paragraph_open" || t[i + 2].type !== "inline") continue;
      const m = t[i + 2].content.match(/^\[!([\w-]+)\]([+-]?)[ \t]*(.*)(\n|$)/);
      if (!m) continue;
      const type = m[1].toLowerCase();
      t[i].attrJoin("class", `callout callout-${CALLOUT_KIND[type] || "blue"}`);
      const head = new state.Token("callout_title", "", 0);
      head.meta = { title: m[3] || CALLOUT_TITLE[type] || m[1], type };
      t[i + 2].content = t[i + 2].content.slice(m[0].length);
      if (!t[i + 2].content.trim()) t.splice(i + 1, 3, head);
      else t.splice(i + 1, 0, head);
    }
  });
  md.renderer.rules.callout_title = (tokens, idx, _o, env) => {
    const { title: text } = tokens[idx].meta as { title: string };
    return `<div class="callout-title">${md.renderInline(text, { ...env, footnotes: undefined })}</div>`;
  };
}

function taskPlugin(md: MarkdownItType): void {
  md.core.ruler.after("block", "task_detect", (state) => {
    const t = state.tokens;
    for (let i = 2; i < t.length; i++) {
      if (t[i].type !== "inline" || t[i - 1].type !== "paragraph_open" || t[i - 2].type !== "list_item_open") continue;
      const m = t[i].content.match(/^\[([ xX])\](\s|$)/);
      if (!m) continue;
      t[i].content = t[i].content.slice(m[0].length);
      const checked = m[1] !== " ";
      const map = t[i].map;
      t[i].meta = { task: { checked, line: map ? map[0] : -1 } };
      t[i - 2].attrJoin("class", checked ? "task-item done" : "task-item");
    }
  });
  md.core.ruler.after("inline", "task_box", (state) => {
    for (const tok of state.tokens) {
      const task = (tok.meta as { task?: { checked: boolean; line: number } } | null)?.task;
      if (tok.type !== "inline" || !task) continue;
      const box = new state.Token("task_checkbox", "", 0);
      box.meta = task;
      tok.children = [box, ...(tok.children || [])];
    }
  });
  md.renderer.rules.task_checkbox = (tokens, idx) => {
    const { checked, line } = tokens[idx].meta as { checked: boolean; line: number };
    return `<input type="checkbox" class="task-box" data-line="${line}"${checked ? " checked" : ""}>`;
  };
}

function lineNumbers(md: MarkdownItType): void {
  md.core.ruler.push("line_numbers", (state) => {
    for (const tok of state.tokens as Token[]) {
      if (tok.map && tok.nesting === 1 && tok.level === 0) tok.attrSet("data-line", String(tok.map[0]));
    }
  });
}

function fencePlugin(md: MarkdownItType): void {
  md.renderer.rules.fence = (tokens, idx) => {
    const t = tokens[idx];
    const lang = t.info.trim().split(/\s+/)[0].toLowerCase();
    const line = t.map ? t.map[0] : 0;
    if (lang === "mermaid")
      return `<div class="mermaid-block" data-line="${line}" data-code="${encodeURIComponent(t.content)}"><div class="embed-loading">Şema çiziliyor…</div></div>`;
    if (lang === "math" || lang === "latex" || lang === "tex") {
      try {
        return `<div class="math-block" data-line="${line}">${katex.renderToString(t.content, { displayMode: true, throwOnError: false })}</div>`;
      } catch {
        /* duz kod olarak goster */
      }
    }
    return `<div class="code-block" data-line="${line}"><div class="code-head"><span>${esc(lang || "metin")}</span><button class="copy-code" data-code="${encodeURIComponent(t.content)}">Kopyala</button></div><pre class="hljs"><code>${highlight(t.content, lang)}</code></pre></div>`;
  };
}

function linkPlugin(md: MarkdownItType): void {
  const defaultLink = md.renderer.rules.link_open || ((tokens, idx, opts, _env, self) => self.renderToken(tokens, idx, opts));
  md.renderer.rules.link_open = (tokens, idx, opts, rawEnv, self) => {
    const env = rawEnv as RenderEnv;
    const tok = tokens[idx];
    const href = String(tok.attrGet("href") ?? "");
    if (/^[a-z][a-z0-9+.-]*:/i.test(href)) {
      tok.attrSet("target", "_blank");
      tok.attrSet("rel", "noopener noreferrer");
      tok.attrJoin("class", "external");
    } else if (href && !href.startsWith("#")) {
      let target = href;
      try {
        target = decodeURIComponent(href);
      } catch {
        /* oldugu gibi */
      }
      const resolved = env.resolve(join(dirname(env.notePath), target)) || env.resolve(target);
      tok.attrSet("href", "#");
      tok.attrSet("data-href", resolved || target);
      tok.attrJoin("class", resolved ? "wikilink" : "wikilink unresolved");
    }
    return defaultLink(tokens, idx, opts, rawEnv, self);
  };
  const defaultImage = md.renderer.rules.image!;
  md.renderer.rules.image = (tokens, idx, opts, rawEnv, self) => {
    const env = rawEnv as RenderEnv;
    const tok = tokens[idx];
    const src = String(tok.attrGet("src") ?? "");
    if (src && !/^[a-z][a-z0-9+.-]*:/i.test(src)) {
      let rel = src;
      try {
        rel = decodeURIComponent(src);
      } catch {
        /* oldugu gibi */
      }
      const resolved = env.resolve(join(dirname(env.notePath), rel)) || env.resolve(rel);
      if (resolved) tok.attrSet("src", vaultUrl(resolved));
    }
    return defaultImage(tokens, idx, opts, rawEnv, self);
  };
}

export const md = new MarkdownIt({ html: false, linkify: true, breaks: true, typographer: false });
md.use(footnote).use(mark).use(katexPlugin, { throwOnError: false, enableBareBlocks: true });
wikilinkPlugin(md);
tagPlugin(md);
calloutPlugin(md);
taskPlugin(md);
fencePlugin(md);
linkPlugin(md);
lineNumbers(md);

const PURIFY = {
  USE_PROFILES: { html: true, mathMl: true, svg: true },
  ADD_ATTR: ["target", "data-line", "data-href", "data-heading", "data-tag", "data-path", "data-code"],
  ALLOWED_URI_REGEXP: /^(?:(?:https?|mailto|atolye):|#|[^a-z]|[a-z+.-]+(?:[^a-z+.\-:]|$))/i,
};

export function renderMarkdown(src: string, env: RenderEnv): string {
  return DOMPurify.sanitize(md.render(stripFrontmatter(src), env), PURIFY) as string;
}

export function stripFrontmatter(src: string): string {
  if (!src.startsWith("---")) return src;
  const end = src.indexOf("\n---", 3);
  if (end < 0) return src;
  // satir numaralari kaymasin diye frontmatter bos satirlarla degistirilir
  const fm = src.slice(0, end + 4);
  return "\n".repeat((fm.match(/\n/g) || []).length) + src.slice(end + 4);
}

/** Bir notun belirli basliginin altindaki bolumu dondurur (gomme icin). */
export function sectionOf(src: string, heading: string): string {
  const lines = src.split("\n");
  const want = heading.trim().toLowerCase();
  const start = lines.findIndex((l) => /^#{1,6}\s/.test(l) && l.replace(/^#+\s*/, "").trim().toLowerCase() === want);
  if (start < 0) return src;
  const level = (lines[start].match(/^#+/) || [""])[0].length;
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    const m = lines[i].match(/^(#{1,6})\s/);
    if (m && m[1].length <= level) {
      end = i;
      break;
    }
  }
  return lines.slice(start, end).join("\n");
}
