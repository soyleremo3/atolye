import { useEffect, useRef } from "react";
import { autocompletion, closeBrackets, closeBracketsKeymap, completionKeymap, type CompletionContext, type CompletionResult } from "@codemirror/autocomplete";
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { bracketMatching, HighlightStyle, indentOnInput, syntaxHighlighting } from "@codemirror/language";
import { languages } from "@codemirror/language-data";
import { highlightSelectionMatches, searchKeymap } from "@codemirror/search";
import { Compartment, EditorSelection, EditorState, type Extension } from "@codemirror/state";
import {
  Decoration, drawSelection, dropCursor, EditorView, highlightActiveLine, highlightSpecialChars, keymap, MatchDecorator,
  placeholder, ViewPlugin, type DecorationSet, type ViewUpdate,
} from "@codemirror/view";
import { tags as t } from "@lezer/highlight";
import { basename, dirname, extname, title } from "../lib/paths";
import { followLink, getIndex, saveAttachment, updateNote, useStore } from "../store";

// ------------------------------------------------------------------ gorunum
const highlight = HighlightStyle.define([
  { tag: t.heading1, fontSize: "1.65em", fontWeight: "700", color: "var(--heading)" },
  { tag: t.heading2, fontSize: "1.4em", fontWeight: "700", color: "var(--heading)" },
  { tag: t.heading3, fontSize: "1.22em", fontWeight: "650", color: "var(--heading)" },
  { tag: t.heading4, fontSize: "1.1em", fontWeight: "650", color: "var(--heading)" },
  { tag: [t.heading5, t.heading6], fontWeight: "650", color: "var(--heading)" },
  { tag: t.strong, fontWeight: "700" },
  { tag: t.emphasis, fontStyle: "italic" },
  { tag: t.strikethrough, textDecoration: "line-through", color: "var(--muted)" },
  { tag: t.link, color: "var(--accent)" },
  { tag: t.url, color: "var(--muted)", textDecoration: "underline" },
  { tag: t.monospace, fontFamily: "var(--mono)", fontSize: "0.92em", color: "var(--code-text)" },
  { tag: t.quote, color: "var(--muted)", fontStyle: "italic" },
  { tag: [t.processingInstruction, t.contentSeparator, t.labelName], color: "var(--faint)" },
  { tag: [t.keyword, t.modifier, t.controlKeyword, t.operatorKeyword], color: "var(--syn-keyword)" },
  { tag: [t.string, t.special(t.string), t.regexp], color: "var(--syn-string)" },
  { tag: [t.number, t.bool, t.null, t.atom], color: "var(--syn-number)" },
  { tag: [t.comment, t.lineComment, t.blockComment], color: "var(--syn-comment)", fontStyle: "italic" },
  { tag: [t.function(t.variableName), t.function(t.propertyName)], color: "var(--syn-function)" },
  { tag: [t.typeName, t.className, t.namespace], color: "var(--syn-type)" },
  { tag: [t.propertyName, t.attributeName], color: "var(--syn-property)" },
  { tag: [t.tagName], color: "var(--syn-keyword)" },
  { tag: t.invalid, color: "var(--danger)" },
]);

const baseTheme = EditorView.theme({
  "&": { height: "100%", fontSize: "var(--editor-size)", backgroundColor: "transparent", color: "var(--text)" },
  "&.cm-focused": { outline: "none" },
  ".cm-scroller": { fontFamily: "var(--editor-font)", lineHeight: "1.7", overflow: "auto" },
  ".cm-content": { maxWidth: "var(--line-width)", margin: "0 auto", padding: "28px 40px 40vh", caretColor: "var(--accent)" },
  ".cm-line": { padding: "0 2px" },
  ".cm-cursor": { borderLeftColor: "var(--accent)", borderLeftWidth: "2px" },
  "&.cm-focused .cm-selectionBackground, .cm-selectionBackground, ::selection": { backgroundColor: "var(--selection) !important" },
  ".cm-activeLine": { backgroundColor: "var(--active-line)" },
  ".cm-gutters": { display: "none" },
  ".cm-wikilink": { color: "var(--accent)", textDecoration: "underline", textDecorationColor: "var(--accent-soft)", textUnderlineOffset: "3px", cursor: "pointer" },
  ".cm-tag": { color: "var(--tag-text)", backgroundColor: "var(--tag-bg)", borderRadius: "4px", padding: "0 2px" },
  ".cm-highlight-mark": { backgroundColor: "var(--mark)", borderRadius: "3px" },
  ".cm-placeholder": { color: "var(--faint)" },
  ".cm-tooltip": { border: "1px solid var(--border)", backgroundColor: "var(--bg-2)", borderRadius: "8px", overflow: "hidden", boxShadow: "var(--shadow)" },
  ".cm-tooltip-autocomplete > ul > li": { padding: "4px 10px !important", fontFamily: "var(--ui-font)" },
  ".cm-tooltip-autocomplete > ul > li[aria-selected]": { backgroundColor: "var(--accent)", color: "#fff" },
  ".cm-completionDetail": { color: "var(--faint)", marginLeft: "8px", fontStyle: "normal" },
  ".cm-panels": { backgroundColor: "var(--bg-2)", color: "var(--text)", borderColor: "var(--border)" },
  ".cm-panels input, .cm-panels button": { fontFamily: "var(--ui-font)" },
  ".cm-searchMatch": { backgroundColor: "var(--mark)" },
  ".cm-searchMatch-selected": { backgroundColor: "var(--accent-soft)" },
  ".cm-selectionMatch": { backgroundColor: "var(--selection-match)" },
  ".cm-matchingBracket": { backgroundColor: "var(--selection-match)", outline: "none" },
});

function matchPlugin(regexp: RegExp, cls: string): Extension {
  const decorator = new MatchDecorator({ regexp, decoration: Decoration.mark({ class: cls }) });
  return ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;
      constructor(view: EditorView) {
        this.decorations = decorator.createDeco(view);
      }
      update(u: ViewUpdate) {
        this.decorations = decorator.updateDeco(u, this.decorations);
      }
    },
    { decorations: (v) => v.decorations },
  );
}

const phrases = EditorState.phrases.of({
  Find: "Bul", Replace: "Değiştir", next: "sonraki", previous: "önceki", all: "tümü", "match case": "büyük/küçük harf",
  "by word": "tam kelime", regexp: "regex", replace: "değiştir", "replace all": "tümünü değiştir", close: "kapat",
  "Go to line": "Satıra git", go: "git",
});

// ------------------------------------------------------------------ komutlar
function wrap(marker: string, end = marker) {
  return (view: EditorView) => {
    view.dispatch(
      view.state.changeByRange((range) => {
        const text = view.state.sliceDoc(range.from, range.to);
        const before = view.state.sliceDoc(range.from - marker.length, range.from);
        const after = view.state.sliceDoc(range.to, range.to + end.length);
        if (before === marker && after === end) {
          return {
            changes: [{ from: range.from - marker.length, to: range.from }, { from: range.to, to: range.to + end.length }],
            range: EditorSelection.range(range.from - marker.length, range.to - marker.length),
          };
        }
        return {
          changes: [{ from: range.from, insert: marker }, { from: range.to, insert: end }],
          range: text ? EditorSelection.range(range.from + marker.length, range.to + marker.length) : EditorSelection.cursor(range.from + marker.length),
        };
      }),
    );
    return true;
  };
}

function toggleTask(view: EditorView): boolean {
  const changes = view.state.selection.ranges.map((r) => {
    const line = view.state.doc.lineAt(r.head);
    const m = line.text.match(/^(\s*)([-*+]|\d+[.)]) \[( |x|X)\] /);
    if (m) {
      const at = line.from + m[1].length + m[2].length + 2;
      return { from: at, to: at + 1, insert: m[3] === " " ? "x" : " " };
    }
    const list = line.text.match(/^(\s*)([-*+]|\d+[.)]) /);
    if (list) return { from: line.from + list[0].length, insert: "[ ] " };
    const indent = line.text.match(/^\s*/)![0].length;
    return { from: line.from + indent, insert: "- [ ] " };
  });
  view.dispatch({ changes });
  return true;
}

function cycleHeading(view: EditorView): boolean {
  const line = view.state.doc.lineAt(view.state.selection.main.head);
  const m = line.text.match(/^(#{1,6}) /);
  const level = m ? m[1].length : 0;
  const next = level >= 3 ? "" : "#".repeat(level + 1) + " ";
  view.dispatch({ changes: { from: line.from, to: line.from + (m ? m[0].length : 0), insert: next } });
  return true;
}

const formatKeymap = keymap.of([
  { key: "Mod-b", run: wrap("**") },
  { key: "Mod-i", run: wrap("*") },
  { key: "Mod-Shift-x", run: wrap("~~") },
  { key: "Mod-Shift-h", run: wrap("==") },
  { key: "Mod-`", run: wrap("`") },
  { key: "Mod-k", run: wrap("[[", "]]") },
  { key: "Mod-Enter", run: toggleTask },
  { key: "Mod-h", run: cycleHeading },
  indentWithTab,
]);

// ------------------------------------------------------------------ otomatik tamamlama
function linkCompletions(ctx: CompletionContext): CompletionResult | null {
  const m = ctx.matchBefore(/!?\[\[[^\]\n|#]*/);
  if (!m) return null;
  const start = m.text.indexOf("[[") + 2;
  const hasClose = ctx.state.sliceDoc(ctx.pos, ctx.pos + 2) === "]]";
  const files = useStore.getState().files.filter((f) => !f.dir);
  const names = new Map<string, number>();
  for (const f of files) names.set(title(f.path), (names.get(title(f.path)) || 0) + 1);
  return {
    from: m.from + start,
    validFor: /^[^\]\n|#]*$/,
    options: files.map((f) => {
      const isMd = extname(f.path) === ".md";
      const label = isMd ? ((names.get(title(f.path)) || 0) > 1 ? f.path.slice(0, -3) : title(f.path)) : basename(f.path);
      return {
        label,
        detail: dirname(f.path) || undefined,
        type: isMd ? "text" : "variable",
        boost: isMd ? 1 : 0,
        apply: (view: EditorView, _c: unknown, from: number, to: number) => {
          view.dispatch({ changes: { from, to, insert: label + (hasClose ? "" : "]]") }, selection: { anchor: from + label.length + 2 } });
        },
      };
    }),
  };
}

function tagCompletions(ctx: CompletionContext): CompletionResult | null {
  const m = ctx.matchBefore(/#[\p{L}\p{N}_\-/]*/u);
  if (!m || (m.from > 0 && !/\s/.test(ctx.state.sliceDoc(m.from - 1, m.from)))) return null;
  if (m.text === "#" && !ctx.explicit) return null;
  const line = ctx.state.doc.lineAt(ctx.pos);
  if (m.from === line.from && /^#+\s?$/.test(m.text)) return null;
  const tags = [...getIndex().tags.entries()].sort((a, b) => b[1].length - a[1].length);
  return { from: m.from + 1, validFor: /^[\p{L}\p{N}_\-/]*$/u, options: tags.map(([tag, ps]) => ({ label: tag, detail: `${ps.length}`, type: "keyword" })) };
}

// ------------------------------------------------------------------ dosya yapistirma / birakma
async function insertFiles(view: EditorView, files: File[], pos: number) {
  const parts: string[] = [];
  for (const f of files) {
    const ext = (f.name.match(/\.[a-z0-9]+$/i)?.[0] || `.${f.type.split("/")[1] || "png"}`).toLowerCase().replace(".jpeg", ".jpg");
    const hint = f.name && !/^image\.\w+$/i.test(f.name) ? f.name.replace(/\.[^.]+$/, "").slice(0, 60) : "Yapıştırılan";
    const saved = await saveAttachment(new Uint8Array(await f.arrayBuffer()), ext, hint);
    if (saved) parts.push(`![[${basename(saved)}]]`);
  }
  if (parts.length) view.dispatch({ changes: { from: pos, insert: parts.join("\n") }, selection: { anchor: pos + parts.join("\n").length } });
}

function linkAt(view: EditorView, pos: number): string | null {
  const line = view.state.doc.lineAt(pos);
  for (const m of line.text.matchAll(/\[\[([^[\]\n]+?)\]\]/g)) {
    const from = line.from + m.index!;
    if (pos >= from && pos <= from + m[0].length) return m[1];
  }
  return null;
}

const fileHandlers = EditorView.domEventHandlers({
  paste(e, view) {
    const files = [...(e.clipboardData?.files || [])];
    if (!files.length) return false;
    e.preventDefault();
    void insertFiles(view, files, view.state.selection.main.head);
    return true;
  },
  drop(e, view) {
    const files = [...(e.dataTransfer?.files || [])];
    if (!files.length) return false;
    e.preventDefault();
    const pos = view.posAtCoords({ x: e.clientX, y: e.clientY }) ?? view.state.selection.main.head;
    void insertFiles(view, files, pos);
    return true;
  },
  mousedown(e, view) {
    if (!(e.ctrlKey || e.metaKey) || e.button !== 0) return false;
    const pos = view.posAtCoords({ x: e.clientX, y: e.clientY });
    const raw = pos !== null ? linkAt(view, pos) : null;
    if (!raw) return false;
    e.preventDefault();
    const [left] = raw.split("|");
    const [target, heading] = left.split("#");
    void followLink(target.trim(), { newTab: e.shiftKey, heading, from: view.dom.dataset.path });
    return true;
  },
});

// ------------------------------------------------------------------ bilesen
type Props = { path: string; content: string; active: boolean; spellcheck: boolean };

export function Editor({ path, content, active, spellcheck }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const spell = useRef(new Compartment());
  const jump = useStore((s) => (s.jump?.path === path ? s.jump : null));

  useEffect(() => {
    const v = new EditorView({
      parent: host.current!,
      state: EditorState.create({
        doc: content,
        extensions: [
          phrases,
          highlightSpecialChars(),
          history(),
          drawSelection(),
          dropCursor(),
          EditorState.allowMultipleSelections.of(true),
          indentOnInput(),
          bracketMatching(),
          closeBrackets(),
          highlightActiveLine(),
          highlightSelectionMatches(),
          EditorView.lineWrapping,
          markdown({ base: markdownLanguage, codeLanguages: languages }),
          syntaxHighlighting(highlight),
          baseTheme,
          matchPlugin(/!?\[\[[^[\]\n]+?\]\]/g, "cm-wikilink"),
          matchPlugin(/(?<=^|\s)#[\p{L}\p{N}_\-/]*[\p{L}_\-/][\p{L}\p{N}_\-/]*/gu, "cm-tag"),
          matchPlugin(/==[^=\n]+==/g, "cm-highlight-mark"),
          autocompletion({ override: [linkCompletions, tagCompletions], icons: false }),
          placeholder("Yazmaya başla…   [[ ile bağlantı, # ile etiket ekle"),
          formatKeymap,
          keymap.of([...closeBracketsKeymap, ...defaultKeymap, ...searchKeymap, ...historyKeymap, ...completionKeymap]),
          fileHandlers,
          spell.current.of(EditorView.contentAttributes.of({ spellcheck: String(spellcheck), lang: "tr" })),
          EditorView.updateListener.of((u) => {
            if (u.docChanged) updateNote(path, u.state.doc.toString());
          }),
        ],
      }),
    });
    v.dom.dataset.path = path;
    view.current = v;
    if (active) requestAnimationFrame(() => v.focus());
    return () => v.destroy();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path]);

  // Dosya disarida degistiyse (ya da baglanti guncellemesiyle) editoru esitle
  useEffect(() => {
    const v = view.current;
    if (!v) return;
    const current = v.state.doc.toString();
    if (current !== content) {
      const head = Math.min(v.state.selection.main.head, content.length);
      v.dispatch({ changes: { from: 0, to: current.length, insert: content }, selection: { anchor: head } });
    }
  }, [content]);

  useEffect(() => {
    view.current?.dispatch({ effects: spell.current.reconfigure(EditorView.contentAttributes.of({ spellcheck: String(spellcheck), lang: "tr" })) });
  }, [spellcheck]);

  useEffect(() => {
    if (active) view.current?.focus();
  }, [active]);

  useEffect(() => {
    const v = view.current;
    if (!v || !jump) return;
    const line = v.state.doc.line(Math.min(jump.line + 1, v.state.doc.lines));
    v.dispatch({ selection: { anchor: line.from }, effects: EditorView.scrollIntoView(line.from, { y: "start", yMargin: 60 }) });
    v.focus();
  }, [jump]);

  return <div className="editor" ref={host} />;
}
