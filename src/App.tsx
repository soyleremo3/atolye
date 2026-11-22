import { useEffect } from "react";
import {
  ArrowLeft, ArrowRight, Braces, CalendarDays, Command, Files, FolderOpen, Globe, Hash, KanbanSquare, Network, PanelLeft, PanelRight,
  PenTool, Search, Settings, Wrench, Bot, NotebookPen, SquareTerminal,
} from "lucide-react";
import { api } from "./api";
import { handleGlobalKey } from "./lib/commands";
import { isBoardNote } from "./lib/paths";
import {
  AGENTS_PATH, ASSISTANT_PATH, HTTP_PATH, isDark, navigate, newDrawing, openBoard, openDaily, openGraph, openSearch, openView, SNIPPETS_PATH, toggleLeft, toggleRight,
  TOOLS_PATH, useStore,
} from "./store";
import { Overlays } from "./components/Overlays";
import { RightPanel } from "./components/RightPanel";
import { Sidebar } from "./components/Sidebar";
import { Workspace } from "./components/Workspace";
import { toggleTerminal } from "./lib/terminalState";

// Agir gorunumler fare dugmenin uzerine gelince indirilmeye baslar: tiklayinca beklemeden acilir.
const once = (load: () => Promise<unknown>) => {
  let done = false;
  return () => {
    if (!done) {
      done = true;
      void load();
    }
  };
};
const prefetch = {
  agents: once(() => import("./components/AgentsView")),
  terminal: once(() => import("./components/TerminalPanel")),
  graph: once(() => import("./components/GraphView")),
  drawing: once(() => import("./components/DrawingView")),
};

function TitleBar() {
  const vault = useStore((s) => s.vault);
  const leftOpen = useStore((s) => s.leftOpen);
  const rightOpen = useStore((s) => s.rightOpen);
  return (
    <header className="titlebar">
      <div className="titlebar-left">
        <span className="app-mark">A</span>
        <button className={`icon-btn${leftOpen ? " on" : ""}`} title="Sol panel (Ctrl+Shift+B)" onClick={() => toggleLeft()}><PanelLeft size={16} /></button>
        <button className="icon-btn" title="Geri (Alt+←)" onClick={() => navigate(-1)}><ArrowLeft size={16} /></button>
        <button className="icon-btn" title="İleri (Alt+→)" onClick={() => navigate(1)}><ArrowRight size={16} /></button>
      </div>
      <button className="title-search" onClick={() => useStore.setState({ overlay: "switcher" })}>
        <Search size={14} />
        <span>{vault?.name ?? "Atölye"} içinde ara veya aç</span>
        <kbd>Ctrl+O</kbd>
      </button>
      <div className="titlebar-right">
        <button className={`icon-btn${rightOpen ? " on" : ""}`} title="Sağ panel (Ctrl+Shift+R)" onClick={toggleRight}><PanelRight size={16} /></button>
      </div>
    </header>
  );
}

function AgentsButton() {
  const pending = useStore((s) => s.agentsPending);
  return (
    <button className="icon-btn ribbon-badge-host" title="Ajanlar (Ctrl+Alt+J)" onMouseEnter={prefetch.agents} onClick={() => openView(AGENTS_PATH)}>
      <Bot size={18} />
      {pending > 0 && <span className="ribbon-badge">{pending}</span>}
    </button>
  );
}

function Ribbon() {
  const leftView = useStore((s) => s.leftView);
  const leftOpen = useStore((s) => s.leftOpen);
  const on = (v: string) => (leftOpen && leftView === v ? " on" : "");
  return (
    <nav className="ribbon">
      <button className={`icon-btn${on("files")}`} title="Dosyalar" onClick={() => toggleLeft("files")}><Files size={18} /></button>
      <button className={`icon-btn${on("search")}`} title="Ara (Ctrl+Shift+F)" onClick={() => (leftOpen && leftView === "search" ? toggleLeft() : openSearch())}><Search size={18} /></button>
      <button className={`icon-btn${on("tags")}`} title="Etiketler" onClick={() => toggleLeft("tags")}><Hash size={18} /></button>
      <div className="ribbon-sep" />
      <button className="icon-btn" title="Kod parçaları (Ctrl+Alt+S)" onClick={() => openView(SNIPPETS_PATH)}><Braces size={18} /></button>
      <button className="icon-btn" title="Görev panosu (Ctrl+Alt+B)" onClick={() => void openBoard()}><KanbanSquare size={18} /></button>
      <button className="icon-btn" title="HTTP istekleri (Ctrl+Alt+H)" onClick={() => openView(HTTP_PATH)}><Globe size={18} /></button>
      <button className="icon-btn" title="Geliştirici araçları (Ctrl+Alt+A)" onClick={() => openView(TOOLS_PATH)}><Wrench size={18} /></button>
      <AgentsButton />
      <button className="icon-btn" title="Not Asistanı (Ctrl+Alt+K)" onClick={() => openView(ASSISTANT_PATH)}><NotebookPen size={18} /></button>
      <button className="icon-btn" title="Terminal (Ctrl+J)" onMouseEnter={prefetch.terminal} onClick={() => toggleTerminal()}><SquareTerminal size={18} /></button>
      <div className="ribbon-sep" />
      <button className="icon-btn" title="Grafik (Ctrl+Shift+G)" onMouseEnter={prefetch.graph} onClick={openGraph}><Network size={18} /></button>
      <button className="icon-btn" title="Günlük not (Ctrl+Alt+D)" onClick={() => void openDaily()}><CalendarDays size={18} /></button>
      <button className="icon-btn" title="Yeni çizim (Ctrl+Shift+N)" onMouseEnter={prefetch.drawing} onClick={() => newDrawing()}><PenTool size={18} /></button>
      <button className="icon-btn" title="Komut paleti (Ctrl+P)" onClick={() => useStore.setState({ overlay: "commands" })}><Command size={18} /></button>
      <div className="ribbon-fill" />
      <button className="icon-btn" title="Kasa klasörünü aç" onClick={() => void api.vault.openFolder()}><FolderOpen size={18} /></button>
      <button className="icon-btn" title="Ayarlar (Ctrl+,)" onClick={() => useStore.setState({ dialog: { type: "settings" } })}><Settings size={18} /></button>
    </nav>
  );
}

export function App() {
  const ready = useStore((s) => s.ready);
  const error = useStore((s) => s.error);
  const settings = useStore((s) => s.settings);
  const dark = useStore(isDark);
  const leftOpen = useStore((s) => s.leftOpen);
  const rightOpen = useStore((s) => s.rightOpen);
  const noteActive = useStore((s) => {
    const t = s.tabs.find((x) => x.id === s.active);
    return t?.kind === "note" && (s.modes[t.path] ?? (isBoardNote(s.notes[t.path]) ? "board" : "edit")) !== "board";
  });

  useEffect(() => {
    window.addEventListener("keydown", handleGlobalKey);
    return () => window.removeEventListener("keydown", handleGlobalKey);
  }, []);

  const palette = useStore((s) => s.settings?.palette ?? "kum");
  const accent = useStore((s) => s.settings?.accent ?? "");
  useEffect(() => {
    const root = document.documentElement;
    root.dataset.palette = palette;
    // istege bagli vurgu rengi: temanin vurgu degiskenlerini ezer
    const vars = ["--accent", "--accent-strong", "--accent-soft", "--selection", "--selection-match", "--tag-bg", "--tag-text"];
    if (/^#[0-9a-f]{6}$/i.test(accent)) {
      const n = parseInt(accent.slice(1), 16);
      const rgb = `${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}`;
      const vals = [accent, accent, `rgba(${rgb}, 0.3)`, `rgba(${rgb}, 0.2)`, `rgba(${rgb}, 0.1)`, `rgba(${rgb}, 0.12)`, accent];
      vars.forEach((v, i) => root.style.setProperty(v, vals[i]));
    } else {
      vars.forEach((v) => root.style.removeProperty(v));
    }
    const css = getComputedStyle(root);
    void api.settings.setTitlebar(css.getPropertyValue("--bg-2").trim() || "#1b1d23", css.getPropertyValue("--muted").trim() || "#c0c4cc");
  }, [palette, accent, dark]);

  useEffect(() => {
    document.documentElement.dataset.theme = dark ? "dark" : "light";
    const css = getComputedStyle(document.documentElement);
    void api.settings.setTitlebar(css.getPropertyValue("--bg-2").trim() || "#1b1d23", css.getPropertyValue("--muted").trim() || "#c0c4cc");
  }, [dark]);

  useEffect(() => {
    if (!settings) return;
    const root = document.documentElement.style;
    root.setProperty("--editor-size", `${settings.fontSize}px`);
    root.setProperty("--editor-font", settings.editorFont === "mono" ? "var(--mono)" : "var(--ui-font)");
    root.setProperty("--line-width", settings.readableWidth ? "760px" : "none");
  }, [settings]);

  if (error) return <div className="fatal">Atölye açılamadı: {error}</div>;
  if (!ready) return <div className="splash"><span className="app-mark big">D</span></div>;
  return (
    <div className={`app${leftOpen ? " left-open" : ""}${rightOpen ? " right-open" : ""}`}>
      <TitleBar />
      <div className="body">
        <Ribbon />
        {leftOpen && <Sidebar />}
        <Workspace />
        {rightOpen && noteActive && <RightPanel />}
      </div>
      <Overlays />
    </div>
  );
}
