export const basename = (p: string) => p.slice(p.lastIndexOf("/") + 1);
export const dirname = (p: string) => (p.includes("/") ? p.slice(0, p.lastIndexOf("/")) : "");
export const extname = (p: string) => {
  const b = basename(p);
  const i = b.lastIndexOf(".");
  return i > 0 ? b.slice(i).toLowerCase() : "";
};
export const join = (...parts: string[]) => parts.filter(Boolean).join("/").replace(/\/+/g, "/");
/** "Klasor/Not.md" -> "Not" */
export const title = (p: string) => {
  const b = basename(p);
  const e = extname(b);
  return e ? b.slice(0, -e.length) : b;
};
export const stripExt = (p: string) => {
  const e = extname(p);
  return e ? p.slice(0, -e.length) : p;
};

export const IMAGE_EXTS = new Set([".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg", ".bmp", ".avif"]);
export const isNote = (p: string) => extname(p) === ".md";
export const isDrawing = (p: string) => extname(p) === ".excalidraw";
export const isImage = (p: string) => IMAGE_EXTS.has(extname(p));

/** Dosya adinda Windows'un kabul etmedigi karakterleri temizler. */
export function sanitizeName(name: string): string {
  return name
    .replace(/[<>:"/\\|?*\u0000-\u001f#^[\]]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[. ]+$/, "")
    .slice(0, 150);
}

export function todayStamp(d = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function timeStamp(d = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${todayStamp(d)} ${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

/** Kod / metin dosyasi olarak kod editorunde acilan uzantilar. */
export const CODE_EXTS = new Set([
  ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".json", ".jsonc", ".py", ".cs", ".java", ".kt", ".go", ".rs", ".c", ".h",
  ".cpp", ".hpp", ".cc", ".swift", ".rb", ".php", ".dart", ".lua", ".r", ".scala", ".sql", ".sh", ".bash", ".ps1", ".psm1",
  ".bat", ".cmd", ".css", ".scss", ".less", ".html", ".htm", ".xml", ".svg", ".yml", ".yaml", ".toml", ".ini", ".cfg", ".conf",
  ".env", ".txt", ".csv", ".log", ".dockerfile", ".gradle", ".vue", ".svelte", ".graphql", ".gql", ".proto", ".tf", ".zig",
]);
export const isCode = (p: string) => CODE_EXTS.has(extname(p)) || /^(dockerfile|makefile|\.gitignore|\.editorconfig)$/i.test(basename(p));
export const isHttp = (p: string) => extname(p) === ".http" || extname(p) === ".rest";

/** Not ust bilgisinde "atolye: board" varsa gorev panosu olarak acilir. */
export function isBoardNote(src: string | undefined): boolean {
  if (!src?.startsWith("---")) return false;
  const end = src.indexOf("\n---", 3);
  return end > 0 && /^atolye:\s*board\s*$/m.test(src.slice(3, end));
}

export const SNIPPET_DIR = "Parçalar";
export const REQUEST_DIR = "İstekler";
export const BOARD_FILE = "Görevler.md";
