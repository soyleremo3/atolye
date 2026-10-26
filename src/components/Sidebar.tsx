import { memo, useMemo, useState, type DragEvent, type MouseEvent } from "react";
import {
  ChevronDown, ChevronRight, ChevronsDownUp, Code2, File, FilePlus, FileText, Folder, FolderOpen, FolderPlus, Globe,
  Image as ImageIcon, PenTool, Pencil, ExternalLink, Trash2, SquareArrowOutUpRight, Columns2,
} from "lucide-react";
import { api, type FileEntry } from "../api";
import { basename, isCode, isDrawing, isHttp, isImage, isNote, join, title } from "../lib/paths";
import { searchNotes } from "../lib/vaultIndex";
import { deletePath, movePath, newDrawing, newFolder, newNote, openPath, openSearch, renamePath, useIndex, useStore } from "../store";
import { openMenu, type MenuItem } from "./Overlays";

type Node = { entry: FileEntry; children: Node[] };

function buildTree(files: FileEntry[]): Node[] {
  const roots: Node[] = [];
  const nodes = new Map<string, Node>();
  for (const f of files) nodes.set(f.path, { entry: f, children: [] });
  for (const f of files) {
    const parent = f.path.includes("/") ? f.path.slice(0, f.path.lastIndexOf("/")) : "";
    (parent ? nodes.get(parent)?.children : roots)?.push(nodes.get(f.path)!);
  }
  const collator = new Intl.Collator("tr", { numeric: true, sensitivity: "base" });
  const sort = (list: Node[]) => {
    list.sort((a, b) => (a.entry.dir === b.entry.dir ? collator.compare(a.entry.name, b.entry.name) : a.entry.dir ? -1 : 1));
    list.forEach((n) => sort(n.children));
    return list;
  };
  return sort(roots);
}

function iconFor(e: FileEntry, open: boolean) {
  if (e.dir) return open ? <FolderOpen size={15} /> : <Folder size={15} />;
  if (isNote(e.path)) return <FileText size={15} />;
  if (isDrawing(e.path)) return <PenTool size={15} />;
  if (isImage(e.path)) return <ImageIcon size={15} />;
  if (isHttp(e.path)) return <Globe size={15} />;
  if (isCode(e.path)) return <Code2 size={15} />;
  return <File size={15} />;
}

export const DRAG_TYPE = "application/x-atolye-path";

function menuFor(e: FileEntry): MenuItem[] {
  const items: MenuItem[] = [];
  if (e.dir) {
    items.push(
      { label: "Yeni not", icon: <FilePlus size={14} />, run: () => newNote(e.path) },
      { label: "Yeni çizim", icon: <PenTool size={14} />, run: () => newDrawing(e.path) },
      { label: "Yeni klasör", icon: <FolderPlus size={14} />, run: () => newFolder(e.path) },
      "sep",
    );
  } else {
    items.push(
      { label: "Yeni sekmede aç", icon: <SquareArrowOutUpRight size={14} />, run: () => void openPath(e.path, { newTab: true }) },
      { label: "Yanda aç (Alt+tık)", icon: <Columns2 size={14} />, run: () => void openPath(e.path, { side: true }) },
      "sep",
    );
  }
  items.push(
    { label: "Yeniden adlandır", icon: <Pencil size={14} />, run: () => renamePath(e.path) },
    { label: "Dosya Gezgini'nde göster", icon: <ExternalLink size={14} />, run: () => void api.vault.reveal(e.path) },
    "sep",
    { label: "Sil", icon: <Trash2 size={14} />, danger: true, run: () => deletePath(e.path) },
  );
  return items;
}

const TreeRow = memo(function TreeRow({ node, depth, activePath }: { node: Node; depth: number; activePath: string | null }) {
  const e = node.entry;
  const open = useStore((s) => !!s.expanded[e.path]);
  const dirty = useStore((s) => !!s.dirty[e.path]);
  const [over, setOver] = useState(false);

  const click = (ev: MouseEvent) => {
    if (e.dir) useStore.setState((s) => ({ expanded: { ...s.expanded, [e.path]: !s.expanded[e.path] } }));
    else if (ev.altKey) void openPath(e.path, { side: true });
    else void openPath(e.path, { newTab: ev.ctrlKey || ev.button === 1 });
  };
  const drop = async (ev: DragEvent) => {
    ev.preventDefault();
    ev.stopPropagation();
    setOver(false);
    const from = ev.dataTransfer.getData(DRAG_TYPE);
    if (from && e.dir) await movePath(from, join(e.path, basename(from)));
  };

  return (
    <>
      <div
        className={`tree-row${activePath === e.path ? " active" : ""}${over ? " drop" : ""}`}
        style={{ paddingLeft: 10 + depth * 14 }}
        draggable
        onDragStart={(ev) => {
          ev.dataTransfer.setData(DRAG_TYPE, e.path);
          ev.dataTransfer.effectAllowed = "move";
        }}
        onDragOver={(ev) => {
          if (e.dir && ev.dataTransfer.types.includes(DRAG_TYPE)) {
            ev.preventDefault();
            setOver(true);
          }
        }}
        onDragLeave={() => setOver(false)}
        onDrop={drop}
        onClick={click}
        onAuxClick={(ev) => ev.button === 1 && click(ev)}
        onContextMenu={(ev) => {
          ev.preventDefault();
          openMenu(ev.clientX, ev.clientY, menuFor(e));
        }}
        title={e.path}
      >
        <span className="tree-chevron">{e.dir ? open ? <ChevronDown size={13} /> : <ChevronRight size={13} /> : null}</span>
        <span className="tree-icon">{iconFor(e, open)}</span>
        <span className="tree-name">{isNote(e.path) ? title(e.path) : e.name}</span>
        {dirty && <span className="dirty-dot" />}
      </div>
      {e.dir && open && node.children.map((c) => <TreeRow key={c.entry.path} node={c} depth={depth + 1} activePath={activePath} />)}
    </>
  );
});

function FileTree() {
  const files = useStore((s) => s.files);
  const activePath = useStore((s) => s.tabs.find((t) => t.id === s.active)?.path ?? null);
  const tree = useMemo(() => buildTree(files), [files]);
  const [over, setOver] = useState(false);
  return (
    <div className="panel">
      <div className="panel-head">
        <span className="panel-title">{useStore.getState().vault?.name ?? "Dosyalar"}</span>
        <div className="panel-actions">
          <button className="icon-btn" title="Yeni not (Ctrl+N)" onClick={() => newNote()}><FilePlus size={16} /></button>
          <button className="icon-btn" title="Yeni çizim (Ctrl+Shift+N)" onClick={() => newDrawing()}><PenTool size={16} /></button>
          <button className="icon-btn" title="Yeni klasör" onClick={() => newFolder()}><FolderPlus size={16} /></button>
          <button className="icon-btn" title="Tümünü daralt" onClick={() => useStore.setState({ expanded: {} })}><ChevronsDownUp size={16} /></button>
        </div>
      </div>
      <div
        className={`tree${over ? " drop" : ""}`}
        onDragOver={(ev) => {
          if (ev.dataTransfer.types.includes(DRAG_TYPE)) {
            ev.preventDefault();
            setOver(true);
          }
        }}
        onDragLeave={() => setOver(false)}
        onDrop={async (ev) => {
          ev.preventDefault();
          setOver(false);
          const from = ev.dataTransfer.getData(DRAG_TYPE);
          if (from && from.includes("/")) await movePath(from, basename(from));
        }}
        onContextMenu={(ev) => {
          if (ev.target !== ev.currentTarget) return;
          ev.preventDefault();
          openMenu(ev.clientX, ev.clientY, [
            { label: "Yeni not", icon: <FilePlus size={14} />, run: () => newNote("") },
            { label: "Yeni çizim", icon: <PenTool size={14} />, run: () => newDrawing("") },
            { label: "Yeni klasör", icon: <FolderPlus size={14} />, run: () => newFolder("") },
          ]);
        }}
      >
        {tree.map((n) => <TreeRow key={n.entry.path} node={n} depth={0} activePath={activePath} />)}
        {!tree.length && <div className="empty-hint">Kasa boş. Ctrl+N ile ilk notunu oluştur.</div>}
      </div>
    </div>
  );
}

function Highlight({ text, query }: { text: string; query: string }) {
  const terms = query.replace(/^#/, "").split(/\s+/).filter((t) => t.length > 1);
  if (!terms.length) return <>{text}</>;
  const re = new RegExp(`(${terms.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})`, "gi");
  return <>{text.split(re).map((part, i) => (i % 2 ? <mark key={i}>{part}</mark> : part))}</>;
}

function SearchPanel() {
  const query = useStore((s) => s.searchQuery);
  const version = useStore((s) => s.indexVersion);
  useIndex();
  const hits = useMemo(() => searchNotes(query, useStore.getState().notes), [query, version]);
  return (
    <div className="panel">
      <div className="panel-head"><span className="panel-title">Ara</span></div>
      <div className="search-box">
        <input
          id="search-input"
          className="text-input"
          placeholder="Notlarda ara…  (#etiket de yazabilirsin)"
          value={query}
          onChange={(e) => useStore.setState({ searchQuery: e.target.value })}
          onKeyDown={(e) => {
            if (e.key === "Enter" && hits[0]) void openPath(hits[0].path, { line: hits[0].line });
          }}
        />
      </div>
      <div className="results">
        {query.trim() && <div className="results-count">{hits.length} sonuç</div>}
        {hits.map((h) => (
          <div key={h.path} className="result" onClick={(e) => void openPath(h.path, { line: h.line, newTab: e.ctrlKey })}>
            <div className="result-title">{title(h.path)}</div>
            {h.snippet && <div className="result-snippet"><Highlight text={h.snippet} query={query} /></div>}
            {h.path.includes("/") && <div className="result-path">{h.path.slice(0, h.path.lastIndexOf("/"))}</div>}
          </div>
        ))}
      </div>
    </div>
  );
}

function TagsPanel() {
  const idx = useIndex();
  const tags = [...idx.tags.entries()].sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0], "tr"));
  return (
    <div className="panel">
      <div className="panel-head"><span className="panel-title">Etiketler</span></div>
      <div className="tag-list">
        {tags.map(([tag, paths]) => (
          <button key={tag} className="tag-row" onClick={() => openSearch(`#${tag}`)}>
            <span className="tag-name">#{tag}</span>
            <span className="tag-count">{paths.length}</span>
          </button>
        ))}
        {!tags.length && <div className="empty-hint">Henüz etiket yok. Notlarına #etiket yazarak ekleyebilirsin.</div>}
      </div>
    </div>
  );
}

export function Sidebar() {
  const view = useStore((s) => s.leftView);
  return <aside className="sidebar left">{view === "files" ? <FileTree /> : view === "search" ? <SearchPanel /> : <TagsPanel />}</aside>;
}
