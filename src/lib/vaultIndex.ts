/**
 * Kasa indeksi: geri baglantilar, etiketler, basliklar ve tam metin arama.
 * Not basina ayristirma onbellekte tutulur; sadece degisen notlar yeniden ayristirilir.
 */
import MiniSearch from "minisearch";
import { parseNote, Resolver, type Parsed } from "./links";
import { title } from "./paths";

export type Backlink = { from: string; line: number; text: string };

export type VaultIndex = {
  resolver: Resolver;
  parsed: Map<string, Parsed>;
  outgoing: Map<string, string[]>;
  backlinks: Map<string, Backlink[]>;
  unresolved: Map<string, string[]>;
  tags: Map<string, string[]>;
};

const cache = new Map<string, { src: string; parsed: Parsed }>();

const fold = (s: string) => s.toLocaleLowerCase("tr").normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/ı/g, "i");

const search = new MiniSearch<{ id: string; title: string; content: string }>({
  fields: ["title", "content"],
  storeFields: ["title"],
  processTerm: (term) => fold(term),
  searchOptions: { boost: { title: 3 }, prefix: true, fuzzy: 0.15, combineWith: "AND", processTerm: (t) => fold(t) },
});
const indexed = new Map<string, string>();

export function parsedOf(path: string, src: string): Parsed {
  const hit = cache.get(path);
  if (hit && hit.src === src) return hit.parsed;
  const parsed = parseNote(src);
  cache.set(path, { src, parsed });
  return parsed;
}

export function buildIndex(notes: Record<string, string>, allPaths: string[]): VaultIndex {
  const resolver = new Resolver(allPaths);
  const parsed = new Map<string, Parsed>();
  const outgoing = new Map<string, string[]>();
  const backlinks = new Map<string, Backlink[]>();
  const unresolved = new Map<string, string[]>();
  const tags = new Map<string, string[]>();

  for (const [path, src] of Object.entries(notes)) {
    const p = parsedOf(path, src);
    parsed.set(path, p);
    const out = new Set<string>();
    const lines = p.links.length ? src.split("\n") : [];
    for (const link of p.links) {
      const target = resolver.resolve(link.target);
      if (!target) {
        const arr = unresolved.get(link.target) || [];
        arr.push(path);
        unresolved.set(link.target, arr);
        continue;
      }
      if (target === path) continue;
      out.add(target);
      const arr = backlinks.get(target) || [];
      arr.push({ from: path, line: link.line, text: (lines[link.line] || "").trim().slice(0, 200) });
      backlinks.set(target, arr);
    }
    outgoing.set(path, [...out]);
    for (const tag of p.tags) {
      const arr = tags.get(tag) || [];
      arr.push(path);
      tags.set(tag, arr);
    }
  }
  for (const key of cache.keys()) if (!(key in notes)) cache.delete(key);
  syncSearch(notes);
  return { resolver, parsed, outgoing, backlinks, unresolved, tags };
}

function syncSearch(notes: Record<string, string>): void {
  for (const id of [...indexed.keys()]) {
    if (!(id in notes)) {
      search.discard(id);
      indexed.delete(id);
    }
  }
  for (const [id, content] of Object.entries(notes)) {
    if (indexed.get(id) === content) continue;
    if (indexed.has(id)) search.discard(id);
    search.add({ id, title: title(id), content });
    indexed.set(id, content);
  }
}

export type SearchHit = { path: string; score: number; snippet: string; line: number };

export function searchNotes(query: string, notes: Record<string, string>, limit = 80): SearchHit[] {
  const q = query.trim();
  if (!q) return [];
  if (q.startsWith("#") && q.length > 1) {
    const tag = q.slice(1).toLowerCase();
    return Object.keys(notes)
      .filter((p) => parsedOf(p, notes[p]).tags.some((t) => t.toLowerCase() === tag || t.toLowerCase().startsWith(`${tag}/`)))
      .map((p) => ({ path: p, score: 1, ...snippetFor(notes[p], `#${tag}`) }));
  }
  return search
    .search(q)
    .slice(0, limit)
    .map((r) => ({ path: r.id as string, score: r.score, ...snippetFor(notes[r.id as string] || "", q) }));
}

function snippetFor(src: string, query: string): { snippet: string; line: number } {
  const terms = fold(query).split(/\s+/).filter(Boolean);
  const lines = src.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const f = fold(lines[i]);
    const pos = terms.map((t) => f.indexOf(t)).find((x) => x >= 0);
    if (pos !== undefined && pos >= 0) {
      const start = Math.max(0, pos - 50);
      return { snippet: (start ? "…" : "") + lines[i].slice(start, start + 160).trim(), line: i };
    }
  }
  return { snippet: lines.find((l) => l.trim() && !l.startsWith("#"))?.slice(0, 160) || "", line: 0 };
}
