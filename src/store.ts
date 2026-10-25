/** Uygulama durumu (zustand) ve tum dosya islemleri. */
import { useMemo } from "react";
import { create } from "zustand";
import { api, type FileEntry, type Settings, type ViewMode } from "./api";
import { rewriteLinks } from "./lib/links";
import {
  basename, BOARD_FILE, dirname, extname, isBoardNote, isCode, isDrawing, isHttp, isImage, isNote, join, REQUEST_DIR, sanitizeName,
  SNIPPET_DIR, stripExt, timeStamp, title, todayStamp,
} from "./lib/paths";
import { buildIndex, type VaultIndex } from "./lib/vaultIndex";

export type TabKind = "note" | "drawing" | "image" | "graph" | "code" | "http" | "snippets" | "tools" | "file";
export type Tab = { id: string; path: string; kind: TabKind };
export const GRAPH_PATH = "::graph";
export const SNIPPETS_PATH = "::snippets";
export const TOOLS_PATH = "::tools";
export const HTTP_PATH = "::http";
const VIEW_PATHS: Record<string, TabKind> = { [GRAPH_PATH]: "graph", [SNIPPETS_PATH]: "snippets", [TOOLS_PATH]: "tools", [HTTP_PATH]: "http" };
export const isViewPath = (p: string) => p in VIEW_PATHS;

export type Dialog =
  | { type: "prompt"; title: string; label?: string; value: string; okText?: string; selectAll?: boolean; onSubmit: (v: string) => void | Promise<void> }
  | { type: "confirm"; title: string; message: string; okText?: string; danger?: boolean; onConfirm: () => void | Promise<void> }
  | { type: "settings" }
  | null;

export type Overlay = null | "commands" | "switcher" | "templates";

type State = {
  ready: boolean;
  error: string | null;
  vault: { path: string; name: string } | null;
  files: FileEntry[];
  notes: Record<string, string>;
  texts: Record<string, string>;
  dirty: Record<string, true>;
  tabs: Tab[];
  active: string | null;
  modes: Record<string, ViewMode>;
  settings: Settings | null;
  systemDark: boolean;
  leftOpen: boolean;
  rightOpen: boolean;
  leftView: "files" | "search" | "tags";
  rightView: "outline" | "links";
  overlay: Overlay;
  dialog: Dialog;
  toast: { id: number; text: string; kind: "info" | "error" } | null;
  searchQuery: string;
  expanded: Record<string, boolean>;
  jump: { path: string; line: number; nonce: number } | null;
  history: string[];
  historyIndex: number;
  indexVersion: number;
  httpFile: string | null;
};

export const useStore = create<State>(() => ({
  ready: false,
  error: null,
  vault: null,
  files: [],
  notes: {},
  texts: {},
  dirty: {},
  tabs: [],
  active: null,
  modes: {},
  settings: null,
  systemDark: true,
  leftOpen: true,
  rightOpen: true,
  leftView: "files",
  rightView: "outline",
  overlay: null,
  dialog: null,
  toast: null,
  searchQuery: "",
  expanded: {},
  jump: null,
  history: [],
  historyIndex: -1,
  indexVersion: 0,
  httpFile: null,
}));

const get = useStore.getState;
const set = useStore.setState;

// ------------------------------------------------------------------ indeks
let indexTimer: number | undefined;
let cachedIndex: { v: number; idx: VaultIndex } | null = null;

function bumpIndex(now = false): void {
  window.clearTimeout(indexTimer);
  if (now) set((s) => ({ indexVersion: s.indexVersion + 1 }));
  else indexTimer = window.setTimeout(() => set((s) => ({ indexVersion: s.indexVersion + 1 })), 300);
}

export function getIndex(): VaultIndex {
  const s = get();
  if (!cachedIndex || cachedIndex.v !== s.indexVersion) {
    cachedIndex = { v: s.indexVersion, idx: buildIndex(s.notes, s.files.filter((f) => !f.dir).map((f) => f.path)) };
  }
  return cachedIndex.idx;
}

export function useIndex(): VaultIndex {
  const v = useStore((s) => s.indexVersion);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(() => getIndex(), [v]);
}

export const isDark = (s: Pick<State, "settings" | "systemDark">) =>
  s.settings?.theme === "dark" || (s.settings?.theme !== "light" && s.systemDark);

// ------------------------------------------------------------------ bildirim
let toastTimer: number | undefined;
export function toast(text: string, kind: "info" | "error" = "info"): void {
  window.clearTimeout(toastTimer);
  set({ toast: { id: Date.now(), text, kind } });
  toastTimer = window.setTimeout(() => set({ toast: null }), kind === "error" ? 5000 : 2600);
}

async function guard<T>(fn: () => Promise<T>): Promise<T | undefined> {
  try {
    return await fn();
  } catch (e) {
    toast(String((e as Error)?.message || e).replace(/^Error invoking remote method '[^']+': (Error: )?/, ""), "error");
    return undefined;
  }
}

// ------------------------------------------------------------------ baslangic
export async function init(): Promise<void> {
  try {
    const [settings, vault, files, notes] = await Promise.all([api.settings.get(), api.vault.info(), api.vault.list(), api.vault.readAll()]);
    const tabs = settings.session.tabs.filter((p) => p in VIEW_PATHS || files.some((f) => f.path === p)).map(makeTab);
    const active = tabs.find((t) => t.path === settings.session.active)?.id ?? tabs[0]?.id ?? null;
    set({
      ready: true,
      settings,
      systemDark: settings.dark,
      vault,
      files,
      notes,
      tabs,
      active,
      leftOpen: settings.session.leftOpen,
      rightOpen: settings.session.rightOpen,
    });
    bumpIndex(true);
    if (!tabs.length) {
      const welcome = files.find((f) => f.path === "Atölye'ye hoş geldin.md");
      if (welcome) openPath(welcome.path);
    }
    api.vault.onChanged(applyExternal);
    api.app.onThemeChanged((dark) => set({ systemDark: dark }));
    api.app.onFlush(async () => {
      await flushAll();
      await saveSession(true);
      api.app.flushed();
    });
  } catch (e) {
    set({ error: String((e as Error)?.message || e) });
  }
}

export async function refreshFiles(): Promise<void> {
  const files = await api.vault.list();
  set({ files });
  bumpIndex(true);
}

// ------------------------------------------------------------------ sekmeler
function kindOf(path: string): TabKind {
  if (path in VIEW_PATHS) return VIEW_PATHS[path];
  if (isNote(path)) return "note";
  if (isDrawing(path)) return "drawing";
  if (isImage(path)) return "image";
  if (isHttp(path)) return "http";
  if (isCode(path)) return "code";
  return "file";
}

/** Not olmayan metin dosyasi (kod, .http) icerigini okur ve onbellege alir. */
export async function loadText(path: string): Promise<string | undefined> {
  const s = get();
  if (path in s.texts) return s.texts[path];
  const content = await guard(() => api.vault.read(path));
  if (content !== undefined) set((st) => ({ texts: { ...st.texts, [path]: content } }));
  return content;
}
let tabSeq = 0;
const makeTab = (path: string): Tab => ({ id: `t${++tabSeq}`, path, kind: kindOf(path) });

export function activeTab(): Tab | null {
  const s = get();
  return s.tabs.find((t) => t.id === s.active) ?? null;
}

export async function openPath(path: string, opts: { newTab?: boolean; line?: number; history?: boolean } = {}): Promise<void> {
  const s = get();
  const kind = kindOf(path);
  if (kind === "file") {
    void api.vault.reveal(path);
    return;
  }
  if (kind === "http" && path !== HTTP_PATH) {
    set({ httpFile: path });
    return openPath(HTTP_PATH, { newTab: true });
  }
  if (kind === "code" && !(path in s.texts) && (await loadText(path)) === undefined) return;
  if (kind === "note" && !(path in s.notes)) {
    const content = await guard(() => api.vault.read(path));
    if (content === undefined) return;
    set((st) => ({ notes: { ...st.notes, [path]: content } }));
  }
  const existing = s.tabs.find((t) => t.path === path);
  let tabs = s.tabs;
  let active: string;
  if (existing) {
    active = existing.id;
  } else {
    const tab = makeTab(path);
    const cur = s.tabs.findIndex((t) => t.id === s.active);
    if (!opts.newTab && cur >= 0 && !(s.tabs[cur].path in VIEW_PATHS) && !s.dirty[s.tabs[cur].path]) {
      tabs = [...s.tabs];
      tabs[cur] = tab;
    } else {
      tabs = [...s.tabs.slice(0, cur + 1), tab, ...s.tabs.slice(cur + 1)];
    }
    active = tab.id;
  }
  const expanded = { ...s.expanded };
  for (let d = dirname(path); d; d = dirname(d)) expanded[d] = true;
  const patch: Partial<State> = { tabs, active, expanded };
  if (opts.history !== false && !(path in VIEW_PATHS) && path !== s.history[s.historyIndex]) {
    const history = [...s.history.slice(0, s.historyIndex + 1), path].slice(-100);
    patch.history = history;
    patch.historyIndex = history.length - 1;
  }
  if (opts.line !== undefined) patch.jump = { path, line: opts.line, nonce: Date.now() };
  set(patch);
  void saveSession();
}

export function closeTab(id: string): void {
  const s = get();
  const i = s.tabs.findIndex((t) => t.id === id);
  if (i < 0) return;
  const tab = s.tabs[i];
  if (s.dirty[tab.path]) void flush(tab.path);
  const tabs = s.tabs.filter((t) => t.id !== id);
  const active = s.active === id ? (tabs[i] ?? tabs[i - 1])?.id ?? null : s.active;
  set({ tabs, active });
  void saveSession();
}

export function setActive(id: string): void {
  set({ active: id });
  void saveSession();
}

export function cycleTab(dir: 1 | -1): void {
  const s = get();
  if (!s.tabs.length) return;
  const i = s.tabs.findIndex((t) => t.id === s.active);
  setActive(s.tabs[(i + dir + s.tabs.length) % s.tabs.length].id);
}

export function moveTab(id: string, toIndex: number): void {
  const tabs = [...get().tabs];
  const from = tabs.findIndex((t) => t.id === id);
  if (from < 0) return;
  const [tab] = tabs.splice(from, 1);
  tabs.splice(Math.max(0, Math.min(toIndex, tabs.length)), 0, tab);
  set({ tabs });
}

export function navigate(dir: -1 | 1): void {
  const s = get();
  const idx = s.historyIndex + dir;
  const path = s.history[idx];
  if (!path) return;
  set({ historyIndex: idx });
  void openPath(path, { history: false });
}

export function openGraph(): void {
  void openPath(GRAPH_PATH, { newTab: true });
}

let sessionTimer: number | undefined;
export function saveSession(now = false): Promise<unknown> | void {
  const run = () => {
    const s = get();
    return api.settings.set({
      session: {
        tabs: s.tabs.map((t) => t.path),
        active: s.tabs.find((t) => t.id === s.active)?.path ?? null,
        leftOpen: s.leftOpen,
        rightOpen: s.rightOpen,
      },
    });
  };
  window.clearTimeout(sessionTimer);
  if (now) return run();
  sessionTimer = window.setTimeout(run, 800);
}

// ------------------------------------------------------------------ kaydetme
const saveTimers = new Map<string, number>();

export function updateNote(path: string, content: string): void {
  const s = get();
  const note = isNote(path);
  if ((note ? s.notes[path] : s.texts[path]) === content) return;
  if (note) set({ notes: { ...s.notes, [path]: content }, dirty: { ...s.dirty, [path]: true } });
  else set({ texts: { ...s.texts, [path]: content }, dirty: { ...s.dirty, [path]: true } });
  window.clearTimeout(saveTimers.get(path));
  saveTimers.set(path, window.setTimeout(() => void flush(path), 600));
  if (note) bumpIndex();
}

/** Kod ve .http dosyalari icin ayni otomatik kayit. */
export const updateText = updateNote;

export async function flush(path: string): Promise<void> {
  window.clearTimeout(saveTimers.get(path));
  saveTimers.delete(path);
  const s = get();
  const map = isNote(path) ? s.notes : s.texts;
  if (!s.dirty[path] || !(path in map)) return;
  const content = map[path];
  const ok = await guard(async () => {
    await api.vault.write(path, content);
    return true;
  });
  const now = isNote(path) ? get().notes : get().texts;
  if (ok && now[path] === content) {
    const dirty = { ...get().dirty };
    delete dirty[path];
    set({ dirty });
  }
}

export async function flushAll(): Promise<void> {
  await Promise.all(Object.keys(get().dirty).map(flush));
}

/** Cizim gibi notes'ta tutulmayan metin dosyalarini yazar. */
export async function writeFile(path: string, content: string): Promise<boolean> {
  return !!(await guard(async () => {
    await api.vault.write(path, content);
    return true;
  }));
}

// ------------------------------------------------------------------ dis degisiklikler
async function applyExternal(paths: string[]): Promise<void> {
  await refreshFiles();
  const s = get();
  const existing = new Set(s.files.map((f) => f.path));
  const notes = { ...s.notes };
  let changed = false;
  const texts = { ...s.texts };
  for (const p of paths) {
    if (p in texts && !s.dirty[p]) {
      if (!existing.has(p)) delete texts[p];
      else {
        try {
          texts[p] = await api.vault.read(p);
        } catch {
          /* gecici okuma hatasi */
        }
      }
      changed = true;
    }
    if (!isNote(p)) continue;
    if (!existing.has(p)) {
      if (p in notes && !s.dirty[p]) {
        delete notes[p];
        changed = true;
      }
      continue;
    }
    try {
      const content = await api.vault.read(p);
      if (notes[p] === content) continue;
      if (s.dirty[p]) {
        toast(`“${title(p)}” dışarıda değişti; senin düzenlemen korundu.`);
        continue;
      }
      notes[p] = content;
      changed = true;
    } catch {
      /* gecici okuma hatasi */
    }
  }
  const tabs = s.tabs.filter((t) => t.path in VIEW_PATHS || existing.has(t.path) || s.dirty[t.path]);
  if (changed || tabs.length !== s.tabs.length) {
    set({ notes, texts, tabs, active: tabs.some((t) => t.id === s.active) ? s.active : tabs[0]?.id ?? null });
    bumpIndex(true);
  }
}

// ------------------------------------------------------------------ olusturma
export function currentFolder(): string {
  const tab = activeTab();
  return tab && !(tab.path in VIEW_PATHS) ? dirname(tab.path) : "";
}

export const openView = (path: string) => void openPath(path, { newTab: true });

/** Gorev panosunu ac (yoksa olustur). */
export async function openBoard(): Promise<void> {
  if (get().files.some((f) => f.path === BOARD_FILE)) return openPath(BOARD_FILE);
  await createNote(BOARD_FILE, "---\natolye: board\n---\n\n## Yapılacak\n\n## Yapılıyor\n\n## Bitti\n");
}

export function newSnippet(): void {
  prompt("Yeni kod parçası (uzantısıyla, örn. debounce.ts)", "yeni-parca.ts", async (name) => {
    const clean = sanitizeName(name);
    if (!clean) return;
    const file = extname(clean) ? clean : `${clean}.txt`;
    const path = await guard(() => api.vault.unique(join(SNIPPET_DIR, file)));
    if (!path || !(await writeFile(path, ""))) return;
    set((s) => ({ texts: { ...s.texts, [path]: "" } }));
    await refreshFiles();
    await openPath(path, { newTab: true });
  });
}

export function newRequestFile(): void {
  prompt("Yeni istek dosyası", "Yeni istekler", async (name) => {
    const clean = sanitizeName(name) || "Yeni istekler";
    const path = await guard(() => api.vault.unique(join(REQUEST_DIR, `${clean}.http`)));
    const content = "### Yeni istek\nGET https://httpbin.org/get\nAccept: application/json\n";
    if (!path || !(await writeFile(path, content))) return;
    set((s) => ({ texts: { ...s.texts, [path]: content }, httpFile: path }));
    await refreshFiles();
    openView(HTTP_PATH);
  });
}

function prompt(title: string, value: string, onSubmit: (v: string) => void | Promise<void>, okText = "Oluştur"): void {
  set({ dialog: { type: "prompt", title, value, okText, selectAll: true, onSubmit } });
}

export function newNote(folder = currentFolder()): void {
  prompt("Yeni not", "Adsız not", async (name) => {
    const clean = sanitizeName(name) || "Adsız not";
    await createNote(join(folder, `${clean}.md`), `# ${clean}\n\n`);
  });
}

export async function createNote(path: string, content: string, open = true): Promise<string | undefined> {
  const unique = await guard(() => api.vault.unique(path));
  if (!unique) return undefined;
  const ok = await guard(async () => {
    await api.vault.write(unique, content);
    return true;
  });
  if (!ok) return undefined;
  set((s) => ({ notes: { ...s.notes, [unique]: content } }));
  await refreshFiles();
  if (open) await openPath(unique, { newTab: true });
  return unique;
}

export const EMPTY_DRAWING = JSON.stringify(
  { type: "excalidraw", version: 2, source: "atolye", elements: [], appState: { gridSize: null, viewBackgroundColor: "#ffffff" }, files: {} },
  null,
  2,
);

export function newDrawing(folder = currentFolder()): void {
  prompt("Yeni çizim", "Adsız çizim", async (name) => {
    const clean = sanitizeName(name) || "Adsız çizim";
    const path = await guard(() => api.vault.unique(join(folder, `${clean}.excalidraw`)));
    if (!path || !(await writeFile(path, EMPTY_DRAWING))) return;
    await refreshFiles();
    await openPath(path, { newTab: true });
  });
}

export function newFolder(parent = currentFolder()): void {
  prompt("Yeni klasör", "Yeni klasör", async (name) => {
    const clean = sanitizeName(name);
    if (!clean) return;
    const path = await guard(() => api.vault.unique(join(parent, clean)));
    if (!path) return;
    await guard(() => api.vault.mkdir(path));
    set((s) => ({ expanded: { ...s.expanded, [parent]: true, [path]: true } }));
    await refreshFiles();
  });
}

export async function openDaily(): Promise<void> {
  const path = `Günlük/${todayStamp()}.md`;
  const s = get();
  if (s.files.some((f) => f.path === path)) return openPath(path);
  const tpl = s.notes["Şablonlar/Günlük.md"];
  const content = tpl ? fillTemplate(tpl, todayStamp()) : `# ${todayStamp()}\n\n## Bugün\n- [ ] \n\n## Notlar\n`;
  await createNote(path, content);
}

export function templates(): string[] {
  return get()
    .files.filter((f) => !f.dir && isNote(f.path) && f.path.startsWith("Şablonlar/"))
    .map((f) => f.path)
    .sort();
}

export function fillTemplate(tpl: string, name: string): string {
  const now = new Date();
  return tpl
    .replace(/\{\{title\}\}/g, name)
    .replace(/\{\{date\}\}/g, todayStamp(now))
    .replace(/\{\{time\}\}/g, now.toTimeString().slice(0, 5));
}

export function newFromTemplate(tplPath: string): void {
  prompt(`${title(tplPath)} şablonundan not`, title(tplPath), async (name) => {
    const clean = sanitizeName(name) || "Adsız not";
    const folder = currentFolder().startsWith("Şablonlar") ? "" : currentFolder();
    await createNote(join(folder, `${clean}.md`), fillTemplate(get().notes[tplPath] ?? "", clean));
  });
}

export async function saveAttachment(data: Uint8Array, ext: string, hint = "Yapıştırılan"): Promise<string | undefined> {
  const safeExt = /^\.[a-z0-9]{1,5}$/.test(ext) ? ext : ".png";
  const path = await guard(() => api.vault.unique(`Ekler/${hint} ${timeStamp()}${safeExt}`));
  if (!path) return undefined;
  const ok = await guard(async () => {
    await api.vault.writeBinary(path, data);
    return true;
  });
  if (!ok) return undefined;
  await refreshFiles();
  return path;
}

// ------------------------------------------------------------------ yeniden adlandirma / tasima / silme
function remapPath(p: string, from: string, to: string): string {
  if (p === from) return to;
  if (p.startsWith(`${from}/`)) return to + p.slice(from.length);
  return p;
}

export async function movePath(from: string, to: string): Promise<boolean> {
  if (from === to) return true;
  if (to.startsWith(`${from}/`)) {
    toast("Klasör kendi içine taşınamaz", "error");
    return false;
  }
  await flushAll();
  const before = getIndex();
  const ok = await guard(async () => {
    await api.vault.rename(from, to);
    return true;
  });
  if (!ok) return false;
  const s = get();
  const notes: Record<string, string> = {};
  for (const [p, c] of Object.entries(s.notes)) notes[remapPath(p, from, to)] = c;
  const texts: Record<string, string> = {};
  for (const [p, c] of Object.entries(s.texts)) texts[remapPath(p, from, to)] = c;
  const modes: Record<string, ViewMode> = {};
  for (const [p, m] of Object.entries(s.modes)) modes[remapPath(p, from, to)] = m;
  const tabs = s.tabs.map((t) => ({ ...t, path: remapPath(t.path, from, to), kind: kindOf(remapPath(t.path, from, to)) }));
  const history = s.history.map((p) => remapPath(p, from, to));
  set({ notes, texts, modes, tabs, history, httpFile: s.httpFile ? remapPath(s.httpFile, from, to) : null });
  await refreshFiles();

  // Baglantilari guncelle (dosya adi degistiyse)
  const isFile = extname(from) !== "";
  if (isFile && basename(from) !== basename(to)) {
    const othersWithSameName = get().files.filter((f) => !f.dir && f.path !== to && title(f.path) === title(to)).length;
    const newTarget = isNote(to) ? (othersWithSameName ? stripExt(to) : title(to)) : othersWithSameName ? to : basename(to);
    let count = 0;
    for (const [p, src] of Object.entries(get().notes)) {
      const out = rewriteLinks(src, (target) => before.resolver.resolve(target) === from, newTarget);
      if (out !== src) {
        count++;
        updateNote(p, out);
      }
    }
    if (count) toast(`${count} nottaki bağlantı güncellendi`);
  }
  bumpIndex(true);
  void saveSession();
  return true;
}

export function renamePath(path: string): void {
  const isFile = extname(path) !== "";
  const ext = isFile ? extname(path) : "";
  const current = isFile ? basename(path).slice(0, -ext.length) : basename(path);
  prompt(
    "Yeniden adlandır",
    current,
    async (name) => {
      const clean = sanitizeName(name);
      if (!clean || clean === current) return;
      await movePath(path, join(dirname(path), clean + ext));
    },
    "Kaydet",
  );
}

export function deletePath(path: string): void {
  const isFolder = extname(path) === "";
  set({
    dialog: {
      type: "confirm",
      title: isFolder ? "Klasörü sil" : "Dosyayı sil",
      message: `“${basename(path)}”${isFolder ? " ve içindekiler" : ""} Geri Dönüşüm Kutusu'na taşınacak.`,
      okText: "Sil",
      danger: true,
      onConfirm: async () => {
        const ok = await guard(async () => {
          await api.vault.trash(path);
          return true;
        });
        if (!ok) return;
        const s = get();
        const gone = (p: string) => p === path || p.startsWith(`${path}/`);
        const notes = Object.fromEntries(Object.entries(s.notes).filter(([p]) => !gone(p)));
        const texts = Object.fromEntries(Object.entries(s.texts).filter(([p]) => !gone(p)));
        const dirty = Object.fromEntries(Object.entries(s.dirty).filter(([p]) => !gone(p))) as Record<string, true>;
        const tabs = s.tabs.filter((t) => !gone(t.path));
        set({ notes, texts, dirty, tabs, active: tabs.some((t) => t.id === s.active) ? s.active : tabs[0]?.id ?? null });
        await refreshFiles();
        void saveSession();
      },
    },
  });
}

// ------------------------------------------------------------------ gorunum
export function setMode(path: string, mode: ViewMode): void {
  set((s) => ({ modes: { ...s.modes, [path]: mode } }));
}

export function modeOf(path: string): ViewMode {
  const s = get();
  return s.modes[path] ?? (isBoardNote(s.notes[path]) ? "board" : s.settings?.defaultMode ?? "edit");
}

export function toggleLeft(view?: State["leftView"]): void {
  const s = get();
  if (view && (!s.leftOpen || s.leftView !== view)) set({ leftOpen: true, leftView: view });
  else set({ leftOpen: !s.leftOpen });
  void saveSession();
}

export function toggleRight(): void {
  set((s) => ({ rightOpen: !s.rightOpen }));
  void saveSession();
}

export async function updateSettings(patch: Partial<Settings>): Promise<void> {
  const settings = await guard(() => api.settings.set(patch));
  if (settings) set({ settings, systemDark: settings.dark });
}

export async function changeVault(): Promise<void> {
  await flushAll();
  const vault = await guard(() => api.vault.choose());
  if (!vault) return;
  const [files, notes] = await Promise.all([api.vault.list(), api.vault.readAll()]);
  set({ vault, files, notes, tabs: [], active: null, dirty: {}, modes: {}, history: [], historyIndex: -1 });
  bumpIndex(true);
  void saveSession();
}

export function openSearch(query?: string): void {
  set({ leftOpen: true, leftView: "search", ...(query !== undefined ? { searchQuery: query } : {}) });
  window.setTimeout(() => document.getElementById("search-input")?.focus(), 30);
}

/** Wiki baglantisina tiklaninca: varsa ac, yoksa olustur. */
export async function followLink(target: string, opts: { newTab?: boolean; heading?: string; from?: string } = {}): Promise<void> {
  const idx = getIndex();
  const resolved = get().files.some((f) => f.path === target) ? target : idx.resolver.resolve(target);
  if (resolved) {
    let line: number | undefined;
    if (opts.heading && isNote(resolved)) {
      const h = idx.parsed.get(resolved)?.headings.find((x) => x.text.toLowerCase() === opts.heading!.toLowerCase());
      line = h?.line;
    }
    return openPath(resolved, { newTab: opts.newTab, line });
  }
  const name = sanitizeName(basename(target)) || "Adsız not";
  const folder = target.includes("/") ? dirname(target) : opts.from ? dirname(opts.from) : "";
  await createNote(join(folder, `${name}.md`), `# ${name}\n\n`);
}
