/**
 * Markdown tabanli gorev panosu (Kanban).
 *   ## Sutun basligi
 *   - [ ] Kart metni #etiket
 *   - [x] Bitmis kart
 *   ### Satir basligi
 *   - [ ] Bu satirdaki kart
 * Satirlar (### basliklari) tum sutunlarda ortaktir: pano sutun x satir izgarasi olarak gosterilir.
 * Ilk ### basligindan onceki kartlar satirsizdir (row: ""). Bos satirlar her sutuna yazilarak korunur.
 * Ust bilgi (frontmatter) ve ilk basliktan onceki metin korunur; sutun icindeki kart olmayan satirlar da korunur.
 */
export type Card = { id: string; text: string; done: boolean; row: string };
export type Column = { id: string; title: string; cards: Card[]; extra: string[] };
export type Board = { front: string; preamble: string; columns: Column[]; rows: string[] };


const CARD = /^\s*[-*+]\s+\[([ xX])\]\s?(.*)$/;
const PLAIN_ITEM = /^\s*[-*+]\s+(.+)$/;
export const isDoneColumn = (title: string) => /bitt|tamam|done|complete/i.test(title);

export function parseBoard(src: string): Board {
  let body = src;
  let front = "";
  if (src.startsWith("---")) {
    const end = src.indexOf("\n---", 3);
    if (end > 0) {
      const after = src.indexOf("\n", end + 4);
      front = src.slice(0, after < 0 ? src.length : after + 1);
      body = after < 0 ? "" : src.slice(after + 1);
    }
  }
  const lines = body.split("\n");
  const columns: Column[] = [];
  const rows: string[] = [];
  const pre: string[] = [];
  let col: Column | null = null;
  let row = "";
  for (const line of lines) {
    const h = line.match(/^##\s+(.+?)\s*$/);
    if (h) {
      // Konuma bagli kararli kimlikler: icerik yeniden ayristirilinca da ayni kalir
      col = { id: `c${columns.length}`, title: h[1], cards: [], extra: [] };
      columns.push(col);
      row = "";
      continue;
    }
    if (!col) {
      pre.push(line);
      continue;
    }
    const r = line.match(/^###\s+(.+?)\s*$/);
    if (r) {
      row = r[1];
      if (!rows.includes(row)) rows.push(row);
      continue;
    }
    const m = line.match(CARD);
    if (m) {
      col.cards.push({ id: `${col.id}k${col.cards.length}`, text: m[2], done: m[1] !== " ", row });
      continue;
    }
    const p = line.match(PLAIN_ITEM);
    if (p) {
      col.cards.push({ id: `${col.id}k${col.cards.length}`, text: p[1], done: isDoneColumn(col.title), row });
      continue;
    }
    if (line.trim()) col.extra.push(line);
  }
  return { front, preamble: pre.join("\n").trim(), columns, rows };
}

export function serializeBoard(b: Board): string {
  const parts: string[] = [];
  if (b.preamble) parts.push(b.preamble);
  for (const c of b.columns) {
    const lines = [`## ${c.title}`, ""];
    const item = (k: Card) => `- [${k.done ? "x" : " "}] ${k.text.replace(/\n+/g, " ").trim()}`;
    // Satiri artik olmayan kartlar satirsiz kalir
    lines.push(...c.cards.filter((k) => !b.rows.includes(k.row)).map(item));
    for (const r of b.rows) {
      if (lines[lines.length - 1] !== "") lines.push("");
      lines.push(`### ${r}`, ...c.cards.filter((k) => k.row === r).map(item), "");
    }
    while (lines[lines.length - 1] === "") lines.pop();
    if (c.extra.length) lines.push("", ...c.extra);
    parts.push(lines.join("\n").trimEnd());
  }
  return `${b.front}${b.front && !b.front.endsWith("\n\n") ? "\n" : ""}${parts.join("\n\n")}\n`;
}

/**
 * Karti baska sutuna / satira / siraya tasir; toIndex hedef hucredeki (sutun + satir) siradir.
 * "Bitti" sutununa giren kart isaretlenir, cikan kartin isareti kalkar.
 */
export function moveCard(b: Board, cardId: string, toColumn: string, toIndex: number, toRow = ""): Board {
  const columns = b.columns.map((c) => ({ ...c, cards: [...c.cards] }));
  let card: Card | undefined;
  let fromCol: Column | undefined;
  for (const c of columns) {
    const i = c.cards.findIndex((k) => k.id === cardId);
    if (i >= 0) {
      [card] = c.cards.splice(i, 1);
      fromCol = c;
      break;
    }
  }
  const target = columns.find((c) => c.id === toColumn);
  if (!card || !target) return b;
  if (fromCol !== target) {
    if (isDoneColumn(target.title)) card = { ...card, done: true };
    else if (fromCol && isDoneColumn(fromCol.title)) card = { ...card, done: false };
  }
  card = { ...card, row: toRow };
  const cell = target.cards.filter((k) => k.row === toRow);
  const before = cell[Math.max(0, toIndex)];
  const at = before ? target.cards.indexOf(before) : target.cards.length;
  target.cards.splice(at, 0, card);
  return { ...b, columns };
}
