/** Kalici olmayan katmanlar: sag tik menusu, diyaloglar, komut paleti, hizli acma, bildirim. */
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { create } from "zustand";
import { Code2, File, FileText, Globe, Image as ImageIcon, PenTool } from "lucide-react";
import { api } from "../api";
import { COMMANDS } from "../lib/commands";
import { fuzzyFilter } from "../lib/fuzzy";
import { dirname, isCode, isDrawing, isHttp, isImage, isNote, join, sanitizeName, title } from "../lib/paths";
import { changeVault, createNote, currentFolder, newFromTemplate, openPath, templates, updateSettings, useStore } from "../store";

// ------------------------------------------------------------------ sag tik menusu
export type MenuItem = { label: string; icon?: ReactNode; danger?: boolean; run: () => void } | "sep";
const useMenu = create<{ x: number; y: number; items: MenuItem[] } | null>(() => null);
export const openMenu = (x: number, y: number, items: MenuItem[]) => useMenu.setState({ x, y, items }, true);

function ContextMenu() {
  const menu = useMenu();
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ x: 0, y: 0 });
  useEffect(() => {
    if (!menu) return;
    const close = () => useMenu.setState(null, true);
    const el = ref.current;
    const w = el?.offsetWidth ?? 200;
    const h = el?.offsetHeight ?? 200;
    setPos({ x: Math.min(menu.x, window.innerWidth - w - 8), y: Math.min(menu.y, window.innerHeight - h - 8) });
    window.addEventListener("mousedown", close);
    window.addEventListener("blur", close);
    window.addEventListener("keydown", close);
    return () => {
      window.removeEventListener("mousedown", close);
      window.removeEventListener("blur", close);
      window.removeEventListener("keydown", close);
    };
  }, [menu]);
  if (!menu) return null;
  return (
    <div ref={ref} className="context-menu" style={{ left: pos.x || menu.x, top: pos.y || menu.y }} onMouseDown={(e) => e.stopPropagation()}>
      {menu.items.map((it, i) =>
        it === "sep" ? (
          <div key={i} className="menu-sep" />
        ) : (
          <button
            key={i}
            className={`menu-item${it.danger ? " danger" : ""}`}
            onClick={() => {
              useMenu.setState(null, true);
              it.run();
            }}
          >
            <span className="menu-icon">{it.icon}</span>
            {it.label}
          </button>
        ),
      )}
    </div>
  );
}

// ------------------------------------------------------------------ palet (komutlar / hizli acma / sablonlar)
type Row = { key: string; label: string; hint?: string; icon?: ReactNode; run: (e: { ctrl: boolean; shift: boolean }) => void };

function fileIcon(path: string) {
  if (isNote(path)) return <FileText size={15} />;
  if (isDrawing(path)) return <PenTool size={15} />;
  if (isImage(path)) return <ImageIcon size={15} />;
  if (isHttp(path)) return <Globe size={15} />;
  if (isCode(path)) return <Code2 size={15} />;
  return <File size={15} />;
}

function Palette() {
  const overlay = useStore((s) => s.overlay);
  const files = useStore((s) => s.files);
  const [query, setQuery] = useState("");
  const [sel, setSel] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);
  const close = () => useStore.setState({ overlay: null });

  useEffect(() => {
    setQuery("");
    setSel(0);
  }, [overlay]);

  const rows: Row[] = useMemo(() => {
    if (overlay === "commands") {
      const cmds = COMMANDS.filter((c) => !c.when || c.when());
      return fuzzyFilter(query, cmds, (c) => c.title, 80).map((c) => ({ key: c.id, label: c.title, hint: c.keys, run: c.run }));
    }
    if (overlay === "templates") {
      return fuzzyFilter(query, templates(), (p) => title(p)).map((p) => ({
        key: p, label: title(p), icon: <FileText size={15} />, run: () => newFromTemplate(p),
      }));
    }
    if (overlay === "switcher") {
      const list = files
        .filter((f) => !f.dir && (isNote(f.path) || isDrawing(f.path) || isImage(f.path) || isCode(f.path) || isHttp(f.path)))
        .sort((a, b) => b.mtime - a.mtime);
      const hits = fuzzyFilter(query, list, (f) => (isNote(f.path) ? f.path.slice(0, -3) : f.path), 60).map<Row>((f) => ({
        key: f.path,
        label: isNote(f.path) ? title(f.path) : f.name,
        hint: dirname(f.path),
        icon: fileIcon(f.path),
        run: ({ ctrl }) => void openPath(f.path, { newTab: ctrl }),
      }));
      const name = sanitizeName(query);
      if (name && !list.some((f) => title(f.path).toLowerCase() === name.toLowerCase())) {
        hits.push({
          key: "::create", label: `“${name}” notunu oluştur`, hint: "Shift+Enter", icon: <FileText size={15} />,
          run: () => void createNote(join(currentFolder(), `${name}.md`), `# ${name}\n\n`),
        });
      }
      return hits;
    }
    return [];
  }, [overlay, query, files]);

  useEffect(() => {
    listRef.current?.querySelector(".palette-row.selected")?.scrollIntoView({ block: "nearest" });
  }, [sel]);

  if (!overlay) return null;
  const placeholder = overlay === "commands" ? "Komut ara…" : overlay === "templates" ? "Şablon seç…" : "Not, kod, istek veya çizim ara…  (Enter aç · Ctrl+Enter yeni sekme)";
  const run = (row: Row | undefined, e: { ctrl: boolean; shift: boolean }) => {
    if (!row) return;
    close();
    row.run(e);
  };
  return (
    <div className="modal-backdrop top" onMouseDown={close}>
      <div className="palette" onMouseDown={(e) => e.stopPropagation()}>
        <input
          autoFocus
          className="palette-input"
          placeholder={placeholder}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setSel(0);
          }}
          onKeyDown={(e) => {
            if (e.key === "Escape") close();
            else if (e.key === "ArrowDown") {
              e.preventDefault();
              setSel((s) => Math.min(s + 1, rows.length - 1));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setSel((s) => Math.max(s - 1, 0));
            } else if (e.key === "Enter") {
              e.preventDefault();
              const create = e.shiftKey && overlay === "switcher" ? rows.find((r) => r.key === "::create") : undefined;
              run(create ?? rows[sel], { ctrl: e.ctrlKey, shift: e.shiftKey });
            }
          }}
        />
        <div className="palette-list" ref={listRef}>
          {rows.length === 0 && <div className="palette-empty">Sonuç yok</div>}
          {rows.map((r, i) => (
            <div
              key={r.key}
              className={`palette-row${i === sel ? " selected" : ""}`}
              onMouseMove={() => setSel(i)}
              onClick={(e) => run(r, { ctrl: e.ctrlKey, shift: e.shiftKey })}
            >
              {r.icon && <span className="palette-icon">{r.icon}</span>}
              <span className="palette-label">{r.label}</span>
              {r.hint && <span className="palette-hint">{r.hint}</span>}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ diyaloglar
function PromptDialog({ title: heading, value, okText, selectAll, onSubmit }: { title: string; value: string; okText?: string; selectAll?: boolean; onSubmit: (v: string) => void | Promise<void> }) {
  const [text, setText] = useState(value);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    input.current?.focus();
    if (selectAll) input.current?.select();
  }, [selectAll]);
  const close = () => useStore.setState({ dialog: null });
  const submit = () => {
    close();
    void onSubmit(text);
  };
  return (
    <div className="modal-backdrop" onMouseDown={close}>
      <div className="dialog" onMouseDown={(e) => e.stopPropagation()}>
        <h3>{heading}</h3>
        <input
          ref={input}
          className="text-input"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") submit();
            if (e.key === "Escape") close();
          }}
        />
        <div className="dialog-actions">
          <button className="btn" onClick={close}>Vazgeç</button>
          <button className="btn primary" onClick={submit}>{okText || "Tamam"}</button>
        </div>
      </div>
    </div>
  );
}

function ConfirmDialog({ title: heading, message, okText, danger, onConfirm }: { title: string; message: string; okText?: string; danger?: boolean; onConfirm: () => void | Promise<void> }) {
  const close = () => useStore.setState({ dialog: null });
  const ok = useRef<HTMLButtonElement>(null);
  useEffect(() => ok.current?.focus(), []);
  return (
    <div className="modal-backdrop" onMouseDown={close} onKeyDown={(e) => e.key === "Escape" && close()}>
      <div className="dialog" onMouseDown={(e) => e.stopPropagation()}>
        <h3>{heading}</h3>
        <p className="dialog-text">{message}</p>
        <div className="dialog-actions">
          <button className="btn" onClick={close}>Vazgeç</button>
          <button
            ref={ok}
            className={`btn ${danger ? "danger" : "primary"}`}
            onClick={() => {
              close();
              void onConfirm();
            }}
          >
            {okText || "Tamam"}
          </button>
        </div>
      </div>
    </div>
  );
}

function SettingsDialog() {
  const settings = useStore((s) => s.settings);
  const vault = useStore((s) => s.vault);
  const [version, setVersion] = useState("");
  useEffect(() => {
    void api.app.version().then(setVersion);
  }, []);
  if (!settings) return null;
  const close = () => useStore.setState({ dialog: null });
  return (
    <div className="modal-backdrop" onMouseDown={close} onKeyDown={(e) => e.key === "Escape" && close()}>
      <div className="dialog settings" onMouseDown={(e) => e.stopPropagation()}>
        <h3>Ayarlar</h3>
        <section>
          <h4>Görünüm</h4>
          <label className="setting">
            <span>Tema</span>
            <select value={settings.theme} onChange={(e) => void updateSettings({ theme: e.target.value as typeof settings.theme })}>
              <option value="system">Windows ile aynı</option>
              <option value="dark">Koyu</option>
              <option value="light">Açık</option>
            </select>
          </label>
          <label className="setting">
            <span>Yazı boyutu <em>{settings.fontSize}px</em></span>
            <input type="range" min={12} max={24} value={settings.fontSize} onChange={(e) => void updateSettings({ fontSize: Number(e.target.value) })} />
          </label>
          <label className="setting">
            <span>Editör yazı tipi</span>
            <select value={settings.editorFont} onChange={(e) => void updateSettings({ editorFont: e.target.value as "sans" | "mono" })}>
              <option value="sans">Segoe UI (metin)</option>
              <option value="mono">Cascadia Code (kod)</option>
            </select>
          </label>
          <label className="setting check">
            <input type="checkbox" checked={settings.readableWidth} onChange={(e) => void updateSettings({ readableWidth: e.target.checked })} />
            <span>Okunabilir satır genişliği</span>
          </label>
        </section>
        <section>
          <h4>Editör</h4>
          <label className="setting">
            <span>Notlar şu modda açılsın</span>
            <select value={settings.defaultMode} onChange={(e) => void updateSettings({ defaultMode: e.target.value as typeof settings.defaultMode })}>
              <option value="edit">Düzenleme</option>
              <option value="split">Yan yana</option>
              <option value="read">Okuma</option>
            </select>
          </label>
          <label className="setting check">
            <input type="checkbox" checked={settings.spellcheck} onChange={(e) => void updateSettings({ spellcheck: e.target.checked })} />
            <span>Yazım denetimi (Türkçe + İngilizce)</span>
          </label>
        </section>
        <section>
          <h4>Kasa</h4>
          <div className="setting">
            <span className="vault-path" title={vault?.path}>{vault?.path}</span>
            <div className="row-gap">
              <button className="btn" onClick={() => void api.vault.openFolder()}>Klasörü aç</button>
              <button className="btn" onClick={() => { close(); void changeVault(); }}>Değiştir…</button>
            </div>
          </div>
        </section>
        <p className="about">Atölye {version} · Her şey bu bilgisayarda: notlar Markdown, kod parçaları gerçek kaynak dosyaları, istekler .http dosyaları.</p>
        <div className="dialog-actions">
          <button className="btn primary" onClick={close}>Kapat</button>
        </div>
      </div>
    </div>
  );
}

function Dialogs() {
  const dialog = useStore((s) => s.dialog);
  if (!dialog) return null;
  if (dialog.type === "prompt") return <PromptDialog key={dialog.title + dialog.value} {...dialog} />;
  if (dialog.type === "confirm") return <ConfirmDialog {...dialog} />;
  return <SettingsDialog />;
}

function Toast() {
  const toast = useStore((s) => s.toast);
  if (!toast) return null;
  return <div key={toast.id} className={`toast ${toast.kind}`}>{toast.text}</div>;
}

export function Overlays() {
  return (
    <>
      <ContextMenu />
      <Palette />
      <Dialogs />
      <Toast />
    </>
  );
}
