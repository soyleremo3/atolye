export type FileEntry = { path: string; name: string; ext: string; dir: boolean; mtime: number; size: number };
export type ViewMode = "edit" | "split" | "read" | "board";
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
