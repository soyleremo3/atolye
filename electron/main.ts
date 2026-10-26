/**
 * Atolye - Electron ana sureci.
 * Guvenlik: contextIsolation + sandbox, nodeIntegration kapali, tum dosya erisimi kasa ile sinirli,
 * uygulama sadece kendi "atolye://" protokolunden yuklenir, dis baglantilar varsayilan tarayicida acilir.
 */
import { app, BrowserWindow, dialog, ipcMain, nativeTheme, net, protocol, shell, Menu, type IpcMainInvokeEvent } from "electron";
import { promises as fs } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { Vault } from "./vault";
import { WELCOME_FILES } from "./welcome";
import { runSmoke } from "./smoke";

const SCHEME = "atolye";
const RENDERER_DIR = path.join(__dirname, "..", "dist");
const SETTINGS_FILE = () => path.join(app.getPath("userData"), "settings.json");

type Settings = {
  vaultPath: string;
  theme: "system" | "dark" | "light";
  fontSize: number;
  editorFont: "sans" | "mono";
  readableWidth: boolean;
  spellcheck: boolean;
  defaultMode: "edit" | "split" | "read";
  session: {
    tabs: string[];
    active: string | null;
    /** Yan yana bolmeler (yoksa tek bolme: tabs). */
    groups?: { tabs: string[]; active: string | null; size: number }[];
    activeGroup?: number;
    leftOpen: boolean;
    rightOpen: boolean;
  };
  window: { x?: number; y?: number; width: number; height: number; maximized: boolean };
};

const DEFAULTS: Settings = {
  vaultPath: "",
  theme: "system",
  fontSize: 16,
  editorFont: "sans",
  readableWidth: true,
  spellcheck: false,
  defaultMode: "edit",
  session: { tabs: [], active: null, leftOpen: true, rightOpen: true },
  window: { width: 1280, height: 820, maximized: false },
};

let settings: Settings = DEFAULTS;
let vault: Vault | null = null;
let win: BrowserWindow | null = null;
let saveTimer: NodeJS.Timeout | null = null;

protocol.registerSchemesAsPrivileged([
  { scheme: SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true, codeCache: true } },
]);

// Test icin ayri veri klasoru (gercek ayarlara ve notlara dokunmaz)
if (process.env.ATOLYE_USER_DATA) app.setPath("userData", process.env.ATOLYE_USER_DATA);
app.setAppUserModelId("com.soyleremo3.atolye");

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
    }
  });
  app.whenReady().then(start);
}

// ------------------------------------------------------------------ ayarlar
async function loadSettings(): Promise<void> {
  try {
    const raw = JSON.parse(await fs.readFile(SETTINGS_FILE(), "utf8"));
    settings = { ...DEFAULTS, ...raw, session: { ...DEFAULTS.session, ...raw.session }, window: { ...DEFAULTS.window, ...raw.window } };
  } catch {
    settings = { ...DEFAULTS };
  }
  if (!["system", "dark", "light"].includes(settings.theme)) settings.theme = "system";
  settings.fontSize = Math.min(24, Math.max(12, Number(settings.fontSize) || 16));
}

function saveSettingsSoon(): void {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(saveSettingsNow, 400);
}

async function saveSettingsNow(): Promise<void> {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = null;
  const file = SETTINGS_FILE();
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(`${file}.tmp`, JSON.stringify(settings, null, 2), "utf8");
  await fs.rename(`${file}.tmp`, file);
}

// ------------------------------------------------------------------ kasa
async function openVault(dir: string, seed = false): Promise<void> {
  vault?.unwatch();
  await fs.mkdir(dir, { recursive: true });
  vault = new Vault(dir);
  if (seed) {
    for (const [rel, content] of Object.entries(WELCOME_FILES)) {
      if (!(await vault.exists(rel))) await vault.writeText(rel, content);
    }
  }
  vault.watch((paths) => win?.webContents.send("vault:changed", paths));
  settings.vaultPath = vault.root;
  saveSettingsSoon();
}

function requireVault(): Vault {
  if (!vault) throw new Error("Kasa açık değil");
  return vault;
}

// ------------------------------------------------------------------ pencere
function themeColors() {
  const dark = settings.theme === "dark" || (settings.theme === "system" && nativeTheme.shouldUseDarkColors);
  return dark ? { bg: "#1b1d23", fg: "#d4d7de" } : { bg: "#f3f3f5", fg: "#33363d" };
}

function createWindow(): void {
  const { bg, fg } = themeColors();
  const w = settings.window;
  win = new BrowserWindow({
    x: w.x,
    y: w.y,
    width: w.width,
    height: w.height,
    minWidth: 720,
    minHeight: 480,
    show: false,
    backgroundColor: bg,
    title: "Atölye",
    icon: path.join(__dirname, "..", "build", "icon.png"),
    titleBarStyle: "hidden",
    titleBarOverlay: { color: bg, symbolColor: fg, height: 38 },
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webviewTag: false,
      spellcheck: settings.spellcheck,
    },
  });
  win.webContents.session.setSpellCheckerLanguages(["tr", "en-US"]);
  if (w.maximized) win.maximize();
  win.once("ready-to-show", () => win?.show());

  const remember = () => {
    if (!win || win.isMinimized()) return;
    settings.window.maximized = win.isMaximized();
    if (!win.isMaximized()) Object.assign(settings.window, win.getBounds());
    saveSettingsSoon();
  };
  win.on("resize", remember);
  win.on("move", remember);

  // Kapanmadan once renderer'daki kaydedilmemis notlari yazdir (en fazla 3 sn bekle)
  let flushed = false;
  win.on("close", (e) => {
    if (flushed || !win) return;
    e.preventDefault();
    const finish = () => {
      flushed = true;
      win?.close();
    };
    const timeout = setTimeout(finish, 3000);
    ipcMain.once("app:flushed", () => {
      clearTimeout(timeout);
      finish();
    });
    win.webContents.send("app:flush");
  });

  // Uygulama disina gezinme ve yeni pencere yok; http(s) baglantilari tarayicida acilir
  win.webContents.setWindowOpenHandler(({ url }) => {
    openExternalSafe(url);
    return { action: "deny" };
  });
  win.webContents.on("will-navigate", (e, url) => {
    if (!url.startsWith(`${SCHEME}://app/`)) {
      e.preventDefault();
      openExternalSafe(url);
    }
  });
  win.loadURL(`${SCHEME}://app/index.html`);
  if (process.env.ATOLYE_SMOKE) win.webContents.once("did-finish-load", () => void runSmoke(win!, process.env.ATOLYE_SMOKE!));
}

function openExternalSafe(url: string): void {
  try {
    const u = new URL(url);
    if (["http:", "https:", "mailto:"].includes(u.protocol)) void shell.openExternal(u.toString());
  } catch {
    /* gecersiz URL */
  }
}

function serveFile(base: string, rel: string): Promise<Response> | Response {
  const abs = path.resolve(base, rel);
  const relCheck = path.relative(base, abs);
  if (!relCheck || relCheck.startsWith("..") || path.isAbsolute(relCheck)) return new Response("Bad path", { status: 400 });
  const mime = MIME[path.extname(abs).toLowerCase()];
  if (!mime) return net.fetch(pathToFileURL(abs).toString());
  return net.fetch(pathToFileURL(abs).toString()).then(
    (res) => new Response(res.body, { status: res.status, headers: { "content-type": mime } }),
  );
}

const MIME: Record<string, string> = { ".woff2": "font/woff2", ".woff": "font/woff", ".ttf": "font/ttf", ".svg": "image/svg+xml" };

// ------------------------------------------------------------------ IPC
type Handler = (...args: any[]) => any;
function handle(channel: string, fn: Handler): void {
  ipcMain.handle(channel, (event: IpcMainInvokeEvent, ...args: any[]) => {
    if (!event.senderFrame || !event.senderFrame.url.startsWith(`${SCHEME}://app/`)) throw new Error("Yetkisiz istek");
    return fn(...args);
  });
}

function registerIpc(): void {
  handle("settings:get", () => ({ ...settings, dark: nativeTheme.shouldUseDarkColors }));
  handle("settings:set", (patch: Partial<Settings>) => {
    const allowed: (keyof Settings)[] = ["theme", "fontSize", "editorFont", "readableWidth", "spellcheck", "defaultMode", "session"];
    for (const key of allowed) if (patch && key in patch) (settings as any)[key] = (patch as any)[key];
    if (patch?.theme) {
      nativeTheme.themeSource = settings.theme;
      const { bg, fg } = themeColors();
      win?.setTitleBarOverlay({ color: bg, symbolColor: fg, height: 38 });
      win?.setBackgroundColor(bg);
    }
    if (patch && "spellcheck" in patch) win?.webContents.session.setSpellCheckerEnabled(!!settings.spellcheck);
    saveSettingsSoon();
    return { ...settings, dark: nativeTheme.shouldUseDarkColors };
  });
  handle("titlebar:set", (bg: string, fg: string) => {
    if (/^#[0-9a-f]{6}$/i.test(bg) && /^#[0-9a-f]{6}$/i.test(fg)) win?.setTitleBarOverlay({ color: bg, symbolColor: fg, height: 38 });
  });

  handle("vault:info", () => ({ path: requireVault().root, name: path.basename(requireVault().root) }));
  handle("vault:choose", async () => {
    const res = await dialog.showOpenDialog(win!, { title: "Kasa klasörü seç", properties: ["openDirectory", "createDirectory"] });
    if (res.canceled || !res.filePaths[0]) return null;
    await openVault(res.filePaths[0]);
    return { path: vault!.root, name: path.basename(vault!.root) };
  });
  handle("vault:list", () => requireVault().list());
  handle("vault:readAll", () => requireVault().readAll());
  handle("vault:read", (rel: string) => requireVault().readText(rel));
  handle("vault:write", (rel: string, content: string) => requireVault().writeText(rel, content));
  handle("vault:writeBinary", (rel: string, data: Uint8Array) => {
    if (!(data instanceof Uint8Array) || data.byteLength > 50 * 1024 * 1024) throw new Error("Geçersiz veri");
    return requireVault().writeBinary(rel, data);
  });
  handle("vault:unique", (rel: string) => requireVault().unique(rel));
  handle("vault:mkdir", (rel: string) => requireVault().mkdir(rel));
  handle("vault:rename", (from: string, to: string) => requireVault().rename(from, to));
  handle("vault:trash", async (rel: string) => {
    const abs = requireVault().resolve(rel);
    if (abs === requireVault().root) throw new Error("Kasa kökü silinemez");
    await shell.trashItem(abs);
  });
  handle("vault:reveal", (rel: string) => shell.showItemInFolder(requireVault().resolve(rel || ".")));
  handle("vault:openFolder", () => shell.openPath(requireVault().root));
  handle("app:openExternal", (url: string) => openExternalSafe(url));
  handle("http:send", sendHttp);
  handle("app:version", () => app.getVersion());

  handle("export:html", async (html: string, name: string) => {
    const res = await dialog.showSaveDialog(win!, {
      title: "HTML olarak dışa aktar",
      defaultPath: `${safeName(name)}.html`,
      filters: [{ name: "HTML", extensions: ["html"] }],
    });
    if (res.canceled || !res.filePath) return false;
    await fs.writeFile(res.filePath, String(html), "utf8");
    return true;
  });
  handle("export:pdf", async (html: string, name: string) => {
    const res = await dialog.showSaveDialog(win!, {
      title: "PDF olarak dışa aktar",
      defaultPath: `${safeName(name)}.pdf`,
      filters: [{ name: "PDF", extensions: ["pdf"] }],
    });
    if (res.canceled || !res.filePath) return false;
    const printer = new BrowserWindow({
      show: false,
      webPreferences: { sandbox: true, contextIsolation: true, javascript: false },
    });
    try {
      const tmp = path.join(app.getPath("temp"), `atolye-export-${Date.now()}.html`);
      await fs.writeFile(tmp, String(html), "utf8");
      await printer.loadFile(tmp);
      const pdf = await printer.webContents.printToPDF({ printBackground: true, pageSize: "A4", margins: { top: 0.6, bottom: 0.6, left: 0.6, right: 0.6 } });
      await fs.writeFile(res.filePath, pdf);
      await fs.rm(tmp, { force: true });
    } finally {
      printer.destroy();
    }
    return true;
  });
}

// ------------------------------------------------------------------ HTTP istemcisi (sadece kullanici "Gonder"e basinca)
type HttpRequest = { method: string; url: string; headers: Record<string, string>; body?: string; timeoutMs?: number };
const METHODS = new Set(["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"]);
const MAX_RESPONSE = 5 * 1024 * 1024;

async function sendHttp(req: HttpRequest) {
  const started = Date.now();
  const method = String(req?.method || "GET").toUpperCase();
  if (!METHODS.has(method)) return { error: `Desteklenmeyen yöntem: ${method}`, timeMs: 0 };
  let url: URL;
  try {
    url = new URL(String(req.url || "").trim());
  } catch {
    return { error: "Geçersiz adres (URL)", timeMs: 0 };
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return { error: "Sadece http ve https adresleri desteklenir", timeMs: 0 };
  const headers: Record<string, string> = {};
  for (const [k, v] of Object.entries(req.headers || {})) {
    if (typeof k === "string" && typeof v === "string" && /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(k)) headers[k] = v;
  }
  const body = typeof req.body === "string" && req.body.length && !["GET", "HEAD"].includes(method) ? req.body : undefined;
  if (body && body.length > 20 * 1024 * 1024) return { error: "Gövde çok büyük (20 MB sınırı)", timeMs: 0 };
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), Math.min(120_000, Math.max(1_000, Number(req.timeoutMs) || 30_000)));
  try {
    const res = await net.fetch(url.toString(), { method, headers, body, signal: ctrl.signal, redirect: "follow" });
    const chunks: Uint8Array[] = [];
    let size = 0;
    let truncated = false;
    if (res.body) {
      const reader = res.body.getReader();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > MAX_RESPONSE) {
          truncated = true;
          chunks.push(value.subarray(0, value.byteLength - (size - MAX_RESPONSE)));
          await reader.cancel();
          break;
        }
        chunks.push(value);
      }
    }
    const buf = Buffer.concat(chunks);
    const type = res.headers.get("content-type") || "";
    const textual = !type || /text|json|xml|javascript|html|csv|yaml|x-www-form-urlencoded|graphql/i.test(type);
    return {
      status: res.status,
      statusText: res.statusText,
      headers: [...res.headers.entries()],
      contentType: type,
      size,
      truncated,
      timeMs: Date.now() - started,
      body: textual ? buf.toString("utf8") : `(${buf.length.toLocaleString("tr")} bayt ikili veri — ${type})`,
    };
  } catch (e) {
    const aborted = (e as Error)?.name === "AbortError";
    return { error: aborted ? "Zaman aşımı: sunucu yanıt vermedi" : String((e as Error)?.message || e), timeMs: Date.now() - started };
  } finally {
    clearTimeout(timer);
  }
}

function safeName(name: string): string {
  return String(name || "not").replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_").slice(0, 120);
}

// ------------------------------------------------------------------ baslangic
async function start(): Promise<void> {
  Menu.setApplicationMenu(null);
  await loadSettings();
  nativeTheme.themeSource = settings.theme;

  protocol.handle(SCHEME, (req) => {
    const url = new URL(req.url);
    const rel = decodeURIComponent(url.pathname).replace(/^\/+/, "");
    if (url.host === "app") return serveFile(RENDERER_DIR, rel || "index.html");
    if (url.host === "vault" && vault) {
      try {
        return net.fetch(pathToFileURL(vault.resolve(rel)).toString());
      } catch {
        return new Response("Bad path", { status: 400 });
      }
    }
    return new Response("Not found", { status: 404 });
  });

  const first = !settings.vaultPath;
  const dir = settings.vaultPath || process.env.ATOLYE_VAULT || path.join(app.getPath("documents"), "Atölye");
  try {
    await openVault(dir, first);
  } catch {
    await openVault(path.join(app.getPath("documents"), "Atölye"), true);
  }
  registerIpc();
  createWindow();

  nativeTheme.on("updated", () => win?.webContents.send("theme:changed", nativeTheme.shouldUseDarkColors));
  app.on("window-all-closed", () => app.quit());
  app.on("before-quit", () => {
    vault?.unwatch();
    void saveSettingsNow();
  });
}

// Disaridan gelen tum web iceriklerinde ek koruma
app.on("web-contents-created", (_e, contents) => {
  contents.on("will-attach-webview", (e) => e.preventDefault());
});
