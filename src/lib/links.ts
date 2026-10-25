/** Not icerigini ayristirma: wiki baglantilari, etiketler, basliklar. Kod bloklari yok sayilir. */
import { basename, extname, isNote, stripExt } from "./paths";

export type WikiLink = { target: string; heading?: string; alias?: string; embed: boolean; line: number };
export type Heading = { level: number; text: string; line: number };
export type Parsed = { links: WikiLink[]; tags: string[]; headings: Heading[]; words: number };

const WIKI = /(!?)\[\[([^[\]\n]+?)\]\]/g;
const MD_LINK = /\[[^\]\n]*\]\(([^)\s]+\.md)(?:#[^)]*)?\)/g;
const TAG = /(^|[\s(,;])#([\p{L}\p{N}_\-/]*[\p{L}_\-/][\p{L}\p{N}_\-/]*)/gu;
const HEADING = /^(#{1,6})\s+(.+?)\s*#*\s*$/;
const FENCE = /^\s*(```|~~~)/;

export function splitTarget(raw: string): { target: string; heading?: string; alias?: string } {
  const [left, alias] = raw.split("|", 2);
  const [target, heading] = left.split("#", 2);
  return { target: target.trim(), heading: heading?.trim() || undefined, alias: alias?.trim() || undefined };
}

export function parseNote(src: string): Parsed {
  const links: WikiLink[] = [];
  const tags = new Set<string>();
  const headings: Heading[] = [];
  let words = 0;
  let inFence = false;
  let inFrontmatter = false;
  const lines = src.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    if (i === 0 && raw.trim() === "---") {
      inFrontmatter = true;
      continue;
    }
    if (inFrontmatter) {
      if (raw.trim() === "---") inFrontmatter = false;
      const m = raw.match(/^tags:\s*\[?(.+?)\]?\s*$/);
      if (m) m[1].split(/[,\s]+/).filter(Boolean).forEach((t) => tags.add(t.replace(/^#/, "")));
      continue;
    }
    if (FENCE.test(raw)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    const line = raw.replace(/`[^`\n]*`/g, " ");
    words += (line.match(/[\p{L}\p{N}]+/gu) || []).length;
    const h = line.match(HEADING);
    if (h) headings.push({ level: h[1].length, text: h[2].replace(/\[\[([^\]|]+\|)?([^\]]+)\]\]/g, "$2"), line: i });
    for (const m of line.matchAll(WIKI)) links.push({ ...splitTarget(m[2]), embed: m[1] === "!", line: i });
    for (const m of line.matchAll(MD_LINK)) {
      try {
        links.push({ target: decodeURIComponent(m[1]), embed: false, line: i });
      } catch {
        /* bozuk kodlama */
      }
    }
    if (!h) for (const m of line.matchAll(TAG)) tags.add(m[2]);
    else for (const m of h[2].matchAll(TAG)) tags.add(m[2]);
  }
  return { links, tags: [...tags], headings, words };
}

/** Baglanti hedefini kasadaki gercek yola cevirir (Obsidian kurallari: once tam yol, sonra dosya adi). */
export class Resolver {
  private byPath = new Map<string, string>();
  private byName = new Map<string, string[]>();

  constructor(paths: string[]) {
    for (const p of paths) {
      this.byPath.set(p.toLowerCase(), p);
      if (isNote(p)) this.byPath.set(stripExt(p).toLowerCase(), p);
      for (const key of [basename(p).toLowerCase(), isNote(p) ? stripExt(basename(p)).toLowerCase() : null]) {
        if (!key) continue;
        const arr = this.byName.get(key) || [];
        arr.push(p);
        this.byName.set(key, arr);
      }
    }
    for (const arr of this.byName.values()) arr.sort((a, b) => a.split("/").length - b.split("/").length || a.length - b.length);
  }

  resolve(target: string): string | null {
    if (!target) return null;
    const t = target.replace(/\\/g, "/").replace(/^\.?\//, "").toLowerCase();
    const direct = this.byPath.get(t) ?? (extname(t) ? null : this.byPath.get(`${t}.md`));
    if (direct) return direct;
    const name = basename(t);
    const hit = this.byName.get(name) ?? (extname(name) ? undefined : this.byName.get(`${name}.md`));
    return hit?.[0] ?? null;
  }
}

/** Yeniden adlandirmada icerikteki [[eski]] baglantilarini [[yeni]] yapar. */
export function rewriteLinks(src: string, isOld: (target: string) => boolean, newTarget: string): string {
  return src.replace(WIKI, (all, bang: string, inner: string) => {
    const { target, heading, alias } = splitTarget(inner);
    if (!isOld(target)) return all;
    return `${bang}[[${newTarget}${heading ? `#${heading}` : ""}${alias ? `|${alias}` : ""}]]`;
  });
}
