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
export type Tab = { id: string; path: string; kind: TabKind; group: string };
/** Yan yana duzenleyici bolmesi (VS Code'daki "editor group"). size: genislik orani. */
export type Group = { id: string; active: string | null; size: number };
export type Side = "left" | "right";
export const MAX_GROUPS = 6;
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
  /** Odaktaki bolmenin etkin sekmesi (her zaman groups[activeGroup].active ile ayni). */
  active: string | null;
  groups: Group[];
  activeGroup: string;
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
  jump: { path: string; line: number; nonce: number; tab?: string } | null;
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
  groups: [{ id: "g1", active: null, size: 1 }],
  activeGroup: "g1",
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
    const restored = restoreLayout(settings.session, new Set(files.filter((f) => !f.dir).map((f) => f.path)));
    set({
      ready: true,
      settings,
      systemDark: settings.dark,
      vault,
      files,
      notes,
      ...restored,
      leftOpen: settings.session.leftOpen,
      rightOpen: settings.session.rightOpen,
    });
    bumpIndex(true);
    for (const t of restored.tabs) if (t.kind === "code") void loadText(t.path);
    if (!restored.tabs.length) {
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
const makeTab = (path: string, group: string): Tab => ({ id: `t${++tabSeq}`, path, kind: kindOf(path), group });
let groupSeq = 1;
const newGroupId = () => `g${++groupSeq}`;

export const groupTabs = (tabs: Tab[], group: string) => tabs.filter((t) => t.group === group);

export function activeTab(): Tab | null {
  const s = get();
  return s.tabs.find((t) => t.id === s.active) ?? null;
}

type Layout = Pick<State, "tabs" | "groups" | "activeGroup" | "active">;

/**
 * Sekme/bolme degisikliklerini tutarli hale getirir: bos bolmeleri kapatir (en az bir bolme kalir),
 * her bolmenin etkin sekmesini ve odaktaki bolmeyi duzeltir. Tum sekme/bolme yazimlari buradan gecer.
 */
function layout(tabs: Tab[], groups: Group[], activeGroup: string): Layout {
  if (!groups.length) groups = [{ id: newGroupId(), active: null, size: 1 }];
  const ids = new Set(groups.map((g) => g.id));
  const fallback = ids.has(activeGroup) ? activeGroup : groups[0].id;
  tabs = tabs.map((t) => (ids.has(t.group) ? t : { ...t, group: fallback }));
  let out = groups.filter((g) => tabs.some((t) => t.group === g.id));
  if (!out.length) out = [{ ...groups[0], active: null, size: 1 }];
  // Genislik oranlarini ortalamasi 1 olacak sekilde olcekle: bolme kapaninca bosalan yer kalanlara dagilir
  // (fr toplami 1'in altina duserse grid alanin tamamini doldurmaz).
  const sum = out.reduce((n, g) => n + (g.size > 0 ? g.size : 1), 0);
  out = out.map((g) => {
    const own = tabs.filter((t) => t.group === g.id);
    const size = ((g.size > 0 ? g.size : 1) * out.length) / sum;
    return { ...g, size, active: own.some((t) => t.id === g.active) ? g.active : own[0]?.id ?? null };
  });
  let focus = activeGroup;
  if (!out.some((g) => g.id === focus)) {
    // kapanan bolmenin solundaki bolmeye (yoksa ilk bolmeye) gec
    const old = groups.findIndex((g) => g.id === activeGroup);
    const left = groups.slice(0, Math.max(0, old)).reverse().find((g) => out.some((x) => x.id === g.id));
    focus = left?.id ?? out[0].id;
  }
  return { tabs, groups: out, activeGroup: focus, active: out.find((g) => g.id === focus)!.active };
}

/** ref bolmesinin soluna/sagina yeni bos bolme ekler; ref'in genisligini ikiye boler. */
function insertGroup(groups: Group[], ref: string, side: Side): { groups: Group[]; id: string } | null {
  if (groups.length >= MAX_GROUPS) {
    toast(`En fazla ${MAX_GROUPS} bölme açılabilir`);
    return null;
  }
  const i = Math.max(0, groups.findIndex((g) => g.id === ref));
  const r = groups[i];
  const id = newGroupId();
  const half = r.size / 2;
  const out = groups.map((g) => (g.id === r.id ? { ...g, size: half } : g));
  out.splice(i + (side === "right" ? 1 : 0), 0, { id, active: null, size: half });
  return { groups: out, id };
}

/** Bir sekme kaldirildiginda (kapatma/tasima) bolmesinde yerine gececek komsu sekme. */
function neighborIn(tabs: Tab[], tab: Tab): string | null {
  const own = groupTabs(tabs, tab.group);
  const i = own.findIndex((t) => t.id === tab.id);
  return (own[i + 1] ?? own[i - 1])?.id ?? null;
}

/** side: true = sagdaki bolmede (yoksa yeni bolmede) ac; "left"/"right" = o tarafta her zaman yeni bolme ac. */
type OpenOpts = { newTab?: boolean; line?: number; history?: boolean; group?: string; side?: boolean | Side };

export async function openPath(path: string, opts: OpenOpts = {}): Promise<void> {
  const kind = kindOf(path);
  if (kind === "file") {
    void api.vault.reveal(path);
    return;
  }
  if (kind === "http" && path !== HTTP_PATH) {
    set({ httpFile: path });
    return openPath(HTTP_PATH, { ...opts, newTab: true, line: undefined });
  }
  if (kind === "code" && !(path in get().texts) && (await loadText(path)) === undefined) return;
  if (kind === "note" && !(path in get().notes)) {
    const content = await guard(() => api.vault.read(path));
    if (content === undefined) return;
    set((st) => ({ notes: { ...st.notes, [path]: content } }));
  }
  const s = get();
  let groups = s.groups;
  let target = opts.group && groups.some((g) => g.id === opts.group) ? opts.group : s.activeGroup;
  // Cizim tek bolmede acik olabilir (iki kopya birbirinin kaydini ezerdi): aciksa yeni bolme acmadan ona gec
  const openDrawing = kind === "drawing" ? s.tabs.find((t) => t.path === path) : undefined;
  if (opts.side && !openDrawing) {
    const side: Side = opts.side === "left" ? "left" : "right";
    const i = groups.findIndex((g) => g.id === target);
    const next = opts.side === true ? groups[i + 1] : undefined;
    if (next) target = next.id;
    else {
      const made = insertGroup(groups, target, side);
      if (made) ({ groups, id: target } = made);
    }
  }
  // Ayni bolmede zaten aciksa ona gec
  const existing = openDrawing ?? s.tabs.find((t) => t.group === target && t.path === path);
  let tabs = s.tabs;
  let id: string;
  if (existing) {
    id = existing.id;
    target = existing.group;
  } else {
    const tab = makeTab(path, target);
    const curId = groups.find((g) => g.id === target)?.active;
    const cur = s.tabs.findIndex((t) => t.id === curId);
    if (!opts.newTab && !opts.side && cur >= 0 && !(s.tabs[cur].path in VIEW_PATHS) && !s.dirty[s.tabs[cur].path]) {
      tabs = [...s.tabs];
      tabs[cur] = tab;
    } else if (cur >= 0) {
      tabs = [...s.tabs.slice(0, cur + 1), tab, ...s.tabs.slice(cur + 1)];
    } else {
      tabs = [...s.tabs, tab];
    }
    id = tab.id;
  }
  groups = groups.map((g) => (g.id === target ? { ...g, active: id } : g));
  const expanded = { ...s.expanded };
  for (let d = dirname(path); d; d = dirname(d)) expanded[d] = true;
  const patch: Partial<State> = { ...layout(tabs, groups, target), expanded };
  if (opts.history !== false && !(path in VIEW_PATHS) && path !== s.history[s.historyIndex]) {
    const history = [...s.history.slice(0, s.historyIndex + 1), path].slice(-100);
    patch.history = history;
    patch.historyIndex = history.length - 1;
  }
  if (opts.line !== undefined) patch.jump = { path, line: opts.line, nonce: Date.now(), tab: id };
  set(patch);
  void saveSession();
}

export function closeTab(id: string): void {
  const s = get();
  const tab = s.tabs.find((t) => t.id === id);
  if (!tab) return;
  if (s.dirty[tab.path]) void flush(tab.path);
  const groups = s.groups.map((g) => (g.id === tab.group && g.active === id ? { ...g, active: neighborIn(s.tabs, tab) } : g));
  set(layout(s.tabs.filter((t) => t.id !== id), groups, s.activeGroup));
  void saveSession();
}

/** Bir bolmedeki sekmeleri kapatir; keep verilirse o sekme kalir. Son sekme de kapanirsa bolme kapanir. */
export function closeTabs(group: string, keep?: string): void {
  const s = get();
  for (const t of s.tabs) if (t.group === group && t.id !== keep && s.dirty[t.path]) void flush(t.path);
  const tabs = s.tabs.filter((t) => t.group !== group || t.id === keep);
  const groups = s.groups.map((g) => (g.id === group ? { ...g, active: keep ?? null } : g));
  set(layout(tabs, groups, s.activeGroup));
  void saveSession();
}

export function setActive(id: string): void {
  const s = get();
  const tab = s.tabs.find((t) => t.id === id);
  if (!tab || (s.active === id && s.activeGroup === tab.group)) return;
  set(layout(s.tabs, s.groups.map((g) => (g.id === tab.group ? { ...g, active: id } : g)), tab.group));
  void saveSession();
}

/** Tiklanan / odaklanan bolmeyi etkin yapar. */
export function focusGroup(group: string): void {
  const s = get();
  if (s.activeGroup === group || !s.groups.some((g) => g.id === group)) return;
  set(layout(s.tabs, s.groups, group));
  void saveSession();
}

/** Ctrl+1..6: n. bolmeye gec; hemen sagdaki (henuz olmayan) bolme istenirse etkin sekmeyi oraya bol. */
export function focusGroupAt(index: number): void {
  const s = get();
  const g = s.groups[index];
  if (g) focusGroup(g.id);
  else if (index === s.groups.length && s.active) splitTab(s.active, "right");
}

export function cycleTab(dir: 1 | -1): void {
  const s = get();
  const own = groupTabs(s.tabs, s.activeGroup);
  if (!own.length) return;
  const i = own.findIndex((t) => t.id === s.active);
  setActive(own[(i + dir + own.length) % own.length].id);
}

/**
 * Sekmeyi bir bolmenin index sirasina tasir (ayni ya da baska bolme). index, tasinan sekme cikarildiktan
 * sonraki siradir. Sekmenin kimligi degismez; icerik (editor, cizim) yeniden yuklenmez.
 */
export function placeTab(id: string, group: string, index: number): void {
  const s = get();
  const tab = s.tabs.find((t) => t.id === id);
  if (!tab || !s.groups.some((g) => g.id === group)) return;
  const dup = tab.group !== group ? s.tabs.find((t) => t.group === group && t.path === tab.path) : undefined;
  let groups = s.groups.map((g) =>
    g.id === tab.group && g.active === id && tab.group !== group ? { ...g, active: neighborIn(s.tabs, tab) } : g,
  );
  const tabs = s.tabs.filter((t) => t.id !== id);
  if (dup) {
    // hedef bolmede ayni dosya zaten acik: tasinan kopyayi kapat, oradakine gec
    if (s.dirty[tab.path]) void flush(tab.path);
  } else {
    const moved = { ...tab, group };
    const own = tabs.filter((t) => t.group === group);
    const ref = own[Math.max(0, index)];
    if (ref) tabs.splice(tabs.indexOf(ref), 0, moved);
    else if (own.length) tabs.splice(tabs.indexOf(own[own.length - 1]) + 1, 0, moved);
    else tabs.push(moved);
  }
  const activeId = dup?.id ?? id;
  groups = groups.map((g) => (g.id === group ? { ...g, active: activeId } : g));
  set(layout(tabs, groups, group));
  void saveSession();
}

/** Sekmeyi ref bolmesinin yanina acilan yeni bolmeye tasir. */
export function moveToNewGroup(id: string, ref: string, side: Side): void {
  const s = get();
  const tab = s.tabs.find((t) => t.id === id);
  if (!tab) return;
  // Tek sekmeli bolmeyi kendi yanina tasimak bir sey degistirmez
  if (tab.group === ref && groupTabs(s.tabs, ref).length === 1) return;
  const made = insertGroup(s.groups, ref, side);
  if (!made) return;
  set({ groups: made.groups });
  placeTab(id, made.id, 0);
}

/** Sekmeyi soldaki/sagdaki bolmeye tasir; o yonde bolme yoksa yenisini acar (VS Code: Ctrl+Alt+Sol/Sag). */
export function moveTabToSide(id: string, side: Side): void {
  const s = get();
  const tab = s.tabs.find((t) => t.id === id);
  if (!tab) return;
  const i = s.groups.findIndex((g) => g.id === tab.group);
  const next = s.groups[side === "right" ? i + 1 : i - 1];
  if (next) placeTab(id, next.id, groupTabs(s.tabs, next.id).length);
  else moveToNewGroup(id, tab.group, side);
}

/** Dosyayi yanda yeni bolmede de acar (VS Code: Duzenleyiciyi Bol). Cizim kopyalanmaz, tasinir. */
export function splitTab(id: string, side: Side = "right"): void {
  const s = get();
  const tab = s.tabs.find((t) => t.id === id);
  if (!tab) return;
  if (tab.kind === "drawing") {
    if (groupTabs(s.tabs, tab.group).length === 1) toast("Çizim aynı anda iki bölmede açılamaz; yanına başka bir dosya aç");
    else moveToNewGroup(id, tab.group, side);
    return;
  }
  const made = insertGroup(s.groups, tab.group, side);
  if (!made) return;
  const copy = makeTab(tab.path, made.id);
  const i = s.tabs.indexOf(tab);
  const tabs = [...s.tabs.slice(0, i + 1), copy, ...s.tabs.slice(i + 1)];
  set(layout(tabs, made.groups.map((g) => (g.id === made.id ? { ...g, active: copy.id } : g)), made.id));
  void saveSession();
}

/** Bolme genislik oranlarini gunceller (ayirici surukleme). */
export function resizeGroups(sizes: number[]): void {
  const s = get();
  if (sizes.length !== s.groups.length || sizes.some((x) => !(x > 0) || !Number.isFinite(x))) return;
  set({ groups: s.groups.map((g, i) => ({ ...g, size: sizes[i] })) });
  void saveSession();
}

export function equalizeGroups(): void {
  resizeGroups(get().groups.map(() => 1));
}

/** Kayitli oturumdan bolmeleri ve sekmeleri kurar (eski, tek listeli oturumlarla uyumlu). */
function restoreLayout(session: Settings["session"], existing: Set<string>): Layout {
  const ok = (p: unknown): p is string => typeof p === "string" && (p in VIEW_PATHS || existing.has(p));
  const saved =
    Array.isArray(session.groups) && session.groups.length ? session.groups : [{ tabs: session.tabs, active: session.active, size: 1 }];
  const tabs: Tab[] = [];
  const groups: Group[] = [];
  const drawings = new Set<string>();
  for (const g of saved.slice(0, MAX_GROUPS)) {
    const id = newGroupId();
    const seen = new Set<string>();
    for (const p of Array.isArray(g?.tabs) ? g.tabs : []) {
      if (!ok(p) || seen.has(p) || drawings.has(p)) continue;
      seen.add(p);
      if (isDrawing(p)) drawings.add(p);
      tabs.push(makeTab(p, id));
    }
    const own = groupTabs(tabs, id);
    const size = Number(g?.size);
    groups.push({ id, active: own.find((t) => t.path === g?.active)?.id ?? own[0]?.id ?? null, size: size > 0.01 && size < 100 ? size : 1 });
  }
  const focus = groups[Number(session.activeGroup) || 0]?.id ?? groups[0]?.id ?? "";
  return layout(tabs, groups, focus);
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
        tabs: [...new Set(s.tabs.map((t) => t.path))],
        active: s.tabs.find((t) => t.id === s.active)?.path ?? null,
        groups: s.groups.map((g) => ({
          tabs: groupTabs(s.tabs, g.id).map((t) => t.path),
          active: s.tabs.find((t) => t.id === g.active)?.path ?? null,
          size: Math.round(g.size * 1000) / 1000,
        })),
        activeGroup: Math.max(0, s.groups.findIndex((g) => g.id === s.activeGroup)),
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
    set({ notes, texts, ...layout(tabs, s.groups, s.activeGroup) });
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
  await createNote(BOARD_FILE, BOARD_TEMPLATE);
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

export const BOARD_TEMPLATE = "---\natolye: board\n---\n\n## Yapılacak\n\n## Yapılıyor\n\n## Bitti\n";

/** Yeni, bos bir gorev panosu (Kanban notu) olusturur. */
export function newBoard(folder = currentFolder()): void {
  prompt("Yeni görev panosu", "Yeni pano", async (name) => {
    const clean = sanitizeName(name) || "Yeni pano";
    await createNote(join(folder, `${clean}.md`), BOARD_TEMPLATE);
  });
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
        set({ notes, texts, dirty, ...layout(tabs, s.groups, s.activeGroup) });
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
  set({ vault, files, notes, ...layout([], [], ""), dirty: {}, modes: {}, history: [], historyIndex: -1 });
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
