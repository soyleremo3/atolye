/** HTTP istemcisi: .http dosyalarindaki istekleri duzenle, gonder, yaniti incele. */
import { useEffect, useMemo, useState } from "react";
import { Copy, FilePlus, Plus, Send, Terminal, Trash2 } from "lucide-react";
import { api, type HttpResponse } from "../api";
import { applyVars, METHODS, newId, parseHttp, serializeHttp, toCurl, type HttpFile, type HttpReq } from "../lib/httpfile";
import { isHttp, title } from "../lib/paths";
import { loadText, newRequestFile, toast, updateText, useStore } from "../store";
import { CodeEditor } from "./CodeEditor";

type ReqTab = "headers" | "body" | "vars";
type ResTab = "body" | "headers";

function prettyBody(res: HttpResponse): { text: string; lang: string } {
  const body = res.body ?? "";
  const type = res.contentType ?? "";
  if (/json/i.test(type) || /^\s*[[{]/.test(body)) {
    try {
      return { text: JSON.stringify(JSON.parse(body), null, 2), lang: "json" };
    } catch {
      /* duz metin */
    }
  }
  if (/html/i.test(type)) return { text: body, lang: "html" };
  if (/xml/i.test(type)) return { text: body, lang: "xml" };
  return { text: body, lang: "" };
}

const statusClass = (s?: number) => (!s ? "err" : s < 300 ? "ok" : s < 400 ? "redirect" : "err");
const fmtSize = (n = 0) => (n < 1024 ? `${n} B` : n < 1024 * 1024 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1024 / 1024).toFixed(2)} MB`);

export function HttpView() {
  const files = useStore((s) => s.files);
  const httpFiles = useMemo(() => files.filter((f) => !f.dir && isHttp(f.path)).map((f) => f.path).sort(), [files]);
  const selectedFile = useStore((s) => s.httpFile);
  const file = selectedFile && httpFiles.includes(selectedFile) ? selectedFile : httpFiles[0] ?? null;
  const text = useStore((s) => (file ? s.texts[file] : undefined));
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [reqTab, setReqTab] = useState<ReqTab>("headers");
  const [resTab, setResTab] = useState<ResTab>("body");
  const [responses, setResponses] = useState<Record<string, HttpResponse>>({});
  const [busy, setBusy] = useState(false);

  // Tum .http dosyalarini sol liste icin yukle
  const texts = useStore((s) => s.texts);
  useEffect(() => {
    for (const f of httpFiles) if (!(f in texts)) void loadText(f);
  }, [httpFiles, texts]);

  const parsed = useMemo<HttpFile | null>(() => (text === undefined ? null : parseHttp(text)), [text]);
  // Kimlikler her ayristirmada degisir: secimi sira numarasiyla koru
  const [selectedIndex, setSelectedIndex] = useState(0);
  const req = parsed?.requests[Math.min(selectedIndex, Math.max(0, (parsed?.requests.length ?? 1) - 1))] ?? null;
  void selectedId;

  const save = (f: HttpFile) => file && updateText(file, serializeHttp(f));
  const patch = (fn: (r: HttpReq) => HttpReq) => {
    if (!parsed || !req) return;
    save({ ...parsed, requests: parsed.requests.map((r) => (r === req ? fn(r) : r)) });
  };
  const respKey = file && req ? `${file}#${selectedIndex}` : "";
  const response = respKey ? responses[respKey] : undefined;

  const send = async () => {
    if (!parsed || !req || busy) return;
    setBusy(true);
    try {
      const headers: Record<string, string> = {};
      for (const [k, v] of req.headers) if (k.trim()) headers[k.trim()] = applyVars(v, parsed.vars);
      const res = await api.http.send({ method: req.method, url: applyVars(req.url, parsed.vars), headers, body: applyVars(req.body, parsed.vars) });
      setResponses((r) => ({ ...r, [respKey]: res }));
      setResTab("body");
    } finally {
      setBusy(false);
    }
  };

  if (!httpFiles.length)
    return (
      <div className="empty-state col">
        <p>Henüz istek dosyası yok.</p>
        <button className="btn primary" onClick={newRequestFile}><FilePlus size={15} /> Yeni istek dosyası</button>
      </div>
    );

  const pretty = response && !response.error ? prettyBody(response) : null;

  return (
    <div className="http-view">
      <aside className="http-list">
        <div className="panel-head">
          <span className="panel-title">İstekler</span>
          <div className="panel-actions">
            <button className="icon-btn" title="Yeni istek dosyası" onClick={newRequestFile}><FilePlus size={15} /></button>
            <button
              className="icon-btn"
              title="Bu dosyaya yeni istek"
              onClick={() => {
                if (!parsed) return;
                save({ ...parsed, requests: [...parsed.requests, { id: newId(), name: "Yeni istek", method: "GET", url: "https://", headers: [], body: "" }] });
                setSelectedIndex(parsed.requests.length);
              }}
            >
              <Plus size={15} />
            </button>
          </div>
        </div>
        <div className="http-files">
          {httpFiles.map((f) => {
            const reqs = texts[f] !== undefined ? parseHttp(texts[f]).requests : [];
            return (
              <div key={f} className="http-file">
                <div className={`http-file-name${f === file ? " on" : ""}`} onClick={() => { useStore.setState({ httpFile: f }); setSelectedIndex(0); }}>
                  {title(f)}
                </div>
                {reqs.map((r, i) => (
                  <div
                    key={i}
                    className={`http-item${f === file && i === selectedIndex ? " on" : ""}`}
                    onClick={() => {
                      useStore.setState({ httpFile: f });
                      setSelectedIndex(i);
                      setSelectedId(r.id);
                    }}
                  >
                    <span className={`method m-${r.method.toLowerCase()}`}>{r.method}</span>
                    <span className="http-item-name">{r.name}</span>
                  </div>
                ))}
              </div>
            );
          })}
        </div>
      </aside>

      {req && parsed ? (
        <div className="http-main">
          <div className="http-name-row">
            <input className="plain-input title" value={req.name} onChange={(e) => patch((r) => ({ ...r, name: e.target.value }))} />
            <button className="icon-btn" title="cURL olarak kopyala" onClick={() => void navigator.clipboard.writeText(toCurl(req, parsed.vars)).then(() => toast("cURL komutu kopyalandı"))}>
              <Terminal size={15} />
            </button>
            <button
              className="icon-btn"
              title="İsteği sil"
              onClick={() => {
                save({ ...parsed, requests: parsed.requests.filter((r) => r !== req) });
                setSelectedIndex(Math.max(0, selectedIndex - 1));
              }}
            >
              <Trash2 size={15} />
            </button>
          </div>
          <div className="url-row">
            <select className={`method-select m-${req.method.toLowerCase()}`} value={req.method} onChange={(e) => patch((r) => ({ ...r, method: e.target.value }))}>
              {METHODS.map((m) => <option key={m}>{m}</option>)}
            </select>
            <input
              className="url-input"
              value={req.url}
              spellCheck={false}
              placeholder="https://api.ornek.com/kaynak  ({{degisken}} kullanılabilir)"
              onChange={(e) => patch((r) => ({ ...r, url: e.target.value }))}
              onKeyDown={(e) => e.key === "Enter" && void send()}
            />
            <button className="btn primary send" disabled={busy} onClick={() => void send()} title="Gönder (Enter / Ctrl+Enter)">
              <Send size={14} /> {busy ? "Gönderiliyor…" : "Gönder"}
            </button>
          </div>

          <div className="tabs-row">
            {(["headers", "body", "vars"] as ReqTab[]).map((t) => (
              <button key={t} className={reqTab === t ? "on" : ""} onClick={() => setReqTab(t)}>
                {t === "headers" ? `Başlıklar (${req.headers.length})` : t === "body" ? "Gövde" : `Değişkenler (${parsed.vars.length})`}
              </button>
            ))}
          </div>
          <div className="req-pane">
            {reqTab === "headers" && (
              <KeyValues
                rows={req.headers}
                onChange={(rows) => patch((r) => ({ ...r, headers: rows }))}
                keyHint="Content-Type"
                valueHint="application/json"
              />
            )}
            {reqTab === "body" && (
              <CodeEditor
                className="req-body"
                value={req.body}
                language={/json/i.test(req.headers.find(([k]) => /content-type/i.test(k))?.[1] ?? "json") ? "json" : ""}
                onChange={(v) => patch((r) => ({ ...r, body: v }))}
                onSubmit={() => void send()}
              />
            )}
            {reqTab === "vars" && (
              <KeyValues rows={parsed.vars} onChange={(rows) => save({ ...parsed, vars: rows })} keyHint="baseUrl" valueHint="https://api.ornek.com" />
            )}
          </div>

          <div className="response">
            {!response && <div className="response-empty">Yanıt burada görünecek. Enter veya Ctrl+Enter ile gönder.</div>}
            {response?.error && <div className="response-error">{response.error} <span className="faint">({response.timeMs} ms)</span></div>}
            {response && !response.error && (
              <>
                <div className="response-meta">
                  <span className={`status ${statusClass(response.status)}`}>{response.status} {response.statusText}</span>
                  <span>{response.timeMs} ms</span>
                  <span>{fmtSize(response.size)}{response.truncated ? " (ilk 5 MB)" : ""}</span>
                  <div className="tabs-row inline">
                    <button className={resTab === "body" ? "on" : ""} onClick={() => setResTab("body")}>Gövde</button>
                    <button className={resTab === "headers" ? "on" : ""} onClick={() => setResTab("headers")}>Başlıklar ({response.headers?.length ?? 0})</button>
                  </div>
                  <button className="icon-btn" title="Yanıtı kopyala" onClick={() => void navigator.clipboard.writeText(pretty?.text ?? "").then(() => toast("Yanıt kopyalandı"))}>
                    <Copy size={14} />
                  </button>
                </div>
                {resTab === "body" ? (
                  <CodeEditor className="response-body" value={pretty?.text ?? ""} language={pretty?.lang} readOnly wrap />
                ) : (
                  <div className="header-table">
                    {response.headers?.map(([k, v], i) => (
                      <div key={i} className="header-row"><span className="hk">{k}</span><span className="hv">{v}</span></div>
                    ))}
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      ) : (
        <div className="empty-state">Bu dosyada istek yok. Soldaki + ile ekle.</div>
      )}
    </div>
  );
}

function KeyValues({ rows, onChange, keyHint, valueHint }: { rows: [string, string][]; onChange: (r: [string, string][]) => void; keyHint: string; valueHint: string }) {
  // Yeni satir, anahtar yazilana kadar yerel taslakta durur (bos anahtar dosyaya yazilamaz)
  const [draft, setDraft] = useState<[string, string] | null>(null);
  const [justAdded, setJustAdded] = useState(false);
  const set = (i: number, j: 0 | 1, v: string) => onChange(rows.map((r, k) => (k === i ? ((j === 0 ? [v, r[1]] : [r[0], v]) as [string, string]) : r)));
  return (
    <div className="kv">
      {rows.map(([k, v], i) => (
        <div key={i} className="kv-row">
          <input
            className="plain-input"
            value={k}
            placeholder={keyHint}
            spellCheck={false}
            autoFocus={justAdded && i === rows.length - 1}
            onFocus={(e) => {
              if (justAdded) {
                const n = e.currentTarget.value.length;
                e.currentTarget.setSelectionRange(n, n);
                setJustAdded(false);
              }
            }}
            onChange={(e) => set(i, 0, e.target.value)}
          />
          <input className="plain-input" value={v} placeholder={valueHint} spellCheck={false} onChange={(e) => set(i, 1, e.target.value)} />
          <button className="icon-btn small" title="Sil" onClick={() => onChange(rows.filter((_, k) => k !== i))}><Trash2 size={13} /></button>
        </div>
      ))}
      {draft && (
        <div className="kv-row">
          <input
            autoFocus
            className="plain-input"
            value={draft[0]}
            placeholder={keyHint}
            spellCheck={false}
            onChange={(e) => {
              const k = e.target.value;
              if (k.trim()) {
                onChange([...rows, [k, draft[1]]]);
                setDraft(null);
                setJustAdded(true);
              } else setDraft([k, draft[1]]);
            }}
          />
          <input className="plain-input" value={draft[1]} placeholder={valueHint} spellCheck={false} onChange={(e) => setDraft([draft[0], e.target.value])} />
          <button className="icon-btn small" title="Vazgeç" onClick={() => setDraft(null)}><Trash2 size={13} /></button>
        </div>
      )}
      {!draft && <button className="board-add" onClick={() => setDraft(["", ""])}><Plus size={14} /> Ekle</button>}
    </div>
  );
}
