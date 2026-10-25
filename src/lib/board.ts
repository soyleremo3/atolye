/**
 * Markdown tabanli gorev panosu (Kanban).
 *   ## Sutun basligi
 *   - [ ] Kart metni #etiket
 *   - [x] Bitmis kart
 * Ust bilgi (frontmatter) ve ilk basliktan onceki metin korunur; sutun icindeki kart olmayan satirlar da korunur.
 */
export type Card = { id: string; text: string; done: boolean };
export type Column = { id: string; title: string; cards: Card[]; extra: string[] };
export type Board = { front: string; preamble: string; columns: Column[] };


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
  const pre: string[] = [];
  let col: Column | null = null;
  for (const line of lines) {
    const h = line.match(/^##\s+(.+?)\s*$/);
    if (h) {
      // Konuma bagli kararli kimlikler: icerik yeniden ayristirilinca da ayni kalir
      col = { id: `c${columns.length}`, title: h[1], cards: [], extra: [] };
      columns.push(col);
      continue;
    }
    if (!col) {
      pre.push(line);
      continue;
    }
    const m = line.match(CARD);
    if (m) {
      col.cards.push({ id: `${col.id}k${col.cards.length}`, text: m[2], done: m[1] !== " " });
      continue;
    }
    const p = line.match(PLAIN_ITEM);
    if (p) {
      col.cards.push({ id: `${col.id}k${col.cards.length}`, text: p[1], done: isDoneColumn(col.title) });
      continue;
    }
    if (line.trim()) col.extra.push(line);
  }
  return { front, preamble: pre.join("\n").trim(), columns };
}

export function serializeBoard(b: Board): string {
  const parts: string[] = [];
  if (b.preamble) parts.push(b.preamble);
  for (const c of b.columns) {
    const lines = [`## ${c.title}`, ""];
    for (const k of c.cards) lines.push(`- [${k.done ? "x" : " "}] ${k.text.replace(/\n+/g, " ").trim()}`);
    if (c.extra.length) lines.push("", ...c.extra);
    parts.push(lines.join("\n").trimEnd());
  }
  return `${b.front}${b.front && !b.front.endsWith("\n\n") ? "\n" : ""}${parts.join("\n\n")}\n`;
}

/** Karti baska sutuna / siraya tasir; "Bitti" sutununa giren kart isaretlenir, cikan kartin isareti kalkar. */
export function moveCard(b: Board, cardId: string, toColumn: string, toIndex: number): Board {
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
  target.cards.splice(Math.max(0, Math.min(toIndex, target.cards.length)), 0, card);
  return { ...b, columns };
}
