/**
 * Kasa (vault) dosya islemleri. Tum yollar kasa kokune gore goreli, "/" ayiricili.
 * Her islem resolveInVault ile kasa disina cikmayi engeller.
 */
import { promises as fs, watch, type FSWatcher } from "node:fs";
import path from "node:path";

export type Entry = { path: string; name: string; ext: string; dir: boolean; mtime: number; size: number };

const IGNORED = new Set([".git", ".obsidian", ".trash", "node_modules", ".atolye"]);
const BAD_CHARS = /[<>:"|?*\u0000-\u001f]/;
const RESERVED = /^(con|prn|aux|nul|com\d|lpt\d)(\..*)?$/i;
export const TEXT_EXTS = new Set([".md", ".excalidraw", ".txt"]);
const MAX_TEXT_BYTES = 20 * 1024 * 1024;

export class Vault {
  root: string;
  private watcher: FSWatcher | null = null;
  private recentWrites = new Map<string, number>();

  constructor(root: string) {
    this.root = path.resolve(root);
  }

  /** Goreli yolu kasa icinde mutlak yola cevirir; kacis veya gecersiz ad varsa hata atar. */
  resolve(rel: string): string {
    if (typeof rel !== "string") throw new Error("Geçersiz yol");
    const clean = rel.replace(/\\/g, "/").replace(/^\/+/, "");
    for (const part of clean.split("/").filter(Boolean)) {
      if (part === "." || part === ".." || BAD_CHARS.test(part) || RESERVED.test(part) || /[. ]$/.test(part)) {
        throw new Error(`Geçersiz dosya adı: ${part}`);
      }
    }
    const abs = path.resolve(this.root, clean);
    const relCheck = path.relative(this.root, abs);
    if (relCheck.startsWith("..") || path.isAbsolute(relCheck)) throw new Error("Kasa dışına erişim engellendi");
    return abs;
  }

  toRel(abs: string): string {
    return path.relative(this.root, abs).split(path.sep).join("/");
  }

  async list(): Promise<Entry[]> {
    const out: Entry[] = [];
    const walk = async (dir: string) => {
      let items;
      try {
        items = await fs.readdir(dir, { withFileTypes: true });
      } catch {
        return;
      }
      await Promise.all(
        items.map(async (it) => {
          if (it.name.startsWith(".") || IGNORED.has(it.name)) return;
          const abs = path.join(dir, it.name);
          try {
            const st = await fs.stat(abs);
            const isDir = st.isDirectory();
            out.push({
              path: this.toRel(abs),
              name: it.name,
              ext: isDir ? "" : path.extname(it.name).toLowerCase(),
              dir: isDir,
              mtime: st.mtimeMs,
              size: st.size,
            });
            if (isDir) await walk(abs);
          } catch {
            /* silinmis olabilir */
          }
        }),
      );
    };
    await walk(this.root);
    return out;
  }

  async readText(rel: string): Promise<string> {
    const abs = this.resolve(rel);
    const st = await fs.stat(abs);
    if (st.size > MAX_TEXT_BYTES) throw new Error("Dosya çok büyük");
    return fs.readFile(abs, "utf8");
  }

  /** Tum metin notlarini tek seferde okur (baslangic indeksi icin). */
  async readAll(): Promise<Record<string, string>> {
    const entries = await this.list();
    const out: Record<string, string> = {};
    await Promise.all(
      entries
        .filter((e) => !e.dir && e.ext === ".md" && e.size <= MAX_TEXT_BYTES)
        .map(async (e) => {
          try {
            out[e.path] = await fs.readFile(this.resolve(e.path), "utf8");
          } catch {
            /* yoksay */
          }
        }),
    );
    return out;
  }

  private mark(abs: string) {
    this.recentWrites.set(abs, Date.now());
  }

  async writeText(rel: string, content: string): Promise<void> {
    if (typeof content !== "string") throw new Error("Geçersiz içerik");
    const abs = this.resolve(rel);
    await fs.mkdir(path.dirname(abs), { recursive: true });
    const tmp = `${abs}.${process.pid}.tmp`;
    this.mark(abs);
    await fs.writeFile(tmp, content, "utf8");
    await fs.rename(tmp, abs);
  }

  async writeBinary(rel: string, data: Uint8Array): Promise<void> {
    const abs = this.resolve(rel);
    await fs.mkdir(path.dirname(abs), { recursive: true });
    this.mark(abs);
    await fs.writeFile(abs, data);
  }

  async exists(rel: string): Promise<boolean> {
    try {
      await fs.access(this.resolve(rel));
      return true;
    } catch {
      return false;
    }
  }

  /** "Ad.md" varsa "Ad 1.md", "Ad 2.md"... dondurur. */
  async unique(rel: string): Promise<string> {
    if (!(await this.exists(rel))) return rel;
    const ext = path.posix.extname(rel);
    const base = rel.slice(0, rel.length - ext.length);
    for (let i = 1; i < 10000; i++) {
      const candidate = `${base} ${i}${ext}`;
      if (!(await this.exists(candidate))) return candidate;
    }
    throw new Error("Benzersiz ad bulunamadı");
  }

  async mkdir(rel: string): Promise<void> {
    await fs.mkdir(this.resolve(rel), { recursive: true });
  }

  async rename(from: string, to: string): Promise<void> {
    const a = this.resolve(from);
    const b = this.resolve(to);
    if (a === this.root || b === this.root) throw new Error("Kasa kökü taşınamaz");
    if (a.toLowerCase() !== b.toLowerCase() && (await this.exists(to))) throw new Error("Bu adda bir dosya zaten var");
    await fs.mkdir(path.dirname(b), { recursive: true });
    this.mark(a);
    this.mark(b);
    await fs.rename(a, b);
  }

  watch(onChange: (paths: string[]) => void): void {
    this.unwatch();
    let pending = new Set<string>();
    let timer: NodeJS.Timeout | null = null;
    try {
      this.watcher = watch(this.root, { recursive: true }, (_event, file) => {
        if (!file) return;
        const abs = path.join(this.root, file.toString());
        const last = this.recentWrites.get(abs);
        if (last && Date.now() - last < 1500) return; // kendi yazdigimiz degisiklik
        const rel = this.toRel(abs);
        if (rel.split("/").some((p) => p.startsWith(".") || IGNORED.has(p)) || rel.endsWith(".tmp")) return;
        pending.add(rel);
        if (timer) clearTimeout(timer);
        timer = setTimeout(() => {
          const batch = [...pending];
          pending = new Set();
          onChange(batch);
        }, 200);
      });
      this.watcher.on("error", () => this.unwatch());
    } catch {
      this.watcher = null;
    }
  }

  unwatch(): void {
    this.watcher?.close();
    this.watcher = null;
  }
}
