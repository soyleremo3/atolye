/** Renderer'a sadece bu dar API acilir (Node erisimi yok). */
import { contextBridge, ipcRenderer, type IpcRendererEvent } from "electron";

const invoke = (channel: string, ...args: unknown[]) => ipcRenderer.invoke(channel, ...args);

function on<T>(channel: string, cb: (value: T) => void): () => void {
  const listener = (_e: IpcRendererEvent, value: T) => cb(value);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
}

contextBridge.exposeInMainWorld("atolye", {
  settings: {
    get: () => invoke("settings:get"),
    set: (patch: unknown) => invoke("settings:set", patch),
    setTitlebar: (bg: string, fg: string) => invoke("titlebar:set", bg, fg),
  },
  vault: {
    info: () => invoke("vault:info"),
    choose: () => invoke("vault:choose"),
    list: () => invoke("vault:list"),
    readAll: () => invoke("vault:readAll"),
    read: (rel: string) => invoke("vault:read", rel),
    write: (rel: string, content: string) => invoke("vault:write", rel, content),
    writeBinary: (rel: string, data: Uint8Array) => invoke("vault:writeBinary", rel, data),
    unique: (rel: string) => invoke("vault:unique", rel),
    mkdir: (rel: string) => invoke("vault:mkdir", rel),
    rename: (from: string, to: string) => invoke("vault:rename", from, to),
    trash: (rel: string) => invoke("vault:trash", rel),
    reveal: (rel: string) => invoke("vault:reveal", rel),
    openFolder: () => invoke("vault:openFolder"),
    onChanged: (cb: (paths: string[]) => void) => on("vault:changed", cb),
  },
  app: {
    openExternal: (url: string) => invoke("app:openExternal", url),
    version: () => invoke("app:version"),
    onThemeChanged: (cb: (dark: boolean) => void) => on("theme:changed", cb),
    onFlush: (cb: () => void) => on("app:flush", cb),
    flushed: () => ipcRenderer.send("app:flushed"),
  },
  http: {
    send: (req: unknown) => invoke("http:send", req),
  },
  exporter: {
    html: (html: string, name: string) => invoke("export:html", html, name),
    pdf: (html: string, name: string) => invoke("export:pdf", html, name),
  },
});
