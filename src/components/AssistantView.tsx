/**
 * Not Asistani: solda hizli not + notlarim listesi, sagda notlari OKUYAN bir Claude modeline soru.
 * Notlar kasada "Notlarım/" klasorunde duz Markdown; model yalniz okur (Read/Glob/Grep), hicbir seyi degistirmez.
 */
import { useEffect, useMemo, useState } from "react";
import { Bot, ListChecks, Loader2, NotebookPen, Send, Sparkles, Square } from "lucide-react";
import { api, type AskEvent } from "../api";
import { renderMarkdown, type RenderEnv } from "../lib/markdown";
import { openPath, toast, useStore } from "../store";

const DIR = "Notlarım";
const ENV: RenderEnv = { notePath: "", depth: 0, resolve: () => null, renderNote: () => "" };
const pad = (n: number) => String(n).padStart(2, "0");
const todayFile = (d = new Date()) => `${DIR}/${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}.md`;
const PRESETS = [
  { label: "Özetle", icon: <Sparkles size={14} />, q: "Notlarımı kısaca özetle: ana konular, kararlar ve açık sorular." },
  { label: "Görevleri çıkar", icon: <ListChecks size={14} />, q: "Notlarımdaki yapılacak işleri madde madde çıkar; her birinin hangi notta geçtiğini yaz." },
];

export function AssistantView() {
  const files = useStore((s) => s.files);
  const notes = useStore((s) => s.notes);
  const [quick, setQuick] = useState("");
  const [question, setQuestion] = useState("");
  const [scope, setScope] = useState<"notes" | "vault">("notes");
  const [model, setModel] = useState<"haiku" | "sonnet" | "opus">("sonnet");
  const [busy, setBusy] = useState(false);
  const [steps, setSteps] = useState<string[]>([]);
  const [answer, setAnswer] = useState("");
  const [error, setError] = useState("");

  const myNotes = useMemo(
    () => files.filter((f) => !f.dir && f.path.startsWith(`${DIR}/`) && f.path.endsWith(".md")).sort((a, b) => b.mtime - a.mtime),
    [files],
  );

  useEffect(
    () =>
      api.assistant.onEvent((e: AskEvent) => {
        if (e.kind === "step") setSteps((s) => [...s.slice(-12), e.text]);
        else if (e.kind === "answer") setAnswer(e.text);
        else if (e.kind === "error") setError(e.text);
        else if (e.kind === "end") setBusy(false);
      }),
    [],
  );

  const saveQuick = async () => {
    const text = quick.trim();
    if (!text) return;
    const rel = todayFile();
    const now = new Date();
    const prev = notes[rel] ?? "";
    const head = prev ? "" : `# ${now.toLocaleDateString("tr-TR", { day: "numeric", month: "long", year: "numeric", weekday: "long" })}\n`;
    const body = `${prev.replace(/\s*$/, "")}${prev ? "\n" : ""}${head}\n## ${pad(now.getHours())}:${pad(now.getMinutes())}\n\n${text}\n`;
    try {
      await api.vault.mkdir(DIR).catch(() => undefined);
      await api.vault.write(rel, body);
      useStore.setState((s) => ({ notes: { ...s.notes, [rel]: body } }));
      setQuick("");
      toast("Not kaydedildi");
    } catch (e) {
      toast(String((e as Error).message || e), "error");
    }
  };

  const ask = async (q: string) => {
    if (!q.trim() || busy) return;
    setBusy(true);
    setSteps([]);
    setAnswer("");
    setError("");
    try {
      await api.assistant.ask(q, scope, model);
    } catch (e) {
      setBusy(false);
      setError(String((e as Error).message || e).replace(/^Error invoking remote method '[^']+': (Error: )?/, ""));
    }
  };

  const toAgents = async () => {
    if (!answer) return;
    try {
      toast(await api.agents.note(answer.replace(/\s+/g, " ").slice(0, 580), "hepsi"));
    } catch (e) {
      toast(String((e as Error).message || e), "error");
    }
  };

  return (
    <div className="asst">
      <section className="asst-col">
        <h3><NotebookPen size={16} /> Hızlı not</h3>
        <textarea
          className="text-input asst-quick"
          rows={5}
          placeholder="Aklına geleni yaz. Ctrl+Enter ile kaydet; bugünün notuna saatle eklenir."
          value={quick}
          onChange={(e) => setQuick(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && e.ctrlKey) {
              e.preventDefault();
              void saveQuick();
            }
          }}
        />
        <button className="btn primary" disabled={!quick.trim()} onClick={() => void saveQuick()}>Kaydet</button>
        <h3 className="asst-sub">Notlarım <span className="muted">{myNotes.length}</span></h3>
        {!myNotes.length && <p className="muted">Henüz not yok. İlk notunu yukarıya yaz.</p>}
        <div className="asst-list">
          {myNotes.map((f) => (
            <button key={f.path} className="asst-note" onClick={(e) => void openPath(f.path, { newTab: e.ctrlKey })}>
              <b>{f.name.replace(/\.md$/, "")}</b>
              <span className="muted">{(notes[f.path] ?? "").replace(/^#.*$/gm, "").replace(/\s+/g, " ").trim().slice(0, 90)}</span>
            </button>
          ))}
        </div>
      </section>

      <section className="asst-col asst-ai">
        <h3><Bot size={16} /> Notlarına sor</h3>
        <p className="muted small">Model notlarını yalnızca okur; hiçbir dosyayı değiştiremez. Claude Pro kotanı kullanır, internet gerekir.</p>
        <div className="asst-row">
          <select className="text-input" value={scope} onChange={(e) => setScope(e.target.value as "notes" | "vault")}>
            <option value="notes">Notlarım klasörü</option>
            <option value="vault">Tüm kasa</option>
          </select>
          <select className="text-input" value={model} onChange={(e) => setModel(e.target.value as "haiku" | "sonnet" | "opus")}>
            <option value="haiku">Haiku (hızlı, ucuz)</option>
            <option value="sonnet">Sonnet (dengeli)</option>
            <option value="opus">Opus (en güçlü)</option>
          </select>
        </div>
        <textarea
          className="text-input"
          rows={3}
          placeholder="Örn. Geçen hafta saha çekimi için ne not almıştım?"
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && e.ctrlKey) {
              e.preventDefault();
              void ask(question);
            }
          }}
        />
        <div className="asst-row">
          {busy ? (
            <button className="btn danger" onClick={() => void api.assistant.stop()}><Square size={14} /> Durdur</button>
          ) : (
            <button className="btn primary" disabled={!question.trim()} onClick={() => void ask(question)}><Send size={14} /> Sor</button>
          )}
          {PRESETS.map((p) => (
            <button key={p.label} className="btn" disabled={busy} onClick={() => void ask(p.q)}>{p.icon} {p.label}</button>
          ))}
        </div>
        {busy && (
          <div className="asst-steps">
            <Loader2 size={14} className="spin" /> Notlar okunuyor…
            {steps.map((s, i) => <div key={i} className="muted small">· {s}</div>)}
          </div>
        )}
        {error && <div className="ag-error">{error}</div>}
        {answer && (
          <div className="asst-answer">
            <article className="markdown" dangerouslySetInnerHTML={{ __html: renderMarkdown(answer, { ...ENV }) }} />
            <div className="asst-row">
              <button className="btn" onClick={() => void navigator.clipboard.writeText(answer).then(() => toast("Kopyalandı"))}>Kopyala</button>
              <button className="btn" onClick={() => void toAgents()} title="Yanıtı ajanların sahip notlarına ekler">Ajanlara gönder</button>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
