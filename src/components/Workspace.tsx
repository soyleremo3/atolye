import { lazy, Suspense, useEffect, useRef, useState, type DragEvent as ReactDragEvent, type PointerEvent as ReactPointerEvent } from "react";
import {
  ArrowLeftToLine, ArrowRightToLine, BookOpen, Braces, CalendarDays, Code2, Columns2, Download, ExternalLink, FilePlus, FileText, Globe,
  Image as ImageIcon, KanbanSquare, MoreHorizontal, Network, PenLine, PenTool, Pencil, SquareSplitHorizontal, Trash2, Wrench, X,
} from "lucide-react";
import { api, vaultUrl, type ViewMode } from "../api";
import { exportNote } from "../lib/exporter";
import { basename, dirname, isBoardNote, title } from "../lib/paths";
import {
  closeTab, closeTabs, deletePath, focusGroup, groupTabs, HTTP_PATH, isDark, isViewPath, moveTabToSide, moveToNewGroup, newDrawing, newNote,
  newSnippet, openBoard, openDaily, openPath, openView, placeTab, renamePath, resizeGroups, equalizeGroups, setActive, setMode, splitTab,
  TOOLS_PATH, useIndex, useStore, type Group, type Side, type Tab,
} from "../store";
import { BoardView } from "./BoardView";
import { HttpView } from "./HttpView";
import { CodeView, SnippetsView } from "./SnippetsView";
import { ToolsView } from "./ToolsView";
import { Editor } from "./Editor";
import { GraphView } from "./GraphView";
import { openMenu, type MenuItem } from "./Overlays";
import { Preview } from "./Preview";
import { DRAG_TYPE as PATH_TYPE } from "./Sidebar";

const DrawingView = lazy(() => import("./DrawingView"));

/** Sekme surukleme verisi (Sidebar'in dosya surukleme turunden ayri). */
const TAB_TYPE = "application/x-atolye-tab";
/** Bir bolme ayiriciyla en fazla bu kadar daraltilabilir (px). */
const MIN_GROUP_WIDTH = 200;

function tabIcon(tab: Tab) {
  if (tab.kind === "graph") return <Network size={14} />;
  if (tab.kind === "drawing") return <PenTool size={14} />;
  if (tab.kind === "image") return <ImageIcon size={14} />;
  if (tab.kind === "code") return <Code2 size={14} />;
  if (tab.kind === "http") return <Globe size={14} />;
  if (tab.kind === "snippets") return <Braces size={14} />;
  if (tab.kind === "tools") return <Wrench size={14} />;
  return <FileText size={14} />;
}

const VIEW_TITLES: Record<string, string> = { graph: "Grafik", snippets: "Kod parçaları", tools: "Araçlar", http: "HTTP istekleri" };
const tabTitle = (t: Tab) => (isViewPath(t.path) ? VIEW_TITLES[t.kind] : t.kind === "note" ? title(t.path) : basename(t.path));
const tabOrder = (t: Tab) => Number(t.id.slice(1));
const template = (sizes: number[]) => sizes.map((s) => `minmax(0, ${s}fr)`).join(" 1px ");

/** Sidebar'dan surukelenen yol bir dosya mi (klasorler bolmede acilmaz)? */
const draggedFile = (e: ReactDragEvent) => {
  const path = e.dataTransfer.getData(PATH_TYPE);
  return path && useStore.getState().files.some((f) => f.path === path && !f.dir) ? path : null;
};

function tabMenu(t: Tab, x: number, y: number) {
  const s = useStore.getState();
  const gi = s.groups.findIndex((g) => g.id === t.group);
  const own = groupTabs(s.tabs, t.group);
  const items: MenuItem[] = [
    { label: "Sağa böl", icon: <Columns2 size={14} />, run: () => splitTab(t.id, "right") },
    { label: "Sola böl", icon: <SquareSplitHorizontal size={14} />, run: () => splitTab(t.id, "left") },
    { label: gi < s.groups.length - 1 ? "Sağdaki bölmeye taşı" : "Yeni bölmeye taşı (sağ)", icon: <ArrowRightToLine size={14} />, run: () => moveTabToSide(t.id, "right") },
  ];
  if (gi > 0) items.push({ label: "Soldaki bölmeye taşı", icon: <ArrowLeftToLine size={14} />, run: () => moveTabToSide(t.id, "left") });
  items.push(
    "sep",
    { label: "Kapat", icon: <X size={14} />, run: () => closeTab(t.id) },
  );
  if (own.length > 1) items.push({ label: "Diğer sekmeleri kapat", run: () => closeTabs(t.group, t.id) });
  items.push({ label: s.groups.length > 1 ? "Bölmeyi kapat" : "Tüm sekmeleri kapat", run: () => closeTabs(t.group) });
  openMenu(x, y, items);
}

function TabBar({ group, focused, multi, col }: { group: Group; focused: boolean; multi: boolean; col: number }) {
  const tabs = useStore((s) => s.tabs);
  const dirty = useStore((s) => s.dirty);
  const own = tabs.filter((t) => t.group === group.id);
  const [hint, setHint] = useState<{ id: string | null; after: boolean } | null>(null);

  const bar = useRef<HTMLDivElement>(null);

  // Etkin sekme dar bolmede tasmissa gorunur yap
  useEffect(() => {
    bar.current?.querySelector(`.tab[data-tab="${group.active}"]`)?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [group.active, group.size]);

  // Surukleme baska yerde biterse ya da iptal edilirse ekleme isaretini kaldir
  useEffect(() => {
    const clear = () => setHint(null);
    window.addEventListener("dragend", clear);
    window.addEventListener("drop", clear);
    return () => {
      window.removeEventListener("dragend", clear);
      window.removeEventListener("drop", clear);
    };
  }, []);

  const dropAt = (e: ReactDragEvent, overId: string | null, after: boolean) => {
    e.preventDefault();
    e.stopPropagation();
    setHint(null);
    const dragId = e.dataTransfer.getData(TAB_TYPE);
    if (dragId) {
      if (dragId === overId) return;
      const list = own.filter((t) => t.id !== dragId);
      const i = overId ? list.findIndex((t) => t.id === overId) : -1;
      placeTab(dragId, group.id, i < 0 ? list.length : i + (after ? 1 : 0));
      return;
    }
    const path = draggedFile(e);
    if (path) void openPath(path, { group: group.id, newTab: true });
  };
  const accepts = (e: ReactDragEvent) => e.dataTransfer.types.includes(TAB_TYPE) || e.dataTransfer.types.includes(PATH_TYPE);

  return (
    <div className={`group-bar${focused && multi ? " focused" : ""}`} style={{ gridColumn: col, gridRow: 1 }} onMouseDownCapture={() => focusGroup(group.id)}>
      <div
        ref={bar}
        className={`tabbar${hint && hint.id === null ? " drop-end" : ""}`}
        onDoubleClick={(e) => e.target === e.currentTarget && newNote()}
        onWheel={(e) => {
          // dikey tekerlek sekmeleri yatay kaydirir
          if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) e.currentTarget.scrollLeft += e.deltaY;
        }}
        onDragOver={(e) => {
          if (!accepts(e)) return;
          e.preventDefault();
          if (e.target === e.currentTarget) setHint({ id: null, after: true });
        }}
        onDragLeave={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setHint(null);
        }}
        onDrop={(e) => dropAt(e, null, true)}
      >
        {own.map((t) => (
          <div
            key={t.id}
            data-tab={t.id}
            className={`tab${t.id === group.active ? " active" : ""}${hint?.id === t.id ? (hint.after ? " drop-after" : " drop-before") : ""}`}
            draggable
            onDragStart={(e) => {
              e.dataTransfer.setData(TAB_TYPE, t.id);
              e.dataTransfer.effectAllowed = "move";
            }}
            onDragOver={(e) => {
              if (!accepts(e)) return;
              e.preventDefault();
              e.stopPropagation();
              const r = e.currentTarget.getBoundingClientRect();
              const after = e.clientX > r.left + r.width / 2;
              if (hint?.id !== t.id || hint.after !== after) setHint({ id: t.id, after });
            }}
            onDrop={(e) => dropAt(e, t.id, !!hint?.after)}
            onMouseDown={(e) => e.button === 0 && setActive(t.id)}
            onAuxClick={(e) => e.button === 1 && closeTab(t.id)}
            onContextMenu={(e) => {
              e.preventDefault();
              tabMenu(t, e.clientX, e.clientY);
            }}
            title={isViewPath(t.path) ? VIEW_TITLES[t.kind] : t.path}
          >
            <span className="tab-icon">{tabIcon(t)}</span>
            <span className="tab-title">{tabTitle(t)}</span>
            {dirty[t.path] ? <span className="dirty-dot" /> : null}
            <button
              className="tab-close"
              title="Kapat (Ctrl+W)"
              onMouseDown={(e) => e.stopPropagation()}
              onClick={(e) => {
                e.stopPropagation();
                closeTab(t.id);
              }}
            >
              <X size={13} />
            </button>
          </div>
        ))}
        <button className="icon-btn new-tab" title="Yeni not (Ctrl+N)" onClick={() => newNote()}>
          <FilePlus size={15} />
        </button>
      </div>
      <div className="group-actions">
        <button className="icon-btn" title="Sağa böl (yan yana aç)" disabled={!group.active} onClick={() => group.active && splitTab(group.active, "right")}>
          <Columns2 size={15} />
        </button>
        {multi && (
          <button className="icon-btn" title="Bölmeyi kapat" onClick={() => closeTabs(group.id)}>
            <X size={15} />
          </button>
        )}
      </div>
    </div>
  );
}

function ModeSwitch({ path }: { path: string }) {
  const board = useStore((s) => isBoardNote(s.notes[path]));
  const mode = useStore((s) => s.modes[path] ?? (board ? "board" : s.settings?.defaultMode ?? "edit"));
  const btn = (m: ViewMode, icon: React.ReactNode, label: string) => (
    <button className={mode === m ? "on" : ""} title={label} onClick={() => setMode(path, m)}>
      {icon}
    </button>
  );
  return (
    <div className="seg small">
      {board && btn("board", <KanbanSquare size={14} />, "Pano")}
      {btn("edit", <PenLine size={14} />, "Düzenle (Ctrl+E)")}
      {btn("split", <Columns2 size={14} />, "Önizlemeyle yan yana (Ctrl+\\)")}
      {btn("read", <BookOpen size={14} />, "Oku (Ctrl+E)")}
    </div>
  );
}

function NoteHeader({ tab, col }: { tab: Tab; col: number }) {
  const folder = dirname(tab.path);
  return (
    <div className="view-header" style={{ gridColumn: col, gridRow: 2 }} onMouseDownCapture={() => focusGroup(tab.group)}>
      <div className="breadcrumb" onDoubleClick={() => renamePath(tab.path)} title="Çift tıkla: yeniden adlandır">
        {folder && <span className="crumb-dir">{folder.replace(/\//g, " / ")} / </span>}
        <span className="crumb-name">{tab.kind === "note" ? title(tab.path) : basename(tab.path)}</span>
      </div>
      <div className="view-actions">
        {tab.kind === "note" && <ModeSwitch path={tab.path} />}
        <button
          className="icon-btn"
          title="Diğer"
          onClick={(e) => {
            const r = e.currentTarget.getBoundingClientRect();
            openMenu(r.left - 150, r.bottom + 4, [
              ...(tab.kind === "note"
                ? [
                    { label: "PDF olarak dışa aktar", icon: <Download size={14} />, run: () => void exportNote(tab.path, "pdf") },
                    { label: "HTML olarak dışa aktar", icon: <Download size={14} />, run: () => void exportNote(tab.path, "html") },
                    "sep" as const,
                  ]
                : []),
              { label: "Sağa böl", icon: <Columns2 size={14} />, run: () => splitTab(tab.id, "right") },
              { label: "Yeniden adlandır", icon: <Pencil size={14} />, run: () => renamePath(tab.path) },
              { label: "Dosya Gezgini'nde göster", icon: <ExternalLink size={14} />, run: () => void api.vault.reveal(tab.path) },
              "sep",
              { label: "Sil", icon: <Trash2 size={14} />, danger: true, run: () => deletePath(tab.path) },
            ]);
          }}
        >
          <MoreHorizontal size={16} />
        </button>
      </div>
    </div>
  );
}

function NoteView({ tab, active }: { tab: Tab; active: boolean }) {
  const content = useStore((s) => s.notes[tab.path]);
  const board = isBoardNote(content);
  const mode = useStore((s) => s.modes[tab.path] ?? (board ? "board" : s.settings?.defaultMode ?? "edit"));
  const spellcheck = useStore((s) => !!s.settings?.spellcheck);
  if (content === undefined) return <div className="empty-state">Not yükleniyor…</div>;
  if (mode === "board" && board) return <BoardView path={tab.path} />;
  return (
    <div className={`note-view mode-${mode}`}>
      {mode !== "read" && <Editor path={tab.path} tabId={tab.id} content={content} active={active} spellcheck={spellcheck} />}
      {mode !== "edit" && <Preview path={tab.path} content={content} />}
    </div>
  );
}

function StatusBar() {
  const tab = useStore((s) => s.tabs.find((t) => t.id === s.active));
  const content = useStore((s) => (tab?.kind === "note" ? s.notes[tab.path] : undefined));
  const dirty = useStore((s) => (tab ? !!s.dirty[tab.path] : false));
  const idx = useIndex();
  if (!tab || tab.kind !== "note" || content === undefined) return <footer className="statusbar" />;
  const words = idx.parsed.get(tab.path)?.words ?? 0;
  const back = new Set((idx.backlinks.get(tab.path) ?? []).map((b) => b.from)).size;
  return (
    <footer className="statusbar">
      <span>{back} geri bağlantı</span>
      <span>{words.toLocaleString("tr")} kelime</span>
      <span>{content.length.toLocaleString("tr")} karakter</span>
      <span>~{Math.max(1, Math.round(words / 200))} dk okuma</span>
      <span className={dirty ? "saving" : "saved"}>{dirty ? "Kaydediliyor…" : "Kaydedildi"}</span>
    </footer>
  );
}

function EmptyState() {
  return (
    <div className="welcome" style={{ gridColumn: 1, gridRow: "2 / 4" }}>
      <div className="welcome-mark">A</div>
      <h2>Atölye</h2>
      <p>Notların, kod parçaların, görevlerin, isteklerin ve araçların tek yerde.</p>
      <div className="welcome-actions">
        <button className="btn primary" onClick={() => newNote()}><FilePlus size={15} /> Yeni not <kbd>Ctrl+N</kbd></button>
        <button className="btn" onClick={() => newSnippet()}><Braces size={15} /> Yeni kod parçası <kbd>Ctrl+Alt+S</kbd></button>
        <button className="btn" onClick={() => void openBoard()}><KanbanSquare size={15} /> Görev panosu <kbd>Ctrl+Alt+B</kbd></button>
        <button className="btn" onClick={() => openView(HTTP_PATH)}><Globe size={15} /> HTTP istekleri <kbd>Ctrl+Alt+H</kbd></button>
        <button className="btn" onClick={() => openView(TOOLS_PATH)}><Wrench size={15} /> Geliştirici araçları <kbd>Ctrl+Alt+A</kbd></button>
        <button className="btn" onClick={() => newDrawing()}><PenTool size={15} /> Yeni çizim / şema <kbd>Ctrl+Shift+N</kbd></button>
        <button className="btn" onClick={() => void openDaily()}><CalendarDays size={15} /> Günlük not <kbd>Ctrl+Alt+D</kbd></button>
      </div>
    </div>
  );
}

/** Iki bolme arasindaki surukleme ayiricisi. Surukleme sirasinda sadece CSS degisir; birakinca kaydedilir. */
function Splitter({ index, col, grid }: { index: number; col: number; grid: React.RefObject<HTMLDivElement | null> }) {
  const [dragging, setDragging] = useState(false);
  const down = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0 || !grid.current) return;
    e.preventDefault();
    const el = grid.current;
    const sizes = useStore.getState().groups.map((g) => g.size);
    const widths = [...el.querySelectorAll<HTMLElement>(":scope > .group-bar")].map((b) => b.getBoundingClientRect().width);
    if (widths.length !== sizes.length) return;
    const a = index;
    const b = index + 1;
    const total = widths[a] + widths[b];
    const sizeTotal = sizes[a] + sizes[b];
    const min = Math.min(MIN_GROUP_WIDTH, total / 2);
    const startX = e.clientX;
    let latest: number[] | null = null;
    const target = e.currentTarget;
    target.setPointerCapture(e.pointerId);
    setDragging(true);
    const move = (ev: PointerEvent) => {
      const wa = Math.min(total - min, Math.max(min, widths[a] + ev.clientX - startX));
      const next = [...sizes];
      next[a] = (sizeTotal * wa) / total;
      next[b] = sizeTotal - next[a];
      latest = next;
      el.style.gridTemplateColumns = template(next);
    };
    const up = () => {
      target.removeEventListener("pointermove", move);
      target.removeEventListener("pointerup", up);
      target.removeEventListener("pointercancel", up);
      setDragging(false);
      if (latest) resizeGroups(latest);
    };
    target.addEventListener("pointermove", move);
    target.addEventListener("pointerup", up);
    target.addEventListener("pointercancel", up);
  };
  return (
    <div
      className={`group-splitter${dragging ? " dragging" : ""}`}
      style={{ gridColumn: col, gridRow: "1 / 4" }}
      title="Sürükle: genişliği değiştir · Çift tıkla: eşitle"
      onPointerDown={down}
      onDoubleClick={equalizeGroups}
    />
  );
}

/** Sekme ya da dosya suruklenirken bolmenin uzerinde cikan birakma alani: sol / orta / sag. */
function DropZone({ group, col, kind }: { group: Group; col: number; kind: "tab" | "file" }) {
  const [zone, setZone] = useState<"left" | "center" | "right" | null>(null);
  const zoneOf = (e: ReactDragEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const x = (e.clientX - r.left) / r.width;
    return x < 0.25 ? "left" : x > 0.75 ? "right" : "center";
  };
  return (
    <div
      className="drop-zone"
      style={{ gridColumn: col, gridRow: "2 / 4" }}
      onDragOver={(e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = kind === "tab" ? "move" : "copy";
        const z = zoneOf(e);
        if (z !== zone) setZone(z);
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setZone(null);
      }}
      onDrop={(e) => {
        e.preventDefault();
        const z = zoneOf(e);
        setZone(null);
        const side: Side | null = z === "center" ? null : z;
        const tabId = e.dataTransfer.getData(TAB_TYPE);
        if (tabId) {
          const own = groupTabs(useStore.getState().tabs, group.id);
          if (side) moveToNewGroup(tabId, group.id, side);
          else if (!own.some((t) => t.id === tabId)) placeTab(tabId, group.id, own.length);
          return;
        }
        const path = draggedFile(e);
        if (path) void openPath(path, side ? { group: group.id, side } : { group: group.id, newTab: true });
      }}
    >
      {zone && <div className={`drop-hint ${zone}`}>{zone === "center" ? "Bu bölmede aç" : zone === "left" ? "Sola böl" : "Sağa böl"}</div>}
    </div>
  );
}

export function Workspace() {
  const tabs = useStore((s) => s.tabs);
  const groups = useStore((s) => s.groups);
  const activeGroup = useStore((s) => s.activeGroup);
  const active = useStore((s) => s.active);
  const dark = useStore(isDark);
  const grid = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<"tab" | "file" | null>(null);
  const multi = groups.length > 1;
  const colOf = new Map(groups.map((g, i) => [g.id, i * 2 + 1]));
  const byId = new Map(tabs.map((t) => [t.id, t]));
  const headerTab = new Map(groups.map((g) => [g.id, byId.get(g.active ?? "")]));
  const hasHeader = (g: string) => {
    const t = headerTab.get(g);
    return !!t && !isViewPath(t.path);
  };
  const sizes = groups.map((g) => g.size).join(",");

  // Sekme ya da dosya surukleme baslayinca birakma alanlarini goster
  useEffect(() => {
    const kind = (e: DragEvent) => (e.dataTransfer?.types.includes(TAB_TYPE) ? "tab" : e.dataTransfer?.types.includes(PATH_TYPE) ? "file" : null);
    const enter = (e: DragEvent) => {
      const k = kind(e);
      if (k) setDrag(k);
    };
    const end = () => setDrag(null);
    window.addEventListener("dragenter", enter);
    window.addEventListener("dragend", end);
    window.addEventListener("drop", end);
    return () => {
      window.removeEventListener("dragenter", enter);
      window.removeEventListener("dragend", end);
      window.removeEventListener("drop", end);
    };
  }, []);

  // Bolme sayisi ya da genislikleri degisince cizim/grafik gibi gorunumler yeniden olcsun
  useEffect(() => {
    const id = window.setTimeout(() => window.dispatchEvent(new Event("resize")), 40);
    return () => window.clearTimeout(id);
  }, [groups.length, sizes]);

  // Klavyeyle (Ctrl+1..6, sekme degisimi) baska bolmeye gecilince yazma odagini da oraya tasi
  useEffect(() => {
    if (!active) return;
    const el = grid.current?.querySelector<HTMLElement>(`:scope > .view[data-tab="${active}"]`);
    if (!el || el.contains(document.activeElement)) return;
    el.querySelector<HTMLElement>(".cm-content")?.focus();
  }, [active]);

  return (
    <main className="workspace">
      <div
        ref={grid}
        className={`groups${multi ? " multi" : ""}`}
        style={{ gridTemplateColumns: template(groups.map((g) => g.size)) }}
      >
        {groups.map((g) => (
          <TabBar key={g.id} group={g} focused={g.id === activeGroup} multi={multi} col={colOf.get(g.id)!} />
        ))}
        {groups.map((g) => {
          const t = headerTab.get(g.id);
          return t && hasHeader(g.id) ? <NoteHeader key={`h${g.id}`} tab={t} col={colOf.get(g.id)!} /> : null;
        })}
        {groups.slice(1).map((g, i) => (
          <Splitter key={`s${g.id}`} index={i} col={colOf.get(g.id)! - 1} grid={grid} />
        ))}
        {!tabs.length && <EmptyState />}
        {[...tabs]
          .sort((a, b) => tabOrder(a) - tabOrder(b))
          .map((t) => {
            const group = groups.find((g) => g.id === t.group);
            const visible = group?.active === t.id;
            const focused = visible && t.group === activeGroup;
            return (
              <div
                key={t.id}
                data-tab={t.id}
                className="view"
                style={{ display: visible ? "flex" : "none", gridColumn: colOf.get(t.group), gridRow: hasHeader(t.group) ? 3 : "2 / 4" }}
                onMouseDownCapture={() => focusGroup(t.group)}
              >
                {t.kind === "note" && <NoteView tab={t} active={focused} />}
                {t.kind === "drawing" && (
                  <Suspense fallback={<div className="empty-state">Çizim aracı yükleniyor…</div>}>
                    <DrawingView path={t.path} dark={dark} active={visible} />
                  </Suspense>
                )}
                {t.kind === "image" && (
                  <div className="image-view">
                    <img src={vaultUrl(t.path)} alt={basename(t.path)} />
                  </div>
                )}
                {t.kind === "graph" && <GraphView active={visible} />}
                {t.kind === "code" && <CodeView path={t.path} />}
                {t.kind === "snippets" && <SnippetsView />}
                {t.kind === "tools" && <ToolsView />}
                {t.kind === "http" && <HttpView />}
              </div>
            );
          })}
        {drag && groups.map((g) => <DropZone key={`d${g.id}`} group={g} col={colOf.get(g.id)!} kind={drag} />)}
      </div>
      <StatusBar />
    </main>
  );
}
