/**
 * Ajanlar: basketball-agents reposunu tek ekranda gosterir.
 * Ofis (roller ve durumlari) · Onaylar (sahibin karari) · Pano (isler) · Raporlar · Notlar · Calistir.
 * Veriler ana surecten gelir (agents:*); bu bilesen hicbir dosyaya dogrudan erismez.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  Bot, Check, CircleAlert, CircleDot, FileText, FolderOpen, KanbanSquare, Loader2, MessageSquarePlus, Moon, Play, RefreshCw,
  ScrollText, ShieldCheck, Square, X,
} from "lucide-react";
import { api, type AgentItem, type AgentRole, type AgentRun, type AgentRunEvent, type AgentsConfig, type AgentsSnapshot } from "../api";
import { md, stripFrontmatter } from "../lib/markdown";
import { isDark, toast, useStore } from "../store";
import { AgentsOffice3D } from "./AgentsOffice3D";

type TabId = "office" | "approvals" | "board" | "reports" | "notes" | "runs";
const TABS: { id: TabId; label: string; icon: ReactNode }[] = [
  { id: "office", label: "Ofis", icon: <Bot size={15} /> },
  { id: "approvals", label: "Onaylar", icon: <ShieldCheck size={15} /> },
  { id: "board", label: "Pano", icon: <KanbanSquare size={15} /> },
  { id: "reports", label: "Raporlar", icon: <ScrollText size={15} /> },
  { id: "notes", label: "Notlar", icon: <MessageSquarePlus size={15} /> },
  { id: "runs", label: "Çalıştır", icon: <Play size={15} /> },
];
const TEAMS: Record<string, string> = { lead: "Yönetim", developer: "Developer", sales: "Satış", general: "Genel" };
const STATE_LABEL: Record<string, string> = { idle: "Uyuyor", working: "Çalışıyor", done: "Bitti", failed: "Hata", blocked: "Takıldı" };
const SYNC_EVERY_MS = 5 * 60_000;
const REFRESH_EVERY_MS = 20_000;

const html = (src: string) => md.render(stripFrontmatter(src));
const ago = (iso: string | null | undefined) => {
  if (!iso) return "hiç çalışmadı";
  const ms = Date.now() - Date.parse(iso);
  if (Number.isNaN(ms)) return iso;
  const m = Math.round(ms / 60_000);
  if (m < 1) return "az önce";
  if (m < 60) return `${m} dk önce`;
  const h = Math.round(m / 60);
  return h < 48 ? `${h} sa önce` : `${Math.round(h / 24)} gün önce`;
};
const modelLabel = (m: string) =>
  m.startsWith("claude-") ? `Claude ${m.slice(7).replace(/^./, (c) => c.toUpperCase())}` : m.startsWith("google-") ? `Google · ${m.slice(7).replace(/-/g, " ")}` : m === "none" ? "ajan değil" : m;
const provider = (m: string) => (m.startsWith("claude-") ? "claude" : m.startsWith("google-") ? "google" : "none");

async function act(p: Promise<string>, after: () => void) {
  try {
    toast(await p);
    after();
  } catch (e) {
    toast(String((e as Error).message || e), "error");
  }
}

export function AgentsView({ active }: { active: boolean }) {
  const [tab, setTab] = useState<TabId>("office");
  const [snap, setSnap] = useState<AgentsSnapshot | null>(null);
  const [cfg, setCfg] = useState<AgentsConfig | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [doc, setDoc] = useState<{ title: string; text: string } | null>(null);
  const [officeView, setOfficeView] = useState<"3d" | "cards">(() => {
    try {
      return localStorage.getItem("atolye.agents.view") === "cards" ? "cards" : "3d";
    } catch {
      return "3d";
    }
  });
  const dark = useStore(isDark);
  const pickView = (v: "3d" | "cards") => {
    setOfficeView(v);
    try {
      localStorage.setItem("atolye.agents.view", v);
    } catch {
      /* yok sayilir */
    }
  };
  const lastSync = useRef(0);

  const refresh = useCallback(async () => {
    try {
      const s = await api.agents.snapshot();
      setSnap(s);
      setError(null);
      useStore.setState({ agentsPending: s.approvals.pending.length });
    } catch (e) {
      setError(String((e as Error).message || e));
    }
  }, []);

  const sync = useCallback(async (quiet = false) => {
    setSyncing(true);
    try {
      const msg = await api.agents.sync();
      lastSync.current = Date.now();
      if (!quiet) toast(`Eşitlendi: ${msg}`);
    } catch (e) {
      if (!quiet) toast(String((e as Error).message || e), "error");
    } finally {
      setSyncing(false);
      void refresh();
    }
  }, [refresh]);

  useEffect(() => {
    void api.agents.config().then(setCfg);
    void sync(true);
  }, [sync]);

  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => {
      if (Date.now() - lastSync.current > SYNC_EVERY_MS) void sync(true);
      else void refresh();
    }, REFRESH_EVERY_MS);
    return () => clearInterval(t);
  }, [active, refresh, sync]);

  const open = async (title: string, rel: string) => {
    try {
      setDoc({ title, text: await api.agents.read(rel) });
    } catch (e) {
      toast(String((e as Error).message || e), "error");
    }
  };

  const choose = async (which: "repo" | "app") => {
    setCfg(await api.agents.choose(which));
    void refresh();
  };

  return (
    <div className="ag">
      <header className="ag-head">
        <div className="ag-title"><Bot size={18} /> Ajanlar</div>
        <nav className="ag-tabs">
          {TABS.map((t) => (
            <button key={t.id} className={`ag-tab${tab === t.id ? " on" : ""}`} onClick={() => setTab(t.id)}>
              {t.icon} {t.label}
              {t.id === "approvals" && (snap?.approvals.pending.length ?? 0) > 0 && <span className="ag-count">{snap!.approvals.pending.length}</span>}
            </button>
          ))}
        </nav>
        <div className="ag-head-actions">
          <button className="btn" title="git pull: buluttaki son durumu getir" onClick={() => void sync()} disabled={syncing}>
            {syncing ? <Loader2 size={14} className="spin" /> : <RefreshCw size={14} />} Eşitle
          </button>
          <button className="icon-btn" title="Ajan reposunu seç" onClick={() => void choose("repo")}><FolderOpen size={16} /></button>
        </div>
      </header>

      {error && (
        <div className="ag-error">
          <CircleAlert size={16} /> {error}
          <button className="btn" onClick={() => void choose("repo")}>basketball-agents klasörünü seç</button>
        </div>
      )}

      {snap && (
        <div className="ag-body">
          {tab === "office" && (
            <>
              <div className="ag-viewswitch">
                <button className={`ag-tab${officeView === "3d" ? " on" : ""}`} onClick={() => pickView("3d")}>3B ofis</button>
                <button className={`ag-tab${officeView === "cards" ? " on" : ""}`} onClick={() => pickView("cards")}>Kartlar</button>
              </div>
              {officeView === "3d" ? (
                <AgentsOffice3D roles={snap.roles} pending={snap.approvals.pending.length} active={active && tab === "office"} dark={dark}
                  onOpen={open} onRun={() => setTab("runs")} onApprovals={() => setTab("approvals")} ago={ago} modelLabel={modelLabel} />
              ) : (
                <Office snap={snap} onOpen={open} onRun={() => setTab("runs")} />
              )}
            </>
          )}
          {tab === "approvals" && <Approvals snap={snap} onDone={() => void refresh()} />}
          {tab === "board" && <Board snap={snap} onOpen={open} onDone={() => void refresh()} />}
          {tab === "reports" && <Reports snap={snap} onOpen={open} />}
          {tab === "notes" && <Notes snap={snap} onOpen={open} onDone={() => void refresh()} />}
          {tab === "runs" && <Runs snap={snap} cfg={cfg} onChooseApp={() => void choose("app")} />}
        </div>
      )}

      {doc && (
        <div className="ag-doc-backdrop" onClick={() => setDoc(null)}>
          <div className="ag-doc" onClick={(e) => e.stopPropagation()}>
            <div className="ag-doc-head"><FileText size={15} /> {doc.title}<button className="icon-btn" onClick={() => setDoc(null)}><X size={16} /></button></div>
            <article className="markdown ag-doc-body" dangerouslySetInnerHTML={{ __html: html(doc.text || "_(boş)_") }} />
          </div>
        </div>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ Ofis
function Office({ snap, onOpen, onRun }: { snap: AgentsSnapshot; onOpen: (t: string, rel: string) => void; onRun: () => void }) {
  const byTeam = useMemo(() => {
    const m = new Map<string, AgentRole[]>();
    for (const r of snap.roles) m.set(r.team, [...(m.get(r.team) ?? []), r]);
    return [...m.entries()].sort(([a], [b]) => Object.keys(TEAMS).indexOf(a) - Object.keys(TEAMS).indexOf(b));
  }, [snap.roles]);
  const counts = useMemo(() => {
    const c = { working: 0, blocked: 0, failed: 0, planned: 0 };
    for (const r of snap.roles) {
      if (r.status === "planned") c.planned++;
      else if (r.live?.state === "working") c.working++;
      else if (r.live?.state === "blocked") c.blocked++;
      else if (r.live?.state === "failed") c.failed++;
    }
    return c;
  }, [snap.roles]);
  return (
    <div className="ag-office">
      <div className="ag-summary">
        <span><b>{snap.roles.length}</b> rol</span>
        <span className="st-working"><b>{counts.working}</b> çalışıyor</span>
        <span className="st-blocked"><b>{counts.blocked}</b> takıldı</span>
        <span className="st-failed"><b>{counts.failed}</b> hata</span>
        <span className="muted"><b>{counts.planned}</b> planlı</span>
        <span className="ag-spacer" />
        <button className="btn" onClick={() => onOpen("Anayasa", "ANAYASA.md")}><ScrollText size={14} /> Anayasa</button>
        <button className="btn" onClick={() => onOpen("Genel defter", "defter/genel.md")}><FileText size={14} /> Genel defter</button>
        <button className="btn" onClick={() => onOpen("Yönetici durumu", "state.md")}><FileText size={14} /> Durum</button>
      </div>
      {byTeam.map(([team, roles]) => (
        <section key={team} className="ag-team">
          <h3>{TEAMS[team] ?? team}</h3>
          <div className="ag-grid">
            {roles.map((r) => {
              const st = r.status === "planned" ? "planned" : r.live?.state ?? "idle";
              return (
                <div key={r.id} className={`ag-card st-${st} pv-${provider(r.model)}`}>
                  <div className="ag-card-top">
                    <span className="ag-num">{r.number}</span>
                    <span className="ag-name" title={r.name}>{r.ad ?? r.name}</span>
                    <span className={`ag-dot st-${st}`} title={st === "planned" ? "Planlı" : STATE_LABEL[st]}>
                      {st === "idle" || st === "planned" ? <Moon size={12} /> : st === "working" ? <Loader2 size={12} className="spin" /> : <CircleDot size={12} />}
                    </span>
                  </div>
                  <div className="ag-model">{modelLabel(r.model)} · {r.zaman ?? r.schedule}</div>
                  {r.status === "planned" ? (
                    <div className="ag-line muted">Planlı: henüz kurulmadı</div>
                  ) : (
                    <>
                      <div className="ag-line"><span className="muted">Son:</span> {r.live?.did || "—"} <span className="muted">({ago(r.live?.lastRun)})</span></div>
                      {r.live?.next && <div className="ag-line"><span className="muted">Sıradaki:</span> {r.live.next}</div>}
                      {r.live?.blockedOn && <div className="ag-line st-blocked"><CircleAlert size={12} /> {r.live.blockedOn}</div>}
                    </>
                  )}
                  <div className="ag-card-actions">
                    <button className="link-btn" onClick={() => onOpen(`${r.number} · ${r.name}: görev`, `roller/${r.id}/rol.md`)}>Görev</button>
                    <button className="link-btn" onClick={() => onOpen(`${r.number} · ${r.name}: defter`, `roller/${r.id}/defter.md`)}>Defter</button>
                    {r.status === "active" && r.agent !== false && provider(r.model) === "claude" && <button className="link-btn" onClick={onRun}>Çalıştır</button>}
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      ))}
      {snap.commits.length > 0 && (
        <section className="ag-team">
          <h3>Son hareketler</h3>
          <ul className="ag-commits">
            {snap.commits.map((c) => <li key={c.hash}><code>{c.hash}</code> {c.subject} <span className="muted">· {ago(c.date)}</span></li>)}
          </ul>
        </section>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ Onaylar
function Approvals({ snap, onDone }: { snap: AgentsSnapshot; onDone: () => void }) {
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const decide = async (a: AgentItem, d: "approved" | "rejected") => {
    setBusy(a.name);
    await act(api.agents.decide(a.name, d, notes[a.name] ?? ""), onDone);
    setBusy(null);
  };
  return (
    <div className="ag-list">
      <p className="ag-hint">Ajanlar önemli işleri (build, mail, paylaşım, bağımlılık, silme, para, kural dosyaları) burada sorar. Gerisine yönetici karar verir.</p>
      {snap.approvals.pending.length === 0 && <div className="empty-state">Bekleyen onay yok.</div>}
      {snap.approvals.pending.map((a) => (
        <article key={a.name} className="ag-approval">
          <div className="ag-approval-meta">
            <span className="ag-pill">{a.fm.action || "istek"}</span> <span className="muted">{a.fm.from} · {ago(a.fm.created)}</span>
          </div>
          <div className="markdown" dangerouslySetInnerHTML={{ __html: html(a.body) }} />
          <div className="ag-approval-actions">
            <input className="text-input" placeholder="Notun (isteğe bağlı)" value={notes[a.name] ?? ""} onChange={(e) => setNotes({ ...notes, [a.name]: e.target.value })} />
            <button className="btn primary" disabled={busy === a.name} onClick={() => void decide(a, "approved")}><Check size={14} /> Onayla</button>
            <button className="btn danger" disabled={busy === a.name} onClick={() => void decide(a, "rejected")}><X size={14} /> Reddet</button>
          </div>
        </article>
      ))}
      {snap.approvals.decided.length > 0 && (
        <>
          <h3 className="ag-sub">Karar verilenler</h3>
          {snap.approvals.decided.map((a) => (
            <div key={a.name} className="ag-row">
              <span className={`ag-pill ${a.fm.decision === "approved" ? "ok" : "no"}`}>{a.fm.decision === "approved" ? "onaylandı" : "reddedildi"}</span>
              {a.body.match(/^#\s+(.+)$/m)?.[1] ?? a.name} <span className="muted">· {ago(a.fm.decided)}</span>
            </div>
          ))}
        </>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ Pano
function Board({ snap, onOpen, onDone }: { snap: AgentsSnapshot; onOpen: (t: string, rel: string) => void; onDone: () => void }) {
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [forWho, setForWho] = useState<"claude" | "agy">("claude");
  const titleOf = (i: AgentItem) =>
    i.body.match(/^#\s+(.+)$/m)?.[1] ?? i.name.replace(/\.md$/, "").replace(/^\d{4}-\d{2}-\d{2}-/, "").replace(/-/g, " ");
  const col = (label: string, dir: string, items: AgentItem[]) => (
    <div className="ag-col">
      <h3>{label} <span className="muted">{items.length}</span></h3>
      {items.map((i) => (
        <button key={i.name} className="ag-ticket" onClick={() => onOpen(titleOf(i), `board/${dir}/${i.name}`)}>
          <span className="ag-ticket-title">{titleOf(i)}</span>
          <span className="muted">{i.fm.for === "agy" ? "Google" : "Claude"}{i.fm.score ? ` · puan ${i.fm.score}` : ""}{i.fm.bar ? ` · ${i.fm.bar}` : ""}</span>
        </button>
      ))}
    </div>
  );
  return (
    <div className="ag-board-wrap">
      <form className="ag-new" onSubmit={(e) => { e.preventDefault(); void act(api.agents.newTask(title, body, forWho), () => { setTitle(""); setBody(""); onDone(); }); }}>
        <input className="text-input" placeholder="Yeni görev başlığı (örn. Hakem doğruluğunu ölç)" value={title} onChange={(e) => setTitle(e.target.value)} />
        <textarea className="text-input" rows={2} placeholder="Ayrıntı (isteğe bağlı)" value={body} onChange={(e) => setBody(e.target.value)} />
        <div className="ag-new-row">
          <select className="text-input" value={forWho} onChange={(e) => setForWho(e.target.value as "claude" | "agy")}>
            <option value="claude">Claude ajanları</option>
            <option value="agy">Google (Antigravity)</option>
          </select>
          <button className="btn primary" type="submit" disabled={!title.trim()}><MessageSquarePlus size={14} /> Panoya ekle</button>
        </div>
      </form>
      <div className="ag-board">
        {col("Bekleyen", "inbox", snap.board.inbox)}
        {col("Yapılıyor", "doing", snap.board.doing)}
        {col("Bitti", "done", snap.board.done)}
        <div className="ag-col">
          <h3>Sonuçlar <span className="muted">{snap.board.results.length}</span></h3>
          {snap.board.results.map((n) => <button key={n} className="ag-ticket" onClick={() => onOpen(n, `board/results/${n}`)}><span className="ag-ticket-title">{n.replace(/\.md$/, "")}</span></button>)}
        </div>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ Raporlar
function Reports({ snap, onOpen }: { snap: AgentsSnapshot; onOpen: (t: string, rel: string) => void }) {
  const kinds: [string, string][] = [["gunluk", "Günlük"], ["haftalik", "Haftalık"], ["aylik", "Aylık"]];
  return (
    <div className="ag-board">
      {kinds.map(([k, label]) => {
        const list = snap.reports.filter((r) => r.kind === k);
        return (
          <div key={k} className="ag-col">
            <h3>{label} <span className="muted">{list.length}</span></h3>
            {list.length === 0 && <div className="muted ag-pad">Henüz yok</div>}
            {list.map((r) => <button key={r.name} className="ag-ticket" onClick={() => onOpen(`${label} rapor · ${r.name.replace(/\.md$/, "")}`, `raporlar/${k}/${r.name}`)}><span className="ag-ticket-title">{r.name.replace(/\.md$/, "")}</span></button>)}
          </div>
        );
      })}
    </div>
  );
}

// ------------------------------------------------------------------ Notlar
function Notes({ snap, onOpen, onDone }: { snap: AgentsSnapshot; onOpen: (t: string, rel: string) => void; onDone: () => void }) {
  const [text, setText] = useState("");
  const [who, setWho] = useState<string[]>([]);
  const toggle = (n: string) => setWho(who.includes(n) ? who.filter((x) => x !== n) : [...who, n]);
  return (
    <div className="ag-list">
      <p className="ag-hint">Verdiğin bilgi, seçtiğin ajanların defterine bağlanır (yönetici her çalışmada okur). Kimseyi seçmezsen herkes içindir.</p>
      <form className="ag-new" onSubmit={(e) => { e.preventDefault(); void act(api.agents.note(text, who.length ? who.join(", ") : "hepsi"), () => { setText(""); setWho([]); onDone(); }); }}>
        <textarea className="text-input" rows={3} placeholder="Örn. Bu hafta Kadıköy sahasında çekim yapacağım." value={text} onChange={(e) => setText(e.target.value)} />
        <div className="ag-chips">
          {snap.roles.filter((r) => r.model !== "none").map((r) => (
            <button type="button" key={r.id} className={`ag-chip${who.includes(r.number) ? " on" : ""}`} onClick={() => toggle(r.number)} title={r.ad ?? r.name}>{r.number} {(r.ad ?? r.name).split(" ")[0]}</button>
          ))}
        </div>
        <button className="btn primary" type="submit" disabled={!text.trim()}><MessageSquarePlus size={14} /> Notu kaydet</button>
      </form>
      <button className="btn" onClick={() => onOpen("Sahip notları", "sahip-notlari.md")}><FileText size={14} /> Tüm notlar</button>
    </div>
  );
}

// ------------------------------------------------------------------ Calistir
function Runs({ snap, cfg, onChooseApp }: { snap: AgentsSnapshot; cfg: AgentsConfig | null; onChooseApp: () => void }) {
  const runnable = snap.roles.filter((r) => r.status === "active" && r.agent !== false && provider(r.model) === "claude");
  const [role, setRole] = useState(runnable[0]?.id ?? "");
  const [task, setTask] = useState("");
  const [runs, setRuns] = useState<AgentRun[]>([]);
  const [live, setLive] = useState<AgentRunEvent[]>([]);
  const running = runs.some((r) => !r.ended);

  useEffect(() => {
    void api.agents.runs().then(setRuns);
    return api.agents.onEvent((e) => {
      setLive((l) => [...l.slice(-300), e]);
      if (e.kind === "start" || e.kind === "end") void api.agents.runs().then(setRuns);
    });
  }, []);

  const start = async () => {
    try {
      setLive([]);
      await api.agents.run(role, task);
      void api.agents.runs().then(setRuns);
    } catch (e) {
      toast(String((e as Error).message || e), "error");
    }
  };

  return (
    <div className="ag-list">
      <p className="ag-hint">Acil işte bir ajanı şimdi bu PC'de çalıştırır (Claude Pro kotanı kullanır, internet gerekir). Aynı anda tek ajan çalışır; işler sırayla.</p>
      {!cfg?.appPath && <div className="ag-error"><CircleAlert size={14} /> Uygulama reposu seçilmedi. <button className="btn" onClick={onChooseApp}>version6 klasörünü seç</button></div>}
      <div className="ag-new">
        <div className="ag-new-row">
          <select className="text-input" value={role} onChange={(e) => setRole(e.target.value)}>
            {runnable.map((r) => <option key={r.id} value={r.id}>{r.number} · {r.ad ?? r.name} ({modelLabel(r.model)})</option>)}
          </select>
          {running ? (
            <button className="btn danger" onClick={() => void api.agents.stop()}><Square size={14} /> Durdur</button>
          ) : (
            <button className="btn primary" onClick={() => void start()} disabled={!role}><Play size={14} /> Hemen çalıştır</button>
          )}
        </div>
        <textarea className="text-input" rows={2} placeholder="Görev (boş bırakırsan panodaki en önemli işini alır)" value={task} onChange={(e) => setTask(e.target.value)} />
      </div>
      {live.length > 0 && (
        <div className="ag-log">
          {live.map((e, i) => <div key={i} className={`ag-log-line k-${e.kind}`}><span className="muted">{new Date(e.at).toLocaleTimeString("tr-TR")}</span> {e.text}</div>)}
        </div>
      )}
      {runs.length > 0 && (
        <>
          <h3 className="ag-sub">Son çalıştırmalar</h3>
          {runs.map((r) => (
            <div key={r.id} className="ag-row">
              <span className={`ag-pill ${r.ended ? (r.ok ? "ok" : "no") : ""}`}>{r.ended ? (r.ok ? "bitti" : "hata") : "çalışıyor"}</span>
              {r.role} <span className="muted">· {new Date(r.started).toLocaleString("tr-TR")}</span>
              {r.summary && <div className="ag-run-summary">{r.summary}</div>}
            </div>
          ))}
        </>
      )}
    </div>
  );
}
