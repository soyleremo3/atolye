/** Kod parcalari kutuphanesi: ara, filtrele, onizle, tek tikla kopyala. Parcalar gercek kaynak dosyalaridir. */
import { useEffect, useMemo, useState } from "react";
import { Copy, ExternalLink, FilePlus, Pencil, Search, Trash2 } from "lucide-react";
import { api } from "../api";
import { fuzzyScore } from "../lib/fuzzy";
import { basename, extname, SNIPPET_DIR } from "../lib/paths";
import { deletePath, loadText, newSnippet, openPath, renamePath, toast, updateText, useStore, writeFile } from "../store";
import { CodeEditor, languageFor } from "./CodeEditor";

type Meta = Record<string, { tags?: string[]; desc?: string }>;
const META_PATH = ".atolye/parcalar.json";

export const langName = (path: string) => languageFor(basename(path))?.name ?? (extname(path).slice(1).toUpperCase() || "Metin");

export function SnippetsView() {
  const files = useStore((s) => s.files);
  const texts = useStore((s) => s.texts);
  const snippets = useMemo(
    () => files.filter((f) => !f.dir && f.path.startsWith(`${SNIPPET_DIR}/`)).sort((a, b) => b.mtime - a.mtime).map((f) => f.path),
    [files],
  );
  const [meta, setMeta] = useState<Meta>({});
  const [query, setQuery] = useState("");
  const [lang, setLang] = useState<string | null>(null);
  const [sel, setSel] = useState<string | null>(null);

  useEffect(() => {
    api.vault.read(META_PATH).then((raw) => {
      try {
        setMeta(JSON.parse(raw) as Meta);
      } catch {
        setMeta({});
      }
    }, () => setMeta({}));
  }, []);

  useEffect(() => {
    for (const p of snippets) if (!(p in texts)) void loadText(p);
  }, [snippets, texts]);

  const saveMeta = (m: Meta) => {
    setMeta(m);
    void writeFile(META_PATH, JSON.stringify(m, null, 2));
  };

  const langs = useMemo(() => [...new Set(snippets.map(langName))].sort(), [snippets]);
  const visible = useMemo(() => {
    const q = query.trim();
    return snippets
      .filter((p) => !lang || langName(p) === lang)
      .map((p) => {
        if (!q) return { p, s: 0 };
        const m = meta[p] ?? {};
        const hay = `${basename(p)} ${(m.tags ?? []).join(" ")} ${m.desc ?? ""}`;
        let s = fuzzyScore(q, hay);
        if (s < 0 && (texts[p] ?? "").toLowerCase().includes(q.toLowerCase())) s = 1;
        return { p, s };
      })
      .filter((x) => x.s >= 0)
      .sort((a, b) => b.s - a.s)
      .map((x) => x.p);
  }, [snippets, query, lang, meta, texts]);

  const current = sel && snippets.includes(sel) ? sel : visible[0] ?? null;
  const m = current ? meta[current] ?? {} : {};
  const copy = (p: string) =>
    void navigator.clipboard.writeText(texts[p] ?? "").then(() => toast(`“${basename(p)}” kopyalandı`));

  return (
    <div className="snippets">
      <aside className="snip-list">
        <div className="snip-search">
          <Search size={14} />
          <input autoFocus placeholder="Ad, etiket, açıklama veya kod içinde ara…" value={query} onChange={(e) => setQuery(e.target.value)} />
          <button className="icon-btn" title="Yeni parça" onClick={newSnippet}><FilePlus size={15} /></button>
        </div>
        <div className="chips">
          <button className={`chip-btn${!lang ? " on" : ""}`} onClick={() => setLang(null)}>Tümü {snippets.length}</button>
          {langs.map((l) => (
            <button key={l} className={`chip-btn${lang === l ? " on" : ""}`} onClick={() => setLang(lang === l ? null : l)}>{l}</button>
          ))}
        </div>
        <div className="snip-items">
          {visible.map((p) => (
            <div
              key={p}
              className={`snip-item${p === current ? " on" : ""}`}
              onClick={() => setSel(p)}
              onDoubleClick={() => void openPath(p, { newTab: true })}
            >
              <div className="snip-top">
                <span className="snip-name">{basename(p)}</span>
                <span className="lang-badge">{langName(p)}</span>
              </div>
              {meta[p]?.desc && <div className="snip-desc">{meta[p].desc}</div>}
              {!!meta[p]?.tags?.length && <div className="snip-tags">{meta[p].tags!.map((t) => <span key={t}>#{t}</span>)}</div>}
            </div>
          ))}
          {!visible.length && <div className="empty-hint">{snippets.length ? "Eşleşen parça yok." : "Henüz parça yok. Yukarıdaki + ile ekle."}</div>}
        </div>
      </aside>
      {current ? (
        <section className="snip-detail">
          <div className="snip-head">
            <div className="snip-title">
              <span className="snip-name big">{basename(current)}</span>
              <span className="lang-badge">{langName(current)}</span>
            </div>
            <div className="row-gap">
              <button className="btn primary" onClick={() => copy(current)}><Copy size={14} /> Kopyala</button>
              <button className="btn" onClick={() => void openPath(current, { newTab: true })}><Pencil size={14} /> Düzenle</button>
              <button className="icon-btn" title="Yeniden adlandır" onClick={() => renamePath(current)}><Pencil size={15} /></button>
              <button className="icon-btn" title="Dosya Gezgini'nde göster" onClick={() => void api.vault.reveal(current)}><ExternalLink size={15} /></button>
              <button className="icon-btn" title="Sil" onClick={() => deletePath(current)}><Trash2 size={15} /></button>
            </div>
          </div>
          <input
            className="plain-input"
            placeholder="Açıklama ekle…"
            value={m.desc ?? ""}
            onChange={(e) => saveMeta({ ...meta, [current]: { ...m, desc: e.target.value } })}
          />
          <input
            className="plain-input"
            placeholder="Etiketler (virgülle): react, hooks"
            defaultValue={(m.tags ?? []).join(", ")}
            key={current}
            onBlur={(e) =>
              saveMeta({ ...meta, [current]: { ...m, tags: e.target.value.split(",").map((t) => t.trim().replace(/^#/, "")).filter(Boolean) } })
            }
          />
          <div className="snip-code">
            <CodeEditor key={current} value={texts[current] ?? ""} language={basename(current)} readOnly />
          </div>
        </section>
      ) : (
        <div className="empty-state">Bir parça seç.</div>
      )}
    </div>
  );
}

/** Tek bir kod dosyasini duzenler (otomatik kayit). */
export function CodeView({ path }: { path: string }) {
  const value = useStore((s) => s.texts[path]);
  if (value === undefined) return <div className="empty-state">Yükleniyor…</div>;
  const lines = value.split("\n").length;
  return (
    <div className="code-view">
      <div className="code-bar">
        <span className="lang-badge">{langName(path)}</span>
        <span className="faint">{lines.toLocaleString("tr")} satır · {value.length.toLocaleString("tr")} karakter</span>
        <button className="icon-btn" title="Tümünü kopyala" onClick={() => void navigator.clipboard.writeText(value).then(() => toast("Kopyalandı"))}>
          <Copy size={14} />
        </button>
      </div>
      <CodeEditor key={path} value={value} language={basename(path)} autoFocus onChange={(v) => updateText(path, v)} />
    </div>
  );
}
