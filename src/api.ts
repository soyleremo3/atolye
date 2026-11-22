export type FileEntry = { path: string; name: string; ext: string; dir: boolean; mtime: number; size: number };
export type ViewMode = "edit" | "split" | "read" | "board";
export type AgentLive = { role: string; number: string; model: string; state: "idle" | "working" | "done" | "failed" | "blocked"; lastRun: string | null; did: string; next: string; blockedOn: string };
export type AgentRole = { id: string; number: string; name: string; ad?: string; zaman?: string; agent?: boolean; model: string; team: string; schedule: string; status: "active" | "planned"; live: AgentLive | null };
export type AgentItem = { name: string; fm: Record<string, string>; body: string };
export type AgentsConfig = { repoPath: string; appPath: string };
export type AgentsSnapshot = {
  repoPath: string;
  appPath: string;
  roles: AgentRole[];
  approvals: { pending: AgentItem[]; decided: AgentItem[] };
  board: { inbox: AgentItem[]; doing: AgentItem[]; done: AgentItem[]; results: string[] };
  reports: { kind: string; name: string }[];
  state: string;
  commits: { hash: string; date: string; subject: string }[];
};
export type AgentRunEvent = { runId: string; kind: "start" | "tool" | "text" | "end"; text: string; at: number };
export type AgentRun = { id: string; role: string; started: number; ended?: number; ok?: boolean; summary?: string; events: AgentRunEvent[] };
export type HttpRequest = { method: string; url: string; headers: Record<string, string>; body?: string; timeoutMs?: number };
export type HttpResponse = {
  status?: number;
  statusText?: string;
  headers?: [string, string][];
  contentType?: string;
  size?: number;
  truncated?: boolean;
  timeMs: number;
  body?: string;
  error?: string;
};

export type Settings = {
  vaultPath: string;
  theme: "system" | "dark" | "light";
  fontSize: number;
  editorFont: "sans" | "mono";
  readableWidth: boolean;
  spellcheck: boolean;
  defaultMode: ViewMode;
  session: {
    tabs: string[];
    active: string | null;
    /** Yan yana bolmeler (yoksa tek bolme: tabs). */
    groups?: { tabs: string[]; active: string | null; size: number }[];
    activeGroup?: number;
    leftOpen: boolean;
    rightOpen: boolean;
  };
  dark: boolean;
};

type AtolyeApi = {
  settings: {
    get(): Promise<Settings>;
    set(patch: Partial<Settings>): Promise<Settings>;
    setTitlebar(bg: string, fg: string): Promise<void>;
  };
  vault: {
    info(): Promise<{ path: string; name: string }>;
    choose(): Promise<{ path: string; name: string } | null>;
    list(): Promise<FileEntry[]>;
    readAll(): Promise<Record<string, string>>;
    read(rel: string): Promise<string>;
    write(rel: string, content: string): Promise<void>;
    writeBinary(rel: string, data: Uint8Array): Promise<void>;
    unique(rel: string): Promise<string>;
    mkdir(rel: string): Promise<void>;
    rename(from: string, to: string): Promise<void>;
    trash(rel: string): Promise<void>;
    reveal(rel: string): Promise<void>;
    openFolder(): Promise<void>;
    onChanged(cb: (paths: string[]) => void): () => void;
  };
  drafts: {
    save(rel: string, content: string): Promise<void>;
    clear(rel: string): Promise<void>;
    list(): Promise<{ path: string; content: string; savedAt: number }[]>;
  };
  app: {
    openExternal(url: string): Promise<void>;
    version(): Promise<string>;
    onThemeChanged(cb: (dark: boolean) => void): () => void;
    onFlush(cb: () => void): () => void;
    flushed(): void;
  };
  http: {
    send(req: HttpRequest): Promise<HttpResponse>;
  };
  agents: {
    config(): Promise<AgentsConfig>;
    choose(which: "repo" | "app"): Promise<AgentsConfig>;
    snapshot(): Promise<AgentsSnapshot>;
    read(rel: string): Promise<string>;
    sync(): Promise<string>;
    decide(name: string, decision: "approved" | "rejected", note: string): Promise<string>;
    newTask(title: string, body: string, forWho: "claude" | "agy"): Promise<string>;
    note(text: string, roles: string): Promise<string>;
    run(role: string, task: string): Promise<string>;
    runs(): Promise<AgentRun[]>;
    stop(): Promise<boolean>;
    onEvent(cb: (e: AgentRunEvent) => void): () => void;
  };
  exporter: {
    html(html: string, name: string): Promise<boolean>;
    pdf(html: string, name: string): Promise<boolean>;
  };
};

declare global {
  interface Window {
    atolye: AtolyeApi;
    EXCALIDRAW_ASSET_PATH?: string;
    __errors?: string[];
  }
}

export const api: AtolyeApi = window.atolye;

/** Kasa dosyasinin uygulama icindeki adresi (resimler, cizimler). */
export const vaultUrl = (rel: string) => `atolye://vault/${rel.split("/").map(encodeURIComponent).join("/")}`;
