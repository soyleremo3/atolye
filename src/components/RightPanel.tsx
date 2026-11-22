import { useMemo } from "react";
import { ArrowUpRight, Link2, ListTree, SlidersHorizontal } from "lucide-react";
import { isNote, title } from "../lib/paths";
import { followLink, openPath, useIndex, useStore } from "../store";

function Outline({ path }: { path: string }) {
  const idx = useIndex();
  const headings = idx.parsed.get(path)?.headings ?? [];
  if (!headings.length) return <div className="empty-hint">Bu notta başlık yok. # ile başlık ekleyebilirsin.</div>;
  const min = Math.min(...headings.map((h) => h.level));
  return (
    <div className="outline">
      {headings.map((h, i) => (
        <button
          key={i}
          className="outline-row"
          style={{ paddingLeft: 12 + (h.level - min) * 14 }}
          onClick={() => useStore.setState((s) => ({ jump: { path, line: h.line, nonce: Date.now(), tab: s.active ?? undefined } }))}
        >
          {h.text}
        </button>
      ))}
    </div>
  );
}

function Links({ path }: { path: string }) {
  const idx = useIndex();
  const back = idx.backlinks.get(path) ?? [];
  const out = idx.outgoing.get(path) ?? [];
  const unresolved = (idx.parsed.get(path)?.links ?? []).filter((l) => l.target && !idx.resolver.resolve(l.target));
  const grouped = new Map<string, typeof back>();
  for (const b of back) grouped.set(b.from, [...(grouped.get(b.from) || []), b]);
  return (
    <div className="links">
      <div className="section-title">Geri bağlantılar <span className="count">{grouped.size}</span></div>
      {!grouped.size && <div className="empty-hint">Bu nota henüz bağlantı yok.</div>}
      {[...grouped.entries()].map(([from, refs]) => (
        <div key={from} className="backlink">
          <button className="backlink-title" onClick={(e) => void openPath(from, { newTab: e.ctrlKey, line: refs[0].line })}>
            {title(from)}
          </button>
          {refs.slice(0, 3).map((r, i) => (
            <div key={i} className="backlink-ctx" onClick={() => void openPath(from, { line: r.line })}>
              {r.text}
            </div>
          ))}
        </div>
      ))}
      <div className="section-title">Giden bağlantılar <span className="count">{out.length}</span></div>
      {out.map((p) => (
        <button key={p} className="link-row" onClick={(e) => void openPath(p, { newTab: e.ctrlKey })}>
          <ArrowUpRight size={13} /> {isNote(p) ? title(p) : p}
        </button>
      ))}
      <UnlinkedMentions path={path} />
      {unresolved.map((l, i) => (
        <button key={`u${i}`} className="link-row unresolved" title="Tıkla: notu oluştur" onClick={() => void followLink(l.target, { from: path })}>
          <ArrowUpRight size={13} /> {l.target}
        </button>
      ))}
    </div>
  );
}

/** Bu notun adi gecen ama [[baglanti]] verilmemis notlar (Obsidian'daki "unlinked mentions"). */
function UnlinkedMentions({ path }: { path: string }) {
  const notes = useStore((s) => s.notes);
  const idx = useIndex();
  const name = title(path);
  const hits = useMemo(() => {
    if (name.length < 3) return [];
    const linked = new Set((idx.backlinks.get(path) ?? []).map((b) => b.from));
    const esc = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const re = new RegExp(`(^|[^\\p{L}\\p{N}])${esc}($|[^\\p{L}\\p{N}])`, "iu");
    const out: { from: string; line: number; text: string }[] = [];
    for (const [p, src] of Object.entries(notes)) {
      if (p === path || linked.has(p) || !isNote(p)) continue;
      const lines = src.split("\n");
      for (let i = 0; i < lines.length && out.length < 40; i++) {
        if (re.test(lines[i]) && !lines[i].includes("[[")) {
          out.push({ from: p, line: i, text: lines[i].trim().slice(0, 140) });
          break;
        }
      }
    }
    return out;
  }, [notes, idx, path, name]);
  return (
    <>
      <div className="section-title">Bağlantısız anmalar <span className="count">{hits.length}</span></div>
      {!hits.length && <div className="empty-hint">"{name}" başka notlarda bağlantısız geçmiyor.</div>}
      {hits.map((h) => (
        <div key={h.from} className="backlink">
          <button className="backlink-title" onClick={(e) => void openPath(h.from, { newTab: e.ctrlKey, line: h.line })}>{title(h.from)}</button>
          <div className="backlink-ctx" onClick={() => void openPath(h.from, { line: h.line })}>{h.text}</div>
        </div>
      ))}
    </>
  );
}

/** Notun basindaki --- ozellikler --- blogu (YAML, basit anahtar: deger ve - liste). */
export function parseProps(src: string): [string, string[]][] {
  const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(src);
  if (!m) return [];
  const out: [string, string[]][] = [];
  for (const line of m[1].split(/\r?\n/)) {
    const kv = /^([A-Za-z0-9_\-çğıöşüÇĞİÖŞÜ ]+):\s*(.*)$/.exec(line);
    if (kv) {
      const v = kv[2].trim();
      const list = /^\[(.*)\]$/.exec(v);
      out.push([kv[1].trim(), list ? list[1].split(",").map((x) => x.trim().replace(/^["']|["']$/g, "")).filter(Boolean) : v ? [v.replace(/^["']|["']$/g, "")] : []]);
    } else if (/^\s*-\s+/.test(line) && out.length) {
      out[out.length - 1][1].push(line.replace(/^\s*-\s+/, "").trim());
    }
  }
  return out;
}

function Props({ path }: { path: string }) {
  const src = useStore((s) => s.notes[path] ?? "");
  const props = useMemo(() => parseProps(src), [src]);
  if (!props.length)
    return <div className="empty-hint">Bu notun özellikleri yok. En üste --- arasına yaz: <br /><code>etiketler: [fikir, iş]</code><br /><code>durum: taslak</code></div>;
  return (
    <div className="props">
      {props.map(([k, vals]) => (
        <div key={k} className="prop-row">
          <span className="prop-key">{k}</span>
          <span className="prop-vals">{vals.length ? vals.map((v, i) => <span key={i} className="prop-chip">{v}</span>) : <span className="muted">—</span>}</span>
        </div>
      ))}
    </div>
  );
}

export function RightPanel() {
  const view = useStore((s) => s.rightView);
  const tab = useStore((s) => s.tabs.find((t) => t.id === s.active));
  const path = tab?.kind === "note" ? tab.path : null;
  return (
    <aside className="sidebar right">
      <div className="seg">
        <button className={view === "outline" ? "on" : ""} onClick={() => useStore.setState({ rightView: "outline" })}>
          <ListTree size={14} /> Ana hatlar
        </button>
        <button className={view === "links" ? "on" : ""} onClick={() => useStore.setState({ rightView: "links" })}>
          <Link2 size={14} /> Bağlantılar
        </button>
        <button className={view === "props" ? "on" : ""} onClick={() => useStore.setState({ rightView: "props" })}>
          <SlidersHorizontal size={14} /> Özellikler
        </button>
      </div>
      <div className="right-body">
        {!path ? <div className="empty-hint">Bir not aç.</div> : view === "outline" ? <Outline path={path} /> : view === "props" ? <Props path={path} /> : <Links path={path} />}
      </div>
    </aside>
  );
}
