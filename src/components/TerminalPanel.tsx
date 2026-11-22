/**
 * Alt panel terminal (VS Code gibi): sekmeler, profil menusu (PowerShell, Claude Code, Antigravity, Codex,
 * Git Bash, Komut Istemi), klasor secimi, yeniden boyutlandirma. Panel gizlenince oturumlar yasamaya devam eder.
 */
import { useEffect, useRef, useState } from "react";
import { create } from "zustand";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";
import { Bot, Check, ChevronDown, Folder, FolderPlus, Plus, SquareTerminal, Trash2, X } from "lucide-react";
import { api, type TermDir, type TermProfile } from "../api";
import { toast } from "../store";

const LS_OPEN = "atolye.term.open";
const LS_HEIGHT = "atolye.term.height";
const LS_DIR = "atolye.term.dir";
const ls = {
  get: (k: string) => {
    try {
      return localStorage.getItem(k);
    } catch {
      return null;
    }
  },
  set: (k: string, v: string) => {
    try {
      localStorage.setItem(k, v);
    } catch {
      /* yok sayilir */
    }
  },
};

export const useTerminal = create<{ open: boolean }>(() => ({ open: ls.get(LS_OPEN) === "1" }));
export function toggleTerminal(force?: boolean): void {
  const open = force ?? !useTerminal.getState().open;
  useTerminal.setState({ open });
  ls.set(LS_OPEN, open ? "1" : "0");
}

type Tab = { id: number; title: string; profile: string; exited: boolean };
type Session = { term: Terminal; fit: FitAddon; el: HTMLDivElement };

function themeFromCss() {
  const css = getComputedStyle(document.documentElement);
  const v = (n: string, d: string) => css.getPropertyValue(n).trim() || d;
  return {
    background: v("--bg-2", "#18191d"),
    foreground: v("--text", "#dcdee4"),
    cursor: v("--accent", "#2dd4bf"),
    selectionBackground: v("--accent-soft", "rgba(45,212,191,0.35)"),
  };
}

/** Sekme basligi icin kisa klasor adi: "version6", "Atolye", "Kasa". */
function shortName(d: TermDir): string {
  const m = /^Uygulama \((.*)\)$/.exec(d.name);
  if (m) return m[1];
  return d.name.split("  ·  ")[0].replace(/ \(.*\)$/, "");
}

export function TerminalPanel() {
  const open = useTerminal((s) => s.open);
  const [tabs, setTabs] = useState<Tab[]>([]);
  const [active, setActive] = useState<number | null>(null);
  const [profiles, setProfiles] = useState<TermProfile[]>([]);
  const [dirs, setDirs] = useState<TermDir[]>([]);
  const [dir, setDirState] = useState<string>(ls.get(LS_DIR) ?? "app");
  const [projMenu, setProjMenu] = useState(false);
  const setDir = (id: string) => {
    setDirState(id);
    ls.set(LS_DIR, id);
  };
  // kayitli secim listede yoksa (silinmis klasor) uygulama reposu, o da yoksa ilk klasor
  const curDir = dirs.find((d) => d.id === dir) ?? dirs.find((d) => d.id === "app") ?? dirs[0];
  const [projQuery, setProjQuery] = useState("");
  const q = projQuery.trim().toLocaleLowerCase("tr");
  const shown = q ? dirs.filter((d) => `${d.name} ${d.path}`.toLocaleLowerCase("tr").includes(q)) : dirs;
  const [menu, setMenu] = useState(false);
  const [height, setHeight] = useState(() => Number(ls.get(LS_HEIGHT)) || 280);
  const sessions = useRef(new Map<number, Session>());
  const host = useRef<HTMLDivElement>(null);
  const started = useRef(false);

  useEffect(() => {
    void api.term.profiles().then(setProfiles);
    void api.term.dirs().then(setDirs);
    const offData = api.term.onData((id, data) => sessions.current.get(id)?.term.write(data));
    const offExit = api.term.onExit((id) => {
      sessions.current.get(id)?.term.write("\r\n\x1b[2m[işlem bitti — sekmeyi kapatabilirsin]\x1b[0m\r\n");
      setTabs((t) => t.map((x) => (x.id === id ? { ...x, exited: true } : x)));
    });
    return () => {
      offData();
      offExit();
    };
  }, []);

  const newTab = async (profile: string, dirId?: string) => {
    setMenu(false);
    setProjMenu(false);
    const target = (dirId ? dirs.find((d) => d.id === dirId) : null) ?? curDir;
    const cwd = target?.path ?? "";
    const term = new Terminal({ fontFamily: '"Cascadia Code", "Cascadia Mono", Consolas, monospace', fontSize: 13, cursorBlink: true, theme: themeFromCss(), allowProposedApi: false, scrollback: 5000 });
    const fit = new FitAddon();
    term.loadAddon(fit);
    const el = document.createElement("div");
    el.className = "term-view";
    host.current?.appendChild(el);
    term.open(el);
    try {
      fit.fit();
    } catch {
      /* gizliyken olcu yok */
    }
    let id: number;
    try {
      id = await api.term.create(profile, cwd, term.cols, term.rows);
    } catch (e) {
      term.dispose();
      el.remove();
      toast(String((e as Error).message || e).replace(/^Error invoking remote method '[^']+': (Error: )?/, ""), "error");
      return;
    }
    term.onData((d) => void api.term.write(id, d));
    term.onResize(({ cols, rows }) => void api.term.resize(id, cols, rows));
    // Ctrl+C secili metni kopyalar, secim yoksa isleme gider; Ctrl+V yapistirir
    term.attachCustomKeyEventHandler((e) => {
      if (e.type !== "keydown") return true;
      if (e.ctrlKey && e.key.toLowerCase() === "c" && term.hasSelection()) {
        void navigator.clipboard.writeText(term.getSelection());
        return false;
      }
      if (e.ctrlKey && e.key.toLowerCase() === "v") {
        void navigator.clipboard.readText().then((t) => void api.term.write(id, t));
        return false;
      }
      if (e.ctrlKey && e.key.toLowerCase() === "j") return false; // panel kisayolu
      return true;
    });
    sessions.current.set(id, { term, fit, el });
    const name = profiles.find((p) => p.id === profile)?.name ?? profile;
    const where = target ? shortName(target) : "";
    setTabs((t) => [...t, { id, title: where ? `${name} · ${where}` : name, profile, exited: false }]);
    setActive(id);
  };

  const closeTab = (id: number) => {
    void api.term.kill(id);
    const s = sessions.current.get(id);
    s?.term.dispose();
    s?.el.remove();
    sessions.current.delete(id);
    setTabs((t) => {
      const rest = t.filter((x) => x.id !== id);
      if (active === id) setActive(rest.at(-1)?.id ?? null);
      return rest;
    });
  };

  // ilk acilista bir PowerShell
  useEffect(() => {
    if (open && !started.current && profiles.length && dirs.length) {
      started.current = true;
      if (!tabs.length) void newTab("powershell");
    }
  });

  // aktif sekme gorunsun, olcusu tutsun
  useEffect(() => {
    for (const [id, s] of sessions.current) s.el.style.display = id === active ? "" : "none";
    const s = active != null ? sessions.current.get(active) : null;
    if (s && open) {
      requestAnimationFrame(() => {
        try {
          s.fit.fit();
          s.term.focus();
        } catch {
          /* olcu yok */
        }
      });
    }
  }, [active, open, height]);

  useEffect(() => {
    const el = host.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      const s = active != null ? sessions.current.get(active) : null;
      try {
        s?.fit.fit();
      } catch {
        /* yok */
      }
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [active]);

  // tema degisince renkleri guncelle
  useEffect(() => {
    const mo = new MutationObserver(() => {
      const theme = themeFromCss();
      for (const s of sessions.current.values()) s.term.options.theme = theme;
    });
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme", "data-palette", "style"] });
    return () => mo.disconnect();
  }, []);

  const startDrag = (e: React.MouseEvent) => {
    e.preventDefault();
    const y0 = e.clientY;
    const h0 = height;
    const move = (ev: MouseEvent) => setHeight(Math.max(120, Math.min(window.innerHeight - 160, h0 + (y0 - ev.clientY))));
    const up = () => {
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
      setHeight((h) => {
        ls.set(LS_HEIGHT, String(h));
        return h;
      });
    };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
  };

  return (
    <section className="term-panel" style={{ height, display: open ? undefined : "none" }}>
      <div className="term-drag" onMouseDown={startDrag} />
      <header className="term-head">
        <span className="term-label"><SquareTerminal size={14} /> Terminal</span>
        <div className="term-tabs">
          {tabs.map((t) => (
            <button key={t.id} className={`term-tab${t.id === active ? " on" : ""}${t.exited ? " exited" : ""}`} onClick={() => setActive(t.id)} title={t.title}>
              {t.title}
              <span className="term-tab-x" onClick={(e) => { e.stopPropagation(); closeTab(t.id); }}><X size={12} /></span>
            </button>
          ))}
        </div>
        <div className="term-new">
          <button className="icon-btn" title="Yeni PowerShell" onClick={() => void newTab("powershell")}><Plus size={15} /></button>
          <button className="icon-btn" title="Terminal türü seç" onClick={() => { setMenu(!menu); setProjMenu(false); }}><ChevronDown size={15} /></button>
          {menu && (
            <div className="term-menu" onMouseLeave={() => setMenu(false)}>
              {profiles.map((p) => (
                <button key={p.id} disabled={!p.available} onClick={() => void newTab(p.id)} title={p.available ? "" : "Bu bilgisayarda kurulu değil"}>
                  {p.name}{!p.available && <em> (kurulu değil)</em>}
                </button>
              ))}
            </div>
          )}
        </div>
        <div className="term-proj">
          <button className="term-proj-btn" title={curDir ? `Yeni terminaller burada açılır: ${curDir.path}` : "Klasör"} onClick={() => { setProjMenu(!projMenu); setProjQuery(""); setMenu(false); }}>
            <Folder size={13} /> <span>{curDir?.name ?? "Klasör"}</span> <ChevronDown size={13} />
          </button>
          {projMenu && (
            <div
              className="term-menu term-proj-menu"
              style={{ maxHeight: Math.max(220, (host.current?.parentElement?.getBoundingClientRect().top ?? 600) - 60) }}
              onMouseLeave={() => setProjMenu(false)}
            >
              <input
                className="text-input term-proj-search"
                autoFocus
                placeholder="Proje ara… (Enter: ilkini seç)"
                value={projQuery}
                onChange={(e) => setProjQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Escape") setProjMenu(false);
                  if (e.key === "Enter" && shown[0]) {
                    setDir(shown[0].id);
                    setProjMenu(false);
                  }
                }}
              />
              {[...new Set(shown.map((d) => d.group))].map((g) => (
                <div key={g}>
                  <div className="term-proj-head">{g}</div>
                  {shown.filter((d) => d.group === g).map((d) => (
                    <div key={d.id} className={`term-proj-row${d.id === curDir?.id ? " on" : ""}`}>
                      <button className="term-proj-pick" title={d.path} onClick={() => { setDir(d.id); setProjMenu(false); }}>
                        <span className="term-proj-check">{d.id === curDir?.id && <Check size={13} />}</span>
                        <span className="term-proj-name">{d.name}</span>
                      </button>
                      <button className="icon-btn" title="Burada PowerShell aç" onClick={() => { setDir(d.id); void newTab("powershell", d.id); }}><SquareTerminal size={13} /></button>
                      {profiles.find((p) => p.id === "claude")?.available && (
                        <button className="icon-btn" title="Burada Claude Code aç" onClick={() => { setDir(d.id); void newTab("claude", d.id); }}><Bot size={13} /></button>
                      )}
                      {d.removable && (
                        <button className="icon-btn" title="Listeden çıkar (klasör silinmez)" onClick={() => void api.term.removeDir(d.path).then(setDirs)}><X size={12} /></button>
                      )}
                    </div>
                  ))}
                </div>
              ))}
              <button className="term-proj-add" onClick={() => void api.term.addDir().then((r) => { setDirs(r.dirs); if (r.added) setDir(r.added); setProjMenu(false); })}>
                <FolderPlus size={13} /> Klasör ekle…
              </button>
            </div>
          )}
        </div>
        {active != null && <button className="icon-btn" title="Bu terminali kapat" onClick={() => closeTab(active)}><Trash2 size={14} /></button>}
        <button className="icon-btn" title="Paneli gizle (Ctrl+J) — terminaller çalışmaya devam eder" onClick={() => toggleTerminal(false)}><X size={15} /></button>
      </header>
      <div className="term-host" ref={host}>
        {!tabs.length && <div className="term-empty">Terminal yok. + ile PowerShell, ▾ ile Claude Code, Antigravity ya da Codex aç.</div>}
      </div>
    </section>
  );
}
