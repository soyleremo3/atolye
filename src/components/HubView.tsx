/**
 * Merkez: sahibin her seyi tek yerden gordugu ekran.
 * Robotlar (aktif, siradaki ve son calisma) · Eslitleme (bulut <-> bu PC, otomatik) · Bekleyen onaylar ·
 * Son raporlar (bulut + bu PC) · GitHub (haftalik rapor issue'lari, surum, CI) · Tek tikla Claude Code, Antigravity, Codex.
 */
import { useCallback, useEffect, useState } from "react";
import {
  Bot, Cloud, CloudOff, ExternalLink, FileText, Gauge, GitBranch, Laptop, Loader2, Play, RefreshCw, ShieldCheck, SquareTerminal, TriangleAlert,
} from "lucide-react";
import { api, type AgentsSnapshot, type GhInfo, type ReportItem, type RobotView, type SyncStatus } from "../api";
import { requestTerminal } from "../lib/terminalState";
import { toast, updateSettings, useStore } from "../store";

const when = (iso: string | null) => {
  if (!iso) return "—";
  const d = new Date(iso);
  const now = new Date();
  const day = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const diff = Math.round((day - today) / 86_400_000);
  const hm = d.toLocaleTimeString("tr-TR", { hour: "2-digit", minute: "2-digit" });
  if (diff === 0) return `bugün ${hm}`;
  if (diff === 1) return `yarın ${hm}`;
  if (diff === -1) return `dün ${hm}`;
  return `${d.toLocaleDateString("tr-TR", { weekday: "short", day: "numeric", month: "short" })} ${hm}`;
};

const errText = (e: unknown) => String((e as Error)?.message || e).replace(/^Error invoking remote method '[^']+': (Error: )?/, "");

type Props = {
  snap: AgentsSnapshot;
  active: boolean;
  onOpen: (title: string, rel: string) => void;
  onDoc: (title: string, text: string) => void;
  onTab: (tab: "approvals" | "reports" | "office" | "board") => void;
  syncing: boolean;
  onSync: () => void;
};

export function HubView({ snap, active, onOpen, onDoc, onTab, syncing, onSync }: Props) {
  const [robots, setRobots] = useState<RobotView[]>([]);
  const [reports, setReports] = useState<ReportItem[]>([]);
  const [gh, setGh] = useState<GhInfo | null>(null);
  const [status, setStatus] = useState<SyncStatus | null>(null);
  const openAtLogin = useStore((s) => s.settings?.openAtLogin !== false);

  const load = useCallback(async (forceGh = false) => {
    const [r, rep, st] = await Promise.all([api.hub.robots().catch(() => []), api.hub.reports().catch(() => []), api.hub.status().catch(() => null)]);
    setRobots(r);
    setReports(rep);
    if (st) setStatus(st);
    setGh(await api.hub.github(forceGh).catch((e) => ({ ok: false, error: errText(e), issues: [], release: null, ci: [] })));
  }, []);

  useEffect(() => {
    void load();
  }, [load, snap]);
  useEffect(() => api.hub.onSynced((s) => setStatus(s)), []);
  // ekran acikken saatler ve "x dk once" yazilari tazelensin
  useEffect(() => {
    if (!active) return;
    const busy = robots.some((r) => r.live?.state === "running");
    const t = window.setInterval(() => void load(), busy ? 15_000 : 60_000);
    return () => window.clearInterval(t);
  }, [active, load, robots]);

  const run = (p: Promise<unknown>) => void p.catch((e) => toast(errText(e), "error"));
  // ajan sayisi: Claude rolleri + calisan Antigravity otomasyonlari (rol eslemesi cift sayilmasin)
  const agyRunning = robots.filter((r) => r.live?.state === "running");
  const working = [...snap.roles.filter((r) => r.live?.state === "working" && r.live.source !== "antigravity"), ...agyRunning];
  const pending = snap.approvals.pending;
  const ciLast = gh?.ci[0];
  const ciBad = !!ciLast && ciLast.status === "completed" && ciLast.conclusion !== "success";
  const pendingReports = reports.filter((r) => r.pending).length;

  return (
    <div className="hub">
      {/* --- ust ozet: tek bakista durum */}
      <section className="hub-strip">
        <div className={`hub-pill ${status && !status.agents.ok ? "warn" : "ok"}`} title={status ? `Ajanlar: ${status.agents.text}${status.app ? `\nUygulama: ${status.app.text}` : ""}` : ""}>
          {status && !status.agents.ok ? <CloudOff size={15} /> : <Cloud size={15} />}
          <span>{!status ? "Eşitleme bekleniyor" : status.agents.ok ? `Eşitlendi ${when(status.at)}` : `Eşitlenemedi (${when(status.at)}) · yeniden denenecek`}</span>
          <button className="btn small" onClick={onSync} disabled={syncing}>{syncing ? <Loader2 size={13} className="spin" /> : <RefreshCw size={13} />} Şimdi</button>
        </div>
        <button className={`hub-pill ${working.length ? "live" : "ok"}`} onClick={() => onTab("office")}>
          <Bot size={15} /> {working.length ? `${working.length} ajan çalışıyor` : "Sistem aktif · ajanlar hazır"}
        </button>
        <button className={`hub-pill ${pending.length ? "warn" : "ok"}`} onClick={() => onTab("approvals")}>
          <ShieldCheck size={15} /> {pending.length ? `${pending.length} onay bekliyor` : "Bekleyen onay yok"}
        </button>
        <button className={`hub-pill ${ciBad ? "bad" : "ok"}`} onClick={() => ciLast && run(api.hub.openUrl(ciLast.url))} title={ciLast ? ciLast.title : ""}>
          <GitBranch size={15} /> {ciLast ? (ciBad ? (gh?.ciNote ? "CI durdu (GitHub dakikası)" : "CI kırmızı") : ciLast.status !== "completed" ? "CI çalışıyor" : "CI yeşil") : "CI —"}
          {gh?.release && <span className="muted"> · {gh.release.tag}</span>}
        </button>
      </section>

      <div className="hub-grid">
        {/* --- robotlar */}
        <section className="hub-card hub-robots">
          <h3><Bot size={16} /> Robotlar <span className="muted">hepsi aktif</span></h3>
          <table>
            <thead>
              <tr><th>Robot</th><th>Nerede</th><th>Sıradaki</th><th>Son çalışma</th></tr>
            </thead>
            <tbody>
              {robots.map((r) => (
                <tr key={r.id} className={r.live?.state === "running" ? "hub-running" : undefined} title={`${r.what}\nModel: ${r.model}${r.live?.model ? `\nSon çalışmada kullanılan model: ${r.live.model}` : ""}`}>
                  <td>
                    <i className={`hub-dot ${r.live?.state === "running" ? "live" : r.live?.state === "failed" ? "bad" : "on"}`} /> <b>{r.ad}</b>
                    {r.live?.state === "running" && <span className="hub-tag live">Şu an çalışıyor · {r.live.note}</span>}
                    {r.live?.state === "failed" && <span className="hub-tag bad" title={`Başladı: ${when(r.live.started)}`}>Son çalışma: {r.live.note}</span>}
                    <div className="muted small">{r.what}</div>
                  </td>
                  <td>{r.where === "cloud" ? <span className="hub-tag cloud"><Cloud size={12} /> Bulut</span> : <span className="hub-tag pc"><Laptop size={12} /> Bu PC</span>}</td>
                  <td>{when(r.next)}</td>
                  <td className="muted">{when(r.last)}</td>
                </tr>
              ))}
              <tr title="Atölye açıkken 3 dakikada bir">
                <td><i className="hub-dot on" /> <b>Atölye otomatik eşitleme</b><div className="muted small">Antigravity sonuçlarını buluta gönderir, buluttakini bu PC'ye indirir</div></td>
                <td><span className="hub-tag pc"><Laptop size={12} /> Bu PC</span></td>
                <td>3 dk'da bir</td>
                <td className="muted">{when(status?.at ?? null)}</td>
              </tr>
            </tbody>
          </table>
          <div className="hub-sync">
            <div><b>Ajan klasörü:</b> {status?.agents.text ?? "—"}</div>
            <div><b>Uygulama (version6):</b> {status?.app?.text ?? "—"}</div>
            <label className="hub-check">
              <input type="checkbox" checked={openAtLogin} onChange={(e) => void updateSettings({ openAtLogin: e.target.checked })} />
              Bilgisayar açılınca Atölye arka planda başlasın (eşitleme hep çalışsın)
            </label>
          </div>
        </section>

        {/* --- tek tikla araclar */}
        <section className="hub-card hub-launch">
          <h3><SquareTerminal size={16} /> Çalış</h3>
          <p className="muted small">Uygulama projesinde (version6) açılır; terminal Atölye'nin altında.</p>
          <div className="hub-buttons">
            <button className="btn" onClick={() => requestTerminal("claude", "app")}><Bot size={14} /> Claude Code</button>
            <button className="btn" onClick={() => requestTerminal("codex", "app")}><SquareTerminal size={14} /> Codex</button>
            <button className="btn" onClick={() => requestTerminal("agy", "app")}><SquareTerminal size={14} /> Antigravity (terminal)</button>
            <button className="btn" onClick={() => run(api.hub.openApp("antigravity"))}><ExternalLink size={14} /> Antigravity uygulaması</button>
            <button className="btn" onClick={() => requestTerminal("claude", "agents")}><Bot size={14} /> Claude Code · ajan klasörü</button>
            <button className="btn" onClick={() => requestTerminal("powershell", "app")}><SquareTerminal size={14} /> PowerShell</button>
          </div>
          <h4><Gauge size={14} /> Limitler</h4>
          <div className="hub-buttons">
            <button className="btn" onClick={() => run(api.hub.openApp("claudeUsage"))}><ExternalLink size={14} /> Claude kullanımı</button>
            <button className="btn" onClick={() => run(api.hub.openApp("claudeRoutines"))}><ExternalLink size={14} /> Claude bulut robotları</button>
            <button className="btn" onClick={() => run(api.hub.openApp("antigravity"))} title="Antigravity'de model menüsü → View Usage"><ExternalLink size={14} /> Antigravity kullanımı</button>
          </div>
          <p className="muted small">Antigravity'de Gemini ile Claude/GPT'nin limiti ayrıdır (model menüsü → View Usage). Ücretli kredi kapalı kalmalı: Ayarlar → Models → AI Credit Overages: Never.</p>
        </section>

        {/* --- raporlar */}
        <section className="hub-card hub-reports">
          <h3>
            <FileText size={16} /> Son raporlar
            {pendingReports > 0 && <span className="hub-tag pc">{pendingReports} buluta gönderiliyor</span>}
            <button className="btn small hub-more" onClick={() => onTab("reports")}>Tümü</button>
          </h3>
          <ul className="hub-list">
            {reports.slice(0, 8).map((r) => (
              <li key={r.rel}>
                <button onClick={() => onOpen(`${r.kind} · ${r.title}`, r.rel)}>
                  {r.origin === "cloud" ? <span className="hub-tag cloud"><Cloud size={11} /> Bulut</span> : <span className="hub-tag pc"><Laptop size={11} /> Bu PC</span>}
                  <span className="hub-kind">{r.kind}</span>
                  <span className="hub-name">{r.title}</span>
                  <span className="muted small">{when(r.date)}</span>
                </button>
              </li>
            ))}
            {!reports.length && <li className="muted">Henüz rapor yok.</li>}
          </ul>
        </section>

        {/* --- github */}
        <section className="hub-card hub-gh">
          <h3>
            <GitBranch size={16} /> GitHub
            <button className="btn small hub-more" onClick={() => void load(true)} title="Yenile"><RefreshCw size={13} /></button>
          </h3>
          {!gh && <p className="muted"><Loader2 size={13} className="spin" /> GitHub okunuyor…</p>}
          {gh && !gh.ok && <div className="ag-error"><TriangleAlert size={14} /> {gh.error}</div>}
          {gh?.issues.length ? (
            <ul className="hub-list">
              {gh.issues.map((i) => (
                <li key={`${i.repo}${i.number}`}>
                  <button onClick={() => run(api.hub.issue(i.repo, i.number).then((t) => onDoc(`${i.repo === "app" ? "Uygulama" : "Ajanlar"} #${i.number}`, t)))}>
                    <span className="hub-tag cloud">#{i.number}</span>
                    <span className="hub-name">{i.title}</span>
                    <span className="muted small">{when(i.updatedAt)}</span>
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            gh?.ok && <p className="muted">Açık issue yok.</p>
          )}
          {gh?.ciNote && <div className="ag-error"><TriangleAlert size={14} /> {gh.ciNote}</div>}
          {gh?.ci.length ? (
            <>
              <h4>Son CI çalışmaları</h4>
              <ul className="hub-list">
                {gh.ci.slice(0, 3).map((c) => (
                  <li key={c.url}>
                    <button onClick={() => run(api.hub.openUrl(c.url))}>
                      <i className={`hub-dot ${c.status !== "completed" ? "live" : c.conclusion === "success" ? "on" : "bad"}`} />
                      <span className="hub-name">{c.title}</span>
                      <span className="muted small">{when(c.date)}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </>
          ) : null}
          {gh?.release && (
            <p className="small">
              Son sürüm <button className="link" onClick={() => run(api.hub.openUrl(gh.release!.url))}>{gh.release.tag}</button> · {when(gh.release.date)}
            </p>
          )}
        </section>
      </div>

      {pending.length > 0 && (
        <section className="hub-card hub-approvals">
          <h3><ShieldCheck size={16} /> Onayını bekleyenler</h3>
          <ul className="hub-list">
            {pending.map((a) => (
              <li key={a.name}>
                <button onClick={() => onTab("approvals")}>
                  <span className="hub-tag warn">onay</span>
                  <span className="hub-name">{a.body.match(/^#\s+(.+)$/m)?.[1] ?? a.name}</span>
                  <Play size={12} />
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
