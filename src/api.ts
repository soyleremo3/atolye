export type FileEntry = { path: string; name: string; ext: string; dir: boolean; mtime: number; size: number };
export type ViewMode = "edit" | "split" | "read" | "board";
export type AgentLive = { role: string; number: string; model: string; state: "idle" | "working" | "done" | "failed" | "blocked"; lastRun: string | null; did: string; next: string; blockedOn: string; source?: "antigravity" };
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
export type RepoSync = { ok: boolean; text: string; at: string };
export type SyncStatus = { agents: RepoSync; app: RepoSync | null; saved: number; at: string };
export type RobotView = { id: string; ad: string; where: "cloud" | "pc"; cron: string; model: string; what: string; next: string | null; last: string | null; live: AgyRun | null };
export type AgyRun = { sidecar: string; name: string; state: "running" | "done" | "failed"; started: string; updated: string; model: string | null; note: string };
export type ReportItem = { rel: string; title: string; kind: string; origin: "cloud" | "pc"; pending: boolean; date: string };
export type GhIssue = { number: number; title: string; labels: string[]; updatedAt: string; url: string; repo: "app" | "agents" };
export type GhInfo = { ok: boolean; error?: string; issues: GhIssue[]; release: { tag: string; date: string; url: string } | null; ci: { name: string; title: string; status: string; conclusion: string; date: string; url: string }[]; ciNote?: string };
export type AgentRun = { id: string; role: string; started: number; ended?: number; ok?: boolean; summary?: string; events: AgentRunEvent[] };
export type TermProfile = { id: string; name: string; available: boolean };
export type TermDir = { id: string; name: string; path: string; group: string; removable?: boolean };
export type AskEvent = { askId: string; kind: "step" | "answer" | "end" | "error"; text: string };
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
    /** Acik klasorler ve panellerde secili bolum (kapanip acilinca ayni gelsin). */
    expanded?: string[];
    leftView?: "files" | "search" | "tags";
    rightView?: "outline" | "links" | "props";
  };
  dark: boolean;
  bookmarks?: string[];
  /** Renk temasi ve istege bagli vurgu rengi (#rrggbb, bos = temanin kendi rengi). */
  palette?: "kum" | "okyanus" | "orman" | "lavanta" | "klasik";
  accent?: string;
  openAtLogin?: boolean;
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
  history: {
    list(rel: string): Promise<{ id: string; savedAt: number; size: number }[]>;
    read(rel: string, id: string): Promise<string>;
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
  term: {
    profiles(): Promise<TermProfile[]>;
    dirs(): Promise<TermDir[]>;
    addDir(): Promise<{ dirs: TermDir[]; added: string }>;
    removeDir(path: string): Promise<TermDir[]>;
    create(profile: string, cwd: string, cols: number, rows: number): Promise<number>;
    write(id: number, data: string): Promise<void>;
    resize(id: number, cols: number, rows: number): Promise<void>;
    kill(id: number): Promise<void>;
    onData(cb: (id: number, data: string) => void): () => void;
    onExit(cb: (id: number, code: number) => void): () => void;
  };
  hub: {
    status(): Promise<SyncStatus | null>;
    robots(): Promise<RobotView[]>;
    reports(): Promise<ReportItem[]>;
    github(force: boolean): Promise<GhInfo>;
    issue(repo: "app" | "agents", n: number): Promise<string>;
    openApp(which: "antigravity" | "claudeUsage" | "claudeRoutines" | "github"): Promise<boolean>;
    openUrl(url: string): Promise<boolean>;
    onSynced(cb: (s: SyncStatus) => void): () => void;
  };
  assistant: {
    ask(question: string, scope: "notes" | "vault", model: "haiku" | "sonnet" | "opus"): Promise<string>;
    stop(): Promise<boolean>;
    onEvent(cb: (e: AskEvent) => void): () => void;
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
