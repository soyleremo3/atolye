/** Markdown tabanli Kanban panosu: surukle-birak, satir ici duzenleme, sutun ve satir (serit) ekleme. */
import { Fragment, useMemo, useRef, useState, type DragEvent } from "react";
import DOMPurify from "dompurify";
import { ArrowDown, ArrowUp, Columns3, Pencil, Plus, Rows3, Trash2, X } from "lucide-react";
import { moveCard, parseBoard, serializeBoard, type Board, type Card, type Column } from "../lib/board";
import { md } from "../lib/markdown";
import { envFor } from "../lib/render";
import { followLink, openSearch, toast, updateNote, useStore } from "../store";
import { openMenu } from "./Overlays";

const DRAG = "application/x-atolye-card";
/** Satir basligi olmayan kartlarin (eski panolar / ilk ### oncesi) gosterildigi satirin adi. */
const LOOSE_LABEL = "Satırsız";

function CardText({ text, path }: { text: string; path: string }) {
  const html = useMemo(
    () => DOMPurify.sanitize(md.renderInline(text, envFor(path)), { ADD_ATTR: ["data-href", "data-tag", "data-heading"] }) as string,
    [text, path],
  );
  return (
    <div
      className="card-text"
      onClick={(e) => {
        const el = e.target as HTMLElement;
        const link = el.closest<HTMLElement>("a.wikilink");
        const tag = el.closest<HTMLElement>("a.tag");
        if (link || tag) {
          e.preventDefault();
          e.stopPropagation();
          if (link) void followLink(link.dataset.href || "", { from: path });
          else openSearch(`#${tag!.dataset.tag}`);
        }
      }}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}

const ask = (title: string, value: string, okText: string, run: (v: string) => void) =>
  useStore.setState({
    dialog: {
      type: "prompt", title, value, okText, selectAll: true,
      onSubmit: (v) => {
        if (v.trim()) run(v.trim());
      },
    },
  });

export function BoardView({ path }: { path: string }) {
  const content = useStore((s) => s.notes[path] ?? "");
  const board = useMemo(() => parseBoard(content), [content]);
  const [editing, setEditing] = useState<string | null>(null);
  const [adding, setAdding] = useState<{ col: string; row: string } | null>(null);
  const [over, setOver] = useState<{ col: string; row: string; index: number } | null>(null);
  const draft = useRef("");

  const save = (b: Board) => updateNote(path, serializeBoard(b));
  const patchCard = (cardId: string, fn: (c: Card) => Card | null) =>
    save({
      ...board,
      columns: board.columns.map((col) => ({
        ...col,
        cards: col.cards.flatMap((c) => {
          if (c.id !== cardId) return [c];
          const r = fn(c);
          return r ? [r] : [];
        }),
      })),
    });

  const dropIndex = (e: DragEvent, el: HTMLElement) => {
    const cards = [...el.querySelectorAll<HTMLElement>(".card")];
    const y = e.clientY;
    const i = cards.findIndex((c) => {
      const r = c.getBoundingClientRect();
      return y < r.top + r.height / 2;
    });
    return i < 0 ? cards.length : i;
  };

  /** Bir hucreyi (sutun + satir) kart birakma hedefi yapar. */
  const dropTarget = (col: string, row: string) => ({
    onDragOver: (e: DragEvent<HTMLElement>) => {
      if (!e.dataTransfer.types.includes(DRAG)) return;
      e.preventDefault();
      const index = dropIndex(e, e.currentTarget);
      if (over?.col !== col || over.row !== row || over.index !== index) setOver({ col, row, index });
    },
    onDragLeave: (e: DragEvent<HTMLElement>) => {
      if (!e.currentTarget.contains(e.relatedTarget as Node)) setOver(null);
    },
    onDrop: (e: DragEvent<HTMLElement>) => {
      e.preventDefault();
      const id = e.dataTransfer.getData(DRAG);
      const index = dropIndex(e, e.currentTarget);
      setOver(null);
      if (id) save(moveCard(board, id, col, index, row));
    },
  });
  const isOver = (col: string, row: string) => over?.col === col && over.row === row;

  const addColumn = () =>
    ask("Yeni sütun", "Yeni sütun", "Ekle", (v) => save({ ...board, columns: [...board.columns, { id: `n${Date.now()}`, title: v, cards: [], extra: [] }] }));
  const addRow = () =>
    ask("Yeni satır", "Yeni satır", "Ekle", (v) => {
      if (board.rows.includes(v)) return toast(`“${v}” satırı zaten var`);
      save({ ...board, rows: [...board.rows, v] });
    });
  const renameRow = (row: string) =>
    ask("Satırı yeniden adlandır", row, "Kaydet", (v) => {
      if (v === row) return;
      if (board.rows.includes(v)) return toast(`“${v}” satırı zaten var`);
      save({
        rows: board.rows.map((r) => (r === row ? v : r)),
        front: board.front,
        preamble: board.preamble,
        columns: board.columns.map((c) => ({ ...c, cards: c.cards.map((k) => (k.row === row ? { ...k, row: v } : k)) })),
      });
    });
  const moveRow = (row: string, dir: -1 | 1) => {
    const rows = [...board.rows];
    const i = rows.indexOf(row);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= rows.length) return;
    [rows[i], rows[j]] = [rows[j], rows[i]];
    save({ ...board, rows });
  };
  const rowCount = (row: string) => board.columns.reduce((n, c) => n + c.cards.filter((k) => k.row === row).length, 0);
  const rowMenu = (row: string, x: number, y: number) => {
    const i = board.rows.indexOf(row);
    openMenu(x, y, [
      { label: "Yeniden adlandır", icon: <Pencil size={14} />, run: () => renameRow(row) },
      ...(i > 0 ? [{ label: "Yukarı taşı", icon: <ArrowUp size={14} />, run: () => moveRow(row, -1) }] : []),
      ...(i < board.rows.length - 1 ? [{ label: "Aşağı taşı", icon: <ArrowDown size={14} />, run: () => moveRow(row, 1) }] : []),
      "sep",
      {
        label: rowCount(row) ? "Satırı sil (önce kartları taşı)" : "Satırı sil",
        icon: <Trash2 size={14} />,
        danger: true,
        run: () => {
          if (rowCount(row)) return toast("Satırı silmek için önce içindeki kartları taşı ya da sil");
          save({ ...board, rows: board.rows.filter((r) => r !== row) });
        },
      },
    ]);
  };

  const total = board.columns.reduce((n, c) => n + c.cards.length, 0);
  const done = board.columns.reduce((n, c) => n + c.cards.filter((k) => k.done).length, 0);
  const lanes = board.rows.length > 0;
  // Satirlar varken satirsiz kartlar (varsa) en ustte ayri bir satirda gosterilir
  const loose = lanes && board.columns.some((c) => c.cards.some((k) => !board.rows.includes(k.row)));
  const laneRows = lanes ? [...(loose ? [""] : []), ...board.rows] : [""];
  const inCell = (c: Column, row: string) => c.cards.filter((k) => (row ? k.row === row : !board.rows.includes(k.row)));

  const colHead = (col: Column, count: number) => (
    <>
      <span
        className="board-col-title"
        title="Çift tıkla: yeniden adlandır"
        onDoubleClick={() =>
          ask("Sütunu yeniden adlandır", col.title, "Kaydet", (v) =>
            save({ ...board, columns: board.columns.map((c) => (c.id === col.id ? { ...c, title: v } : c)) }),
          )
        }
      >
        {col.title}
      </span>
      <span className="board-count">{count}</span>
      {col.cards.length === 0 && (
        <button className="icon-btn small" title="Sütunu sil" onClick={() => save({ ...board, columns: board.columns.filter((c) => c.id !== col.id) })}>
          <Trash2 size={13} />
        </button>
      )}
    </>
  );

  /** Bir hucrenin kartlari ve "Kart ekle" alani. */
  const cell = (col: Column, row: string) => {
    const cards = inCell(col, row);
    const target = over && isOver(col.id, row) ? over : null;
    return (
      <>
        <div className="board-cards">
          {cards.map((card, i) => (
            <div key={card.id}>
              {target?.index === i && <div className="drop-line" />}
              <article
                className={`card${card.done ? " done" : ""}`}
                draggable={editing !== card.id}
                onDragStart={(e) => {
                  e.dataTransfer.setData(DRAG, card.id);
                  e.dataTransfer.effectAllowed = "move";
                }}
                onDoubleClick={() => {
                  draft.current = card.text;
                  setEditing(card.id);
                }}
              >
                <input type="checkbox" checked={card.done} onChange={() => patchCard(card.id, (c) => ({ ...c, done: !c.done }))} />
                {editing === card.id ? (
                  <textarea
                    autoFocus
                    className="card-edit"
                    defaultValue={card.text}
                    onChange={(e) => (draft.current = e.target.value)}
                    onBlur={() => {
                      setEditing(null);
                      const t = draft.current.trim();
                      patchCard(card.id, (c) => (t ? { ...c, text: t } : null));
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && !e.shiftKey) {
                        e.preventDefault();
                        (e.target as HTMLTextAreaElement).blur();
                      } else if (e.key === "Escape") {
                        draft.current = card.text;
                        (e.target as HTMLTextAreaElement).blur();
                      }
                    }}
                  />
                ) : (
                  <CardText text={card.text} path={path} />
                )}
                <button className="card-del" title="Kartı sil" onClick={() => patchCard(card.id, () => null)}>
                  <X size={13} />
                </button>
              </article>
            </div>
          ))}
          {target && target.index >= cards.length && <div className="drop-line" />}
        </div>
        {adding?.col === col.id && adding.row === row ? (
          <textarea
            autoFocus
            className="card-edit new"
            placeholder="Kart metni… (Enter ekle, Esc vazgeç; [[bağlantı]] ve #etiket kullanılabilir)"
            onKeyDown={(e) => {
              const el = e.target as HTMLTextAreaElement;
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                const text = el.value.trim();
                if (text) {
                  save({
                    ...board,
                    columns: board.columns.map((c) =>
                      c.id === col.id ? { ...c, cards: [...c.cards, { id: `n${Date.now()}`, text, done: false, row }] } : c,
                    ),
                  });
                  el.value = "";
                } else setAdding(null);
              } else if (e.key === "Escape") setAdding(null);
            }}
            onBlur={() => setAdding(null)}
          />
        ) : (
          <button className="board-add" onClick={() => setAdding({ col: col.id, row })}>
            <Plus size={14} /> Kart ekle
          </button>
        )}
      </>
    );
  };

  return (
    <div className="board">
      <div className="board-head">
        <span className="board-progress">
          <span className="bar"><span style={{ width: `${total ? (done / total) * 100 : 0}%` }} /></span>
          {done} / {total} tamamlandı
        </span>
        <span className="board-head-actions">
          <button className="btn" title="Görevleri konuya göre gruplamak için satır ekle" onClick={addRow}>
            <Rows3 size={14} /> Satır ekle
          </button>
          <button className="btn" onClick={addColumn}>
            <Columns3 size={14} /> Sütun ekle
          </button>
        </span>
      </div>
      {lanes ? (
        <div className="board-grid" style={{ gridTemplateColumns: `170px repeat(${board.columns.length}, 270px)` }}>
          <div className="board-corner" />
          {board.columns.map((col) => (
            <header key={col.id} className="board-col-head board-grid-head">
              {colHead(col, col.cards.length)}
            </header>
          ))}
          {laneRows.map((row) => (
            <Fragment key={row || "\u0000"}>
              <div
                className={`board-row-head${row ? "" : " loose"}`}
                title={row ? "Çift tıkla: yeniden adlandır · Sağ tık: diğer" : "Satır başlığı olmayan kartlar"}
                onDoubleClick={() => row && renameRow(row)}
                onContextMenu={(e) => {
                  if (!row) return;
                  e.preventDefault();
                  rowMenu(row, e.clientX, e.clientY);
                }}
              >
                <span className="board-row-title">{row || LOOSE_LABEL}</span>
                <span className="board-count">{row ? rowCount(row) : board.columns.reduce((n, c) => n + inCell(c, "").length, 0)}</span>
                {row && (
                  <button
                    className="icon-btn small"
                    title="Satır seçenekleri"
                    onClick={(e) => {
                      const r = e.currentTarget.getBoundingClientRect();
                      rowMenu(row, r.left, r.bottom + 4);
                    }}
                  >
                    <Pencil size={12} />
                  </button>
                )}
              </div>
              {board.columns.map((col) => (
                <div key={col.id} className={`board-cell${isOver(col.id, row) ? " over" : ""}`} data-row={row} {...dropTarget(col.id, row)}>
                  {cell(col, row)}
                </div>
              ))}
            </Fragment>
          ))}
        </div>
      ) : (
        <div className="board-columns">
          {board.columns.map((col) => (
            <section key={col.id} className={`board-col${isOver(col.id, "") ? " over" : ""}`} {...dropTarget(col.id, "")}>
              <header className="board-col-head">{colHead(col, col.cards.length)}</header>
              {cell(col, "")}
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
