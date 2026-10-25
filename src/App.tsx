import { useEffect } from "react";
import {
  ArrowLeft, ArrowRight, Braces, CalendarDays, Command, Files, FolderOpen, Globe, Hash, KanbanSquare, Network, PanelLeft, PanelRight,
  PenTool, Search, Settings, Wrench,
} from "lucide-react";
import { api } from "./api";
import { handleGlobalKey } from "./lib/commands";
import { isBoardNote } from "./lib/paths";
import {
  HTTP_PATH, isDark, navigate, newDrawing, openBoard, openDaily, openGraph, openSearch, openView, SNIPPETS_PATH, toggleLeft, toggleRight,
  TOOLS_PATH, useStore,
} from "./store";
import { Overlays } from "./components/Overlays";
import { RightPanel } from "./components/RightPanel";
import { Sidebar } from "./components/Sidebar";
import { Workspace } from "./components/Workspace";

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
      <div className="ribbon-sep" />
      <button className="icon-btn" title="Grafik (Ctrl+Shift+G)" onClick={openGraph}><Network size={18} /></button>
      <button className="icon-btn" title="Günlük not (Ctrl+Alt+D)" onClick={() => void openDaily()}><CalendarDays size={18} /></button>
      <button className="icon-btn" title="Yeni çizim (Ctrl+Shift+N)" onClick={() => newDrawing()}><PenTool size={18} /></button>
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
