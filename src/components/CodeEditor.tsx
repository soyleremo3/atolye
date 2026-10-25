/** Genel amacli kod editoru (CodeMirror 6): dil dosya adindan otomatik yuklenir. */
import { useEffect, useRef } from "react";
import { autocompletion, closeBrackets, closeBracketsKeymap, completionKeymap } from "@codemirror/autocomplete";
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import {
  bracketMatching, foldGutter, foldKeymap, HighlightStyle, indentOnInput, LanguageDescription, syntaxHighlighting,
} from "@codemirror/language";
import { languages } from "@codemirror/language-data";
import { highlightSelectionMatches, searchKeymap } from "@codemirror/search";
import { Compartment, EditorState } from "@codemirror/state";
import {
  drawSelection, EditorView, highlightActiveLine, highlightActiveLineGutter, highlightSpecialChars, keymap, lineNumbers,
} from "@codemirror/view";
import { tags as t } from "@lezer/highlight";

const codeHighlight = HighlightStyle.define([
  { tag: [t.keyword, t.modifier, t.controlKeyword, t.operatorKeyword, t.definitionKeyword], color: "var(--syn-keyword)" },
  { tag: [t.string, t.special(t.string), t.regexp, t.attributeValue], color: "var(--syn-string)" },
  { tag: [t.number, t.bool, t.null, t.atom], color: "var(--syn-number)" },
  { tag: [t.comment, t.lineComment, t.blockComment, t.docComment], color: "var(--syn-comment)", fontStyle: "italic" },
  { tag: [t.function(t.variableName), t.function(t.propertyName), t.macroName], color: "var(--syn-function)" },
  { tag: [t.typeName, t.className, t.namespace, t.standard(t.typeName)], color: "var(--syn-type)" },
  { tag: [t.propertyName, t.attributeName, t.labelName], color: "var(--syn-property)" },
  { tag: [t.tagName, t.heading], color: "var(--syn-keyword)", fontWeight: "600" },
  { tag: [t.operator, t.punctuation, t.bracket], color: "var(--muted)" },
  { tag: t.invalid, color: "var(--danger)" },
  { tag: t.link, color: "var(--accent)", textDecoration: "underline" },
]);

const codeTheme = EditorView.theme({
  "&": { height: "100%", fontSize: "13.5px", backgroundColor: "transparent", color: "var(--text)" },
  "&.cm-focused": { outline: "none" },
  ".cm-scroller": { fontFamily: "var(--mono)", lineHeight: "1.6", overflow: "auto" },
  ".cm-content": { caretColor: "var(--accent)", padding: "10px 0" },
  ".cm-gutters": { backgroundColor: "transparent", color: "var(--faint)", border: "none" },
  ".cm-activeLineGutter": { backgroundColor: "transparent", color: "var(--text)" },
  ".cm-activeLine": { backgroundColor: "var(--active-line)" },
  ".cm-cursor": { borderLeftColor: "var(--accent)", borderLeftWidth: "2px" },
  "&.cm-focused .cm-selectionBackground, .cm-selectionBackground, ::selection": { backgroundColor: "var(--selection) !important" },
  ".cm-selectionMatch": { backgroundColor: "var(--selection-match)" },
  ".cm-matchingBracket": { backgroundColor: "var(--selection-match)", outline: "none" },
  ".cm-foldGutter span": { color: "var(--faint)" },
  ".cm-panels": { backgroundColor: "var(--bg-2)", color: "var(--text)", borderColor: "var(--border)" },
  ".cm-tooltip": { border: "1px solid var(--border)", backgroundColor: "var(--bg-2)", borderRadius: "8px" },
  ".cm-tooltip-autocomplete > ul > li[aria-selected]": { backgroundColor: "var(--accent)", color: "#fff" },
  ".cm-searchMatch": { backgroundColor: "var(--mark)" },
});

/** Dosya adi veya dil adindan CodeMirror dil tanimi. */
export function languageFor(nameOrLang: string): LanguageDescription | null {
  return (
    LanguageDescription.matchFilename(languages, nameOrLang) ??
    LanguageDescription.matchLanguageName(languages, nameOrLang.replace(/^\./, ""), true) ??
    (/dockerfile$/i.test(nameOrLang) ? LanguageDescription.matchLanguageName(languages, "dockerfile") : null)
  );
}

type Props = {
  value: string;
  onChange?: (v: string) => void;
  language?: string;     // dosya adi ("x.ts") ya da dil ("json")
  readOnly?: boolean;
  gutter?: boolean;
  wrap?: boolean;
  autoFocus?: boolean;
  className?: string;
  onSubmit?: () => void; // Ctrl+Enter
};

export function CodeEditor({ value, onChange, language = "", readOnly, gutter = true, wrap, autoFocus, className, onSubmit }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const lang = useRef(new Compartment());
  const ro = useRef(new Compartment());
  const cb = useRef({ onChange, onSubmit });
  cb.current = { onChange, onSubmit };

  useEffect(() => {
    const v = new EditorView({
      parent: host.current!,
      state: EditorState.create({
        doc: value,
        extensions: [
          ...(gutter ? [lineNumbers(), foldGutter(), highlightActiveLineGutter()] : []),
          highlightSpecialChars(),
          history(),
          drawSelection(),
          indentOnInput(),
          bracketMatching(),
          closeBrackets(),
          autocompletion(),
          highlightActiveLine(),
          highlightSelectionMatches(),
          syntaxHighlighting(codeHighlight),
          codeTheme,
          ...(wrap ? [EditorView.lineWrapping] : []),
          lang.current.of([]),
          ro.current.of(EditorState.readOnly.of(!!readOnly)),
          keymap.of([
            { key: "Mod-Enter", run: () => (cb.current.onSubmit ? (cb.current.onSubmit(), true) : false) },
            indentWithTab,
            ...closeBracketsKeymap,
            ...defaultKeymap,
            ...searchKeymap,
            ...historyKeymap,
            ...foldKeymap,
            ...completionKeymap,
          ]),
          EditorView.updateListener.of((u) => {
            if (u.docChanged) cb.current.onChange?.(u.state.doc.toString());
          }),
        ],
      }),
    });
    view.current = v;
    if (autoFocus) requestAnimationFrame(() => v.focus());
    return () => v.destroy();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const v = view.current;
    if (!v) return;
    const cur = v.state.doc.toString();
    if (cur !== value) v.dispatch({ changes: { from: 0, to: cur.length, insert: value } });
  }, [value]);

  useEffect(() => {
    let alive = true;
    const desc = language ? languageFor(language) : null;
    if (!desc) {
      view.current?.dispatch({ effects: lang.current.reconfigure([]) });
      return;
    }
    void desc.load().then((support) => {
      if (alive) view.current?.dispatch({ effects: lang.current.reconfigure(support) });
    });
    return () => {
      alive = false;
    };
  }, [language]);

  useEffect(() => {
    view.current?.dispatch({ effects: ro.current.reconfigure(EditorState.readOnly.of(!!readOnly)) });
  }, [readOnly]);

  return <div className={`code-editor ${className ?? ""}`} ref={host} />;
}
