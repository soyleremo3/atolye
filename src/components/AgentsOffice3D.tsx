/**
 * Ajan ofisi ekrani: ortada 3B kopek ofisi; solda ozet karti, sagda onaylar ve canli akis, ustte calisan sayisi.
 * Tum veriler ajan reposundan (durum.json, onaylar, git gunlugu) ve "Hemen calistir" olaylarindan gelir.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { CircleAlert, FileText, Info, Maximize2, PanelRightClose, PanelRightOpen, Play, Tags, X, ZoomIn } from "lucide-react";
import { api, type AgentRole, type AgentRunEvent, type AgentsSnapshot } from "../api";
import { DogOffice, type OfficeAgent, type OfficeState } from "../lib/dogOffice";
import { toast } from "../store";

type Props = {
  snap: AgentsSnapshot;
  active: boolean;
  onOpen: (title: string, rel: string) => void;
  onRun: () => void;
  onApprovals: () => void;
  onChanged: () => void;
  ago: (iso: string | null | undefined) => string;
  modelLabel: (m: string) => string;
};

const STATE_TR: Record<OfficeState, string> = { idle: "Uyuyor", working: "Çalışıyor", done: "Bitirdi", failed: "Hata", blocked: "Takıldı", planned: "Planlı" };
const provider = (m: string): OfficeAgent["provider"] => (m.startsWith("claude-") ? "claude" : m.startsWith("google-") ? "google" : "none");
const short = (s: string) => s.replace(/\s*\(.*\)\s*$/, "").split(/\s+/).slice(0, 3).join(" ");
const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

function greeting(d = new Date()) {
  const h = d.getHours();
  return h < 6 ? "İyi geceler." : h < 12 ? "Günaydın." : h < 18 ? "İyi günler." : "İyi akşamlar.";
}

export function AgentsOffice3D({ snap, active, onOpen, onRun, onApprovals, onChanged, ago, modelLabel }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const office = useRef<DogOffice | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [running, setRunning] = useState<{ role: string; tool: string } | null>(null);
  const [feed, setFeed] = useState<{ at: number; who: string; text: string; tone?: "ok" | "bad" }[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [hidden, setHidden] = useState<string[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [width, setWidth] = useState(1400);
  const compact = width < 1350;
  const [helloOpen, setHelloOpen] = useState<boolean | null>(null);
  const [sideOpen, setSideOpen] = useState<boolean | null>(null);
  const [allLabels, setAllLabels] = useState(false);
  const showHello = helloOpen ?? !compact;
  const showSide = sideOpen ?? width > 1050;
  const rootRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setWidth(el.clientWidth));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const cb = useRef({ onApprovals });
  cb.current = { onApprovals };
  const roleName = (id: string) => snap.roles.find((r) => r.id === id)?.ad ?? id;

  // "Hemen calistir" olaylari: calisan kopek + canli akis
  useEffect(() => {
    void api.agents.runs().then((r) => {
      const live = r.find((x) => !x.ended);
      if (live) setRunning({ role: live.role, tool: "" });
    });
    const roleOf = new Map<string, string>();
    return api.agents.onEvent((e: AgentRunEvent) => {
      const push = (role: string, text: string, tone?: "ok" | "bad") => setFeed((f) => [{ at: e.at, who: role, text, tone }, ...f].slice(0, 40));
      if (e.kind === "start") {
        void api.agents.runs().then((r) => {
          const role = r.find((x) => x.id === e.runId)?.role ?? "";
          roleOf.set(e.runId, role);
          setRunning({ role, tool: "" });
          push(role, "işe başladı");
        });
      } else if (e.kind === "tool") {
        const role = roleOf.get(e.runId) ?? "";
        setRunning((r) => (r ? { ...r, tool: e.text } : r));
        push(role, e.text);
      } else if (e.kind === "end") {
        const role = roleOf.get(e.runId) ?? "";
        setRunning(null);
        push(role, e.text === "bitti" ? "işi bitirdi" : e.text, e.text === "bitti" ? "ok" : "bad");
        onChanged();
      }
    });
  }, [onChanged]);

  const agents = useMemo<OfficeAgent[]>(
    () =>
      snap.roles.map((r) => {
        const live = r.live;
        const state = (r.status === "planned" ? "planned" : running?.role === r.id ? "working" : live?.state ?? "idle") as OfficeState;
        const line =
          state === "planned" ? "planlı · henüz kurulmadı"
          : state === "working" ? `çalışıyor: ${clip(running?.role === r.id && running.tool ? running.tool : live?.did || live?.next || "iş yapıyor", 40)}`
          : state === "blocked" ? `takıldı: ${clip(live?.blockedOn || "", 40)}`
          : state === "failed" ? `hata · ${ago(live?.lastRun)}`
          : state === "done" ? `bitti · ${ago(live?.lastRun)}`
          : `uyuyor · ${live?.lastRun ? `son iş ${ago(live.lastRun)}` : "hiç çalışmadı"}`;
        return { id: r.id, number: r.number, label: short(r.ad ?? r.name), team: r.team, provider: provider(r.model), lead: r.id === "manager", state, line };
      }),
    [snap.roles, running, ago],
  );

  useEffect(() => {
    if (!host.current) return;
    try {
      office.current = new DogOffice(host.current, {
        onSelect: (hit) => {
          if (hit?.kind === "approvals") cb.current.onApprovals();
          else setSelected(hit?.kind === "agent" ? hit.id : null);
        },
      });
      (window as unknown as { __office?: DogOffice }).__office = office.current;
    } catch (e) {
      setError(`3B ofis açılamadı (${String((e as Error).message || e)}). Kart görünümünü kullan.`);
    }
    return () => {
      office.current?.dispose();
      office.current = null;
    };
  }, []);

  const pending = snap.approvals.pending.filter((a) => !hidden.includes(a.name));
  useEffect(() => office.current?.setAgents(agents, snap.approvals.pending.length), [agents, snap.approvals.pending.length]);
  useEffect(() => office.current?.setActive(active), [active]);
  useEffect(() => office.current?.select(selected), [selected]);
  useEffect(() => office.current?.setInsets(showHello ? 296 : 16, showSide ? (compact ? 280 : 326) : 16), [showHello, showSide, compact]);
  useEffect(() => office.current?.setShowAllLabels(allLabels), [allLabels]);

  const counts = useMemo(() => {
    const c = { working: 0, idle: 0, planned: 0, done: 0, blocked: 0 };
    for (const a of agents) if (a.state in c) c[a.state as keyof typeof c]++;
    return c;
  }, [agents]);
  const lastCloud = snap.roles.find((r) => r.id === "manager")?.live;

  const decide = async (name: string) => {
    setBusy(name);
    try {
      toast(await api.agents.decide(name, "approved", ""));
      onChanged();
    } catch (e) {
      toast(String((e as Error).message || e), "error");
    } finally {
      setBusy(null);
    }
  };

  const role: AgentRole | null = snap.roles.find((r) => r.id === selected) ?? null;
  const roleState = agents.find((a) => a.id === selected)?.state ?? "idle";
  const commits = snap.commits.slice(0, 8);

  return (
    <div className={`office${compact ? " compact" : ""}`} ref={rootRef}>
      <div ref={host} className="office-stage" />
      {error && <div className="ag-error office-error"><CircleAlert size={14} /> {error}</div>}

      <div className="office-tools">
        <button className={`office-tool glass${showHello ? " on" : ""}`} title="Özet" onClick={() => setHelloOpen(!showHello)}><Info size={15} /></button>
        <button className="office-tool glass" title="Tüm ofisi göster" onClick={() => office.current?.focus(null)}><Maximize2 size={15} /></button>
        <button className={`office-tool glass${allLabels ? " on" : ""}`} title="Tüm etiketleri göster" onClick={() => setAllLabels(!allLabels)}><Tags size={15} /></button>
        <button className={`office-tool glass${showSide ? " on" : ""}`} title="Onaylar ve akış paneli" onClick={() => setSideOpen(!showSide)}>{showSide ? <PanelRightClose size={15} /> : <PanelRightOpen size={15} />}</button>
      </div>

      {showHello && <section className="office-hello glass">
        <small>{new Date().toLocaleDateString("tr-TR", { day: "numeric", month: "long", weekday: "long" })}</small>
        <h2>{greeting()}</h2>
        <p>
          Ofiste <b>{counts.working} ajan</b> çalışıyor, <b>{counts.idle} ajan</b> uyuyor
          {counts.planned ? <>, {counts.planned} planlı</> : null}. Boştayken harcama: <b>0</b>.
        </p>
        {lastCloud?.lastRun && <p>Yönetici en son <b>{ago(lastCloud.lastRun)}</b> çalıştı: {clip(lastCloud.did || "—", 90)}</p>}
        <p>{snap.approvals.pending.length ? <>Senden <b>{snap.approvals.pending.length} onay</b> bekleniyor.</> : "Bekleyen onay yok."}</p>
      </section>}

      <div className="office-pill glass"><i className={`dot${counts.working ? " live" : ""}`} /> {counts.working} ajan çalışıyor</div>

      {showSide && <aside className="office-side">
        <section className="glass office-box">
          <header><b>Yönetici soruyor</b>{pending.length > 0 && <span className="muted">{pending.length} onay bekliyor</span>}</header>
          {pending.length === 0 && <p className="muted small">Şu an sana sorulacak önemli bir iş yok.</p>}
          {pending.slice(0, 3).map((a) => (
            <article key={a.name} className="office-ask">
              <small className="muted">{roleName(a.fm.from ?? "")} · {ago(a.fm.created)}</small>
              <b>{a.body.match(/^#\s+(.+)$/m)?.[1] ?? a.name}</b>
              <p>{clip((a.body.match(/\*\*Ne isteniyor:\*\*\s*(.+)/)?.[1] ?? "").trim(), 120)}</p>
              <div className="office-ask-actions">
                <button className="btn dark" disabled={busy === a.name} onClick={() => void decide(a.name)}>Onayla</button>
                <button className="btn" onClick={() => setHidden([...hidden, a.name])}>Sonra</button>
                <button className="link-btn" onClick={onApprovals}>Ayrıntı</button>
              </div>
            </article>
          ))}
        </section>
        <section className="glass office-box office-feed">
          <header><b>Az önce olanlar</b>{running && <span className="live-tag"><i className="dot live" /> Canlı</span>}</header>
          {feed.map((f, i) => (
            <div key={`f${i}`} className={`office-feed-row${f.tone ? ` ${f.tone}` : ""}`}>
              <span className={`avatar pv-${provider(snap.roles.find((r) => r.id === f.who)?.model ?? "")}`} />
              <div><b>{roleName(f.who)}</b> {f.text}<small className="muted"> · {new Date(f.at).toLocaleTimeString("tr-TR", { hour: "2-digit", minute: "2-digit" })}</small></div>
            </div>
          ))}
          {commits.map((c) => (
            <div key={c.hash} className="office-feed-row">
              <span className="avatar git" />
              <div>{clip(c.subject, 70)}<small className="muted"> · {ago(c.date)}</small></div>
            </div>
          ))}
          {!feed.length && !commits.length && <p className="muted small">Henüz hareket yok.</p>}
        </section>
      </aside>}

      {role && (
        <section className="office-detail glass">
          <header>
            <span className="ag-num">{role.number}</span>
            <b>{role.ad ?? role.name}</b>
            <button className="icon-btn" onClick={() => setSelected(null)}><X size={15} /></button>
          </header>
          <div className={`ag-pill st-${roleState}`}>{STATE_TR[roleState]}</div>
          <div className="ag-model">{modelLabel(role.model)} · {role.zaman ?? role.schedule}</div>
          {role.status === "planned" ? (
            <p className="muted">Henüz kurulmadı.</p>
          ) : (
            <>
              <p><span className="muted">Son iş:</span> {role.live?.did || "—"} <span className="muted">({ago(role.live?.lastRun)})</span></p>
              {role.live?.next && <p><span className="muted">Sıradaki:</span> {role.live.next}</p>}
              {role.live?.blockedOn && <p className="st-blocked"><CircleAlert size={12} /> {role.live.blockedOn}</p>}
            </>
          )}
          <div className="office-detail-actions">
            <button className="btn" onClick={() => office.current?.focus(role.id)}><ZoomIn size={14} /> Odaya git</button>
            <button className="btn" onClick={() => onOpen(`${role.number} · ${role.ad ?? role.name}: görev`, `roller/${role.id}/rol.md`)}><FileText size={14} /> Görev</button>
            <button className="btn" onClick={() => onOpen(`${role.number} · ${role.ad ?? role.name}: defter`, `roller/${role.id}/defter.md`)}><FileText size={14} /> Defter</button>
            {role.status === "active" && role.agent !== false && provider(role.model) === "claude" && (
              <button className="btn dark" onClick={onRun}><Play size={14} /> Çalıştır</button>
            )}
          </div>
        </section>
      )}
    </div>
  );
}
