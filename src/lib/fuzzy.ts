/** Basit, hizli bulanik eslestirme: harfler sirayla geciyorsa puanlar (ardisik ve kelime basi bonuslu). */
const fold = (s: string) =>
  s.toLocaleLowerCase("tr").normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/ı/g, "i");

export function fuzzyScore(query: string, text: string): number {
  if (!query) return 1;
  const q = fold(query);
  const t = fold(text);
  const exact = t.indexOf(q);
  if (exact >= 0) return 1000 - exact - t.length * 0.1 + (exact === 0 || /[\s/_-]/.test(t[exact - 1]) ? 200 : 0);
  let score = 0;
  let ti = 0;
  let streak = 0;
  for (const ch of q) {
    if (ch === " ") continue;
    const found = t.indexOf(ch, ti);
    if (found < 0) return -1;
    streak = found === ti ? streak + 1 : 0;
    score += 10 + streak * 6 + (found === 0 || /[\s/_-]/.test(t[found - 1]) ? 12 : 0) - Math.min(found - ti, 8);
    ti = found + 1;
  }
  return score - t.length * 0.05;
}

export function fuzzyFilter<T>(query: string, items: T[], key: (item: T) => string, limit = 60): T[] {
  if (!query.trim()) return items.slice(0, limit);
  return items
    .map((item) => ({ item, s: fuzzyScore(query, key(item)) }))
    .filter((x) => x.s >= 0)
    .sort((a, b) => b.s - a.s)
    .slice(0, limit)
    .map((x) => x.item);
}
