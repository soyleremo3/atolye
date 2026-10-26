/** CodeMirror belgesini disaridan gelen metne esitler (ayni dosya baska bolmede duzenlendiginde ya da diskte degistiginde). */
import { Transaction } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";

/**
 * Tum belgeyi degistirmek yerine sadece farkli araligi degistirir: imlec ve kaydirma konumu korunur.
 * Degisiklik geri alma gecmisine eklenmez (Ctrl+Z bu editorde yapilan son duzenlemeyi geri alir).
 */
export function syncDoc(view: EditorView, next: string): void {
  const cur = view.state.doc.toString();
  if (cur === next) return;
  let start = 0;
  const max = Math.min(cur.length, next.length);
  while (start < max && cur.charCodeAt(start) === next.charCodeAt(start)) start++;
  let endCur = cur.length;
  let endNext = next.length;
  while (endCur > start && endNext > start && cur.charCodeAt(endCur - 1) === next.charCodeAt(endNext - 1)) {
    endCur--;
    endNext--;
  }
  view.dispatch({
    changes: { from: start, to: endCur, insert: next.slice(start, endNext) },
    annotations: Transaction.addToHistory.of(false),
  });
}
