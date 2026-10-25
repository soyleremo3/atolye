/** Markdown tabanli Kanban panosu: surukle-birak, satir ici duzenleme, sutun ekleme. */
import { useMemo, useRef, useState, type DragEvent } from "react";
import DOMPurify from "dompurify";
import { Plus, Trash2, X } from "lucide-react";
import { moveCard, parseBoard, serializeBoard, type Board, type Card } from "../lib/board";
import { md } from "../lib/markdown";
import { envFor } from "../lib/render";
import { followLink, openSearch, updateNote, useStore } from "../store";

const DRAG = "application/x-atolye-card";

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

export function BoardView({ path }: { path: string }) {
  const content = useStore((s) => s.notes[path] ?? "");
  const board = useMemo(() => parseBoard(content), [content]);
  const [editing, setEditing] = useState<string | null>(null);
  const [adding, setAdding] = useState<string | null>(null);
  const [over, setOver] = useState<{ col: string; index: number } | null>(null);
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

  const dropIndex = (e: DragEvent, colEl: HTMLElement) => {
    const cards = [...colEl.querySelectorAll<HTMLElement>(".card")];
    const y = e.clientY;
    const i = cards.findIndex((c) => {
      const r = c.getBoundingClientRect();
      return y < r.top + r.height / 2;
    });
    return i < 0 ? cards.length : i;
  };

  const total = board.columns.reduce((n, c) => n + c.cards.length, 0);
  const done = board.columns.reduce((n, c) => n + c.cards.filter((k) => k.done).length, 0);

  return (
    <div className="board">
      <div className="board-head">
        <span className="board-progress">
          <span className="bar"><span style={{ width: `${total ? (done / total) * 100 : 0}%` }} /></span>
          {done} / {total} tamamlandı
        </span>
        <button
          className="btn"
          onClick={() =>
            useStore.setState({
              dialog: {
                type: "prompt", title: "Yeni sütun", value: "Yeni sütun", okText: "Ekle", selectAll: true,
                onSubmit: (v) => {
                  if (v.trim()) save({ ...board, columns: [...board.columns, { id: `n${Date.now()}`, title: v.trim(), cards: [], extra: [] }] });
                },
              },
            })
          }
        >
          <Plus size={14} /> Sütun ekle
        </button>
      </div>
      <div className="board-columns">
        {board.columns.map((col) => (
          <section
            key={col.id}
            className={`board-col${over?.col === col.id ? " over" : ""}`}
            onDragOver={(e) => {
              if (!e.dataTransfer.types.includes(DRAG)) return;
              e.preventDefault();
              setOver({ col: col.id, index: dropIndex(e, e.currentTarget) });
            }}
            onDragLeave={(e) => {
              if (!e.currentTarget.contains(e.relatedTarget as Node)) setOver(null);
            }}
            onDrop={(e) => {
              e.preventDefault();
              const id = e.dataTransfer.getData(DRAG);
              const index = dropIndex(e, e.currentTarget);
              setOver(null);
              if (id) save(moveCard(board, id, col.id, index));
            }}
          >
            <header className="board-col-head">
              <span
                className="board-col-title"
                title="Çift tıkla: yeniden adlandır"
                onDoubleClick={() =>
                  useStore.setState({
                    dialog: {
                      type: "prompt", title: "Sütunu yeniden adlandır", value: col.title, okText: "Kaydet", selectAll: true,
                      onSubmit: (v) => {
                        if (v.trim()) save({ ...board, columns: board.columns.map((c) => (c.id === col.id ? { ...c, title: v.trim() } : c)) });
                      },
                    },
                  })
                }
              >
                {col.title}
              </span>
              <span className="board-count">{col.cards.length}</span>
              {col.cards.length === 0 && (
                <button className="icon-btn small" title="Sütunu sil" onClick={() => save({ ...board, columns: board.columns.filter((c) => c.id !== col.id) })}>
                  <Trash2 size={13} />
                </button>
              )}
            </header>
            <div className="board-cards">
              {col.cards.map((card, i) => (
                <div key={card.id}>
                  {over?.col === col.id && over.index === i && <div className="drop-line" />}
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
              {over?.col === col.id && over.index >= col.cards.length && <div className="drop-line" />}
            </div>
            {adding === col.id ? (
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
                          c.id === col.id ? { ...c, cards: [...c.cards, { id: `n${Date.now()}`, text, done: false }] } : c,
                        ),
                      });
                      el.value = "";
                    } else setAdding(null);
                  } else if (e.key === "Escape") setAdding(null);
                }}
                onBlur={() => setAdding(null)}
              />
            ) : (
              <button className="board-add" onClick={() => setAdding(col.id)}>
                <Plus size={14} /> Kart ekle
              </button>
            )}
          </section>
        ))}
      </div>
    </div>
  );
}
