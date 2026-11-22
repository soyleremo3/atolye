/** 3B kopek ofisi: rolleri masalarinda oturan kopekler olarak gosterir; tiklayinca ayrinti paneli. */
import { useEffect, useMemo, useRef, useState } from "react";
import { CircleAlert, FileText, Play, ShieldCheck, X } from "lucide-react";
import { api, type AgentRole } from "../api";
import { DogOffice, type OfficeAgent, type OfficeState } from "../lib/dogOffice";

type Props = {
  roles: AgentRole[];
  pending: number;
  active: boolean;
  dark: boolean;
  onOpen: (title: string, rel: string) => void;
  onRun: () => void;
  onApprovals: () => void;
  ago: (iso: string | null | undefined) => string;
  modelLabel: (m: string) => string;
};

const STATE_TR: Record<OfficeState, string> = {
  idle: "Uyuyor", working: "Çalışıyor", done: "Bitirdi", failed: "Hata", blocked: "Takıldı", planned: "Planlı",
};
const provider = (m: string): OfficeAgent["provider"] => (m.startsWith("claude-") ? "claude" : m.startsWith("google-") ? "google" : "none");
const short = (s: string) => s.replace(/\s*\(.*\)\s*$/, "").split(/\s+/).slice(0, 2).join(" ");

export function AgentsOffice3D({ roles, pending, active, dark, onOpen, onRun, onApprovals, ago, modelLabel }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const office = useRef<DogOffice | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [running, setRunning] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const cb = useRef({ onApprovals });
  cb.current = { onApprovals };

  // "Hemen calistir" sirasinda o rolun kopegi calisiyor gorunur
  useEffect(() => {
    let role: string | null = null;
    void api.agents.runs().then((r) => setRunning(r.find((x) => !x.ended)?.role ?? null));
    return api.agents.onEvent((e) => {
      if (e.kind === "start") {
        void api.agents.runs().then((r) => {
          role = r.find((x) => x.id === e.runId)?.role ?? null;
          setRunning(role);
        });
      }
      if (e.kind === "end") setRunning(null);
    });
  }, []);

  const agents = useMemo<OfficeAgent[]>(
    () =>
      roles.map((r) => ({
        id: r.id,
        number: r.number,
        label: short(r.ad ?? r.name),
        team: r.team,
        provider: provider(r.model),
        lead: r.id === "manager",
        state: (r.status === "planned" ? "planned" : running === r.id ? "working" : r.live?.state ?? "idle") as OfficeState,
      })),
    [roles, running],
  );

  useEffect(() => {
    if (!host.current) return;
    try {
      office.current = new DogOffice(host.current, {
        dark,
        onSelect: (hit) => {
          if (hit?.kind === "approvals") cb.current.onApprovals();
          else setSelected(hit?.kind === "agent" ? hit.id : null);
        },
      });
    } catch (e) {
      setError(`3B ofis açılamadı (${String((e as Error).message || e)}). Kart görünümünü kullan.`);
    }
    return () => {
      office.current?.dispose();
      office.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => office.current?.setAgents(agents, pending), [agents, pending]);
  useEffect(() => office.current?.setTheme(dark), [dark]);
  useEffect(() => office.current?.setActive(active), [active]);
  useEffect(() => office.current?.select(selected), [selected]);

  const role = roles.find((r) => r.id === selected) ?? null;
  const state = agents.find((a) => a.id === selected)?.state ?? "idle";

  return (
    <div className="ag-3d">
      <div ref={host} className="ag-3d-canvas" />
      {error && <div className="ag-error ag-3d-error"><CircleAlert size={14} /> {error}</div>}
      <div className="ag-3d-legend">
        <span><i className="sw claude" /> Claude</span>
        <span><i className="sw google" /> Google</span>
        <span>Zz uyuyor · ··· çalışıyor · ✓ bitti · ! takıldı · ✗ hata</span>
        <span className="muted">Sürükle: döndür · Tekerlek: yakınlaş · Köpeğe tıkla: ayrıntı</span>
      </div>
      {pending > 0 && (
        <button className="ag-3d-approvals" onClick={onApprovals}><ShieldCheck size={15} /> {pending} onay bekliyor</button>
      )}
      {role && (
        <aside className="ag-3d-panel">
          <div className="ag-3d-panel-head">
            <span className="ag-num">{role.number}</span>
            <b>{role.ad ?? role.name}</b>
            <button className="icon-btn" onClick={() => setSelected(null)}><X size={15} /></button>
          </div>
          <div className={`ag-pill st-${state}`}>{STATE_TR[state]}</div>
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
          <div className="ag-3d-panel-actions">
            <button className="btn" onClick={() => onOpen(`${role.number} · ${role.ad ?? role.name}: görev`, `roller/${role.id}/rol.md`)}><FileText size={14} /> Görev</button>
            <button className="btn" onClick={() => onOpen(`${role.number} · ${role.ad ?? role.name}: defter`, `roller/${role.id}/defter.md`)}><FileText size={14} /> Defter</button>
            {role.status === "active" && role.agent !== false && provider(role.model) === "claude" && (
              <button className="btn primary" onClick={onRun}><Play size={14} /> Çalıştır</button>
            )}
          </div>
        </aside>
      )}
    </div>
  );
}
