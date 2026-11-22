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
  history: {
    list: (rel: string) => invoke("history:list", rel),
    read: (rel: string, id: string) => invoke("history:read", rel, id),
  },
  drafts: {
    save: (rel: string, content: string) => invoke("drafts:save", rel, content),
    clear: (rel: string) => invoke("drafts:clear", rel),
    list: () => invoke("drafts:list"),
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
  agents: {
    config: () => invoke("agents:config"),
    choose: (which: "repo" | "app") => invoke("agents:choose", which),
    snapshot: () => invoke("agents:snapshot"),
    read: (rel: string) => invoke("agents:read", rel),
    sync: () => invoke("agents:sync"),
    decide: (name: string, decision: string, note: string) => invoke("agents:decide", name, decision, note),
    newTask: (title: string, body: string, forWho: string) => invoke("agents:newTask", title, body, forWho),
    note: (text: string, roles: string) => invoke("agents:note", text, roles),
    run: (role: string, task: string) => invoke("agents:run", role, task),
    runs: () => invoke("agents:runs"),
    stop: () => invoke("agents:stop"),
    onEvent: (cb: (e: unknown) => void) => on("agents:event", cb),
  },
  term: {
    profiles: () => invoke("term:profiles"),
    dirs: () => invoke("term:dirs"),
    addDir: () => invoke("term:addDir"),
    removeDir: (p: string) => invoke("term:removeDir", p),
    create: (profile: string, cwd: string, cols: number, rows: number) => invoke("term:create", profile, cwd, cols, rows),
    write: (id: number, data: string) => invoke("term:write", id, data),
    resize: (id: number, cols: number, rows: number) => invoke("term:resize", id, cols, rows),
    kill: (id: number) => invoke("term:kill", id),
    onData: (cb: (id: number, data: string) => void) => {
      const l = (_e: IpcRendererEvent, id: number, data: string) => cb(id, data);
      ipcRenderer.on("term:data", l);
      return () => ipcRenderer.removeListener("term:data", l);
    },
    onExit: (cb: (id: number, code: number) => void) => {
      const l = (_e: IpcRendererEvent, id: number, code: number) => cb(id, code);
      ipcRenderer.on("term:exit", l);
      return () => ipcRenderer.removeListener("term:exit", l);
    },
  },
  assistant: {
    ask: (question: string, scope: string, model: string) => invoke("assistant:ask", question, scope, model),
    stop: () => invoke("assistant:stop"),
    onEvent: (cb: (e: unknown) => void) => on("assistant:event", cb),
  },
  exporter: {
    html: (html: string, name: string) => invoke("export:html", html, name),
    pdf: (html: string, name: string) => invoke("export:pdf", html, name),
  },
});
