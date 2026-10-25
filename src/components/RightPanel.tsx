import { ArrowUpRight, Link2, ListTree } from "lucide-react";
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
          onClick={() => useStore.setState({ jump: { path, line: h.line, nonce: Date.now() } })}
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
      {unresolved.map((l, i) => (
        <button key={`u${i}`} className="link-row unresolved" title="Tıkla: notu oluştur" onClick={() => void followLink(l.target, { from: path })}>
          <ArrowUpRight size={13} /> {l.target}
        </button>
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
      </div>
      <div className="right-body">
        {!path ? <div className="empty-hint">Bir not aç.</div> : view === "outline" ? <Outline path={path} /> : <Links path={path} />}
      </div>
    </aside>
  );
}
