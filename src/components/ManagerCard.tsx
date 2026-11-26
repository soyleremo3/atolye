/**
 * Merkez → Yonetici karti. Asil tus (Ctrl+Alt+G): yonetici BU PC'de calisir (claude -p, Opus, Claude Pro
 * kotasi); panoya, raporlara ve yapilacaklara bakar, en fazla 5 isi ajanlara dagitir. Claude ajanlari
 * (auto-worker-opus / auto-worker / auto-scout) ayni calismada bu PC'de sirayla calisir; Google
 * arastirmalari Antigravity'ye bilet olur (Antigravity bu PC'de kendi otomasyonuyla calisir; Atolye
 * agy'yi cagirmaz: Google tuketici planlarinda agy'yi baska uygulamanin icinden calistirmayi desteklemiyor).
 * Ikinci secenek: ayni yoneticiyi bulutta baslatmak (rutin anahtari gerekir).
 */
import { useCallback, useEffect, useState } from "react";
import { Cloud, ExternalLink, KeyRound, Laptop, ListChecks, Loader2, Play, ShieldCheck, Square, Trash2, UserCog } from "lucide-react";
import { api, type AgentRun, type ManagerStatus } from "../api";
import { takeManagerRun, useManagerRun } from "../lib/managerRunState";
import { toast } from "../store";

const errText = (e: unknown) => String((e as Error)?.message || e).replace(/^Error invoking remote method '[^']+': (Error: )?/, "");
const hm = (t: string | number | null | undefined) => (t ? new Date(t).toLocaleTimeString("tr-TR", { hour: "2-digit", minute: "2-digit" }) : "—");

type Mode = "local" | "cloud";

export function ManagerCard({ active, onAfterRun, onWatch }: { active: boolean; onAfterRun: () => void; onWatch: () => void }) {
  const [st, setSt] = useState<ManagerStatus | null>(null);
  const [local, setLocal] = useState<AgentRun | null>(null);
  const [confirm, setConfirm] = useState<Mode | null>(null);
  const [busy, setBusy] = useState(false);
  const [setup, setSetup] = useState(false);
  const [token, setToken] = useState("");
  const request = useManagerRun((s) => s.pending);

  const load = useCallback(async () => {
    const [s, runs] = await Promise.all([api.manager.status().catch(() => null), api.agents.runs().catch(() => [] as AgentRun[])]);
    setSt(s);
    setLocal(runs.find((r) => r.role === "manager") ?? null);
    return s;
  }, []);
  useEffect(() => {
    void load();
  }, [load]);
  useEffect(() => api.hub.onSynced(() => void load()), [load]);
  // yerel calisma: her olayda tazele (adim sayisi, bitis)
  useEffect(() => api.agents.onEvent(() => void load()), [load]);
  useEffect(() => {
    if (!active) return;
    const t = window.setInterval(() => void load(), 30_000);
    return () => window.clearInterval(t);
  }, [active, load]);
  // Ctrl+Alt+G: yerel onay kutusu
  useEffect(() => {
    if (request && takeManagerRun()) void load().then(() => setConfirm("local"));
  }, [request, load]);

  const localRunning = !!local && !local.ended;
  const cloudRunning = st?.phase === "running" || st?.phase === "starting";
  const anyRunning = localRunning || cloudRunning;
  const needsToken = !!st && !st.hasToken;

  const start = async (mode: Mode) => {
    setBusy(true);
    try {
      if (mode === "local") {
        await api.manager.runLocal();
        toast("Yönetici bu bilgisayarda başladı; işleri ajanlara dağıtıyor.");
      } else {
        const r = await api.manager.run();
        toast("Yönetici bulutta başladı; işleri dağıtıyor.");
        if (r.url) void api.hub.openUrl(r.url).catch(() => undefined);
      }
      setConfirm(null);
      await load();
      onAfterRun();
    } catch (e) {
      toast(errText(e), "error");
    } finally {
      setBusy(false);
    }
  };

  const save = async () => {
    try {
      await api.manager.saveToken(token);
      setToken("");
      setSetup(false);
      toast("Anahtar şifreli olarak kaydedildi.");
      await load();
    } catch (e) {
      toast(errText(e), "error");
    }
  };

  const steps = local ? local.events.filter((e) => e.kind === "tool").length : 0;
  const lastTool = local ? [...local.events].reverse().find((e) => e.kind === "tool")?.text : undefined;
  const localNewer = !!local?.ended && (!st?.managerLastRun || local.ended >= (Date.parse(st.managerLastRun) || 0));
  let line: React.ReactNode = "Panoya, raporlara ve yapılacaklara bakar; en önemli 5 işi seçip ajanlara dağıtır.";
  if (localRunning) line = <>Bu PC'de çalışıyor · başladı {hm(local!.started)} · {steps} adım{lastTool ? ` · son: ${lastTool}` : ""}</>;
  else if (cloudRunning) line = <>Bulutta çalışıyor · başlatıldı {hm(st?.last?.at ?? st?.managerLastRun)}{st?.managerState === "working" && st.managerDid ? ` · ${st.managerDid}` : ""}</>;
  else if (local?.ended && localNewer) line = <>Son yerel çalışma {local.ok ? "bitti" : "hata verdi"} {hm(local.ended)}{local.summary ? ` · ${local.summary.split("\n")[0].slice(0, 140)}` : ""}</>;
  else if (st?.phase === "done") line = <>Son bulut çalışması bitti {hm(st.managerLastRun)}{st.managerDid ? ` · ${st.managerDid}` : ""}</>;
  else if (local?.ended) line = <>Son yerel çalışma {local.ok ? "bitti" : "hata verdi"} {hm(local.ended)}{local.summary ? ` · ${local.summary.split("\n")[0].slice(0, 140)}` : ""}</>;

  return (
    <section className={`hub-card hub-manager${anyRunning ? " is-running" : ""}`}>
      <div className="hub-manager-row">
        <div className="hub-manager-text">
          <h3><UserCog size={16} /> Yönetici <span className="muted">en fazla 5 iş</span></h3>
          <div className="muted small hub-manager-line">{st ? line : "Durum okunuyor…"}</div>
        </div>
        <div className="hub-manager-actions">
          {localRunning && (
            <>
              <button className="btn small" onClick={onWatch}><ListChecks size={13} /> Canlı izle</button>
              <button className="btn small" onClick={() => void api.agents.stop().then(load)}><Square size={12} /> Durdur</button>
            </>
          )}
          {!localRunning && local?.ended && <button className="btn small" onClick={onWatch}><ListChecks size={13} /> Ne yaptı?</button>}
          {cloudRunning && st?.last?.url && <button className="btn small" onClick={() => void api.hub.openUrl(st.last!.url).catch((e) => toast(errText(e), "error"))}><ExternalLink size={13} /> Oturumu aç</button>}
          <button className="btn small" disabled={!st || anyRunning || busy} onClick={() => void load().then((s) => (s && !s.hasToken ? setSetup(true) : setConfirm("cloud")))} title="Aynı yönetici bulutta (bilgisayar kapansa da sürer)">
            <Cloud size={13} /> Bulutta çalıştır
          </button>
          <button className="btn primary hub-manager-go" disabled={!st || anyRunning || busy} onClick={() => setConfirm("local")} title="Ctrl+Alt+G">
            {anyRunning ? <Loader2 size={15} className="spin" /> : <Laptop size={15} />} {anyRunning ? "Yönetici çalışıyor" : "Yöneticiyi çalıştır"} <kbd>Ctrl+Alt+G</kbd>
          </button>
        </div>
      </div>

      {confirm && st && (
        <div className="hub-manager-confirm" role="dialog" aria-label="Yöneticiyi çalıştır">
          {anyRunning ? (
            <p>Yönetici şu an {localRunning ? "bu bilgisayarda" : "bulutta"} çalışıyor. Bitince yeniden başlatabilirsin (aynı anda iki yönetici çalışmaz).</p>
          ) : confirm === "cloud" && needsToken ? (
            <p>Bulutta çalıştırmak için önce anahtarı kur (aşağıda). Bilgisayarda çalıştırmak için anahtar gerekmez.</p>
          ) : (
            <>
              <p><b>Yönetici şimdi {confirm === "local" ? "bu bilgisayarda" : "bulutta"} başlasın mı?</b></p>
              <ul>
                <li>Panoya, son raporlara, eleştirmen notlarına ve yapılacaklar listesine bakar; en önemli <b>5 işe kadar</b> seçer.</li>
                <li>{confirm === "local" ? "Claude ajanları bu bilgisayarda sırayla çalışır (Opus yönetir; işçiler Opus, Sonnet, Haiku)." : "Claude ajanları bulutta sırayla çalışır."} Google araştırmaları Antigravity'ye iş olarak gider; Antigravity onları bu bilgisayarda kendi saatinde (hafta içi 19:00) yapar.</li>
                <li>Önemli işler (build, e-posta, para, silme) için yine senin onayını ister.</li>
                <li>{confirm === "local" ? "Atölye açık ve bilgisayar açık kalmalı (bitene kadar, genelde 30–90 dk). Senin kaydetmediğin dosyalara dokunmaz." : "Bilgisayarı kapatsan da sürer."} Ücret yok: Claude Pro kullanım hakkından düşer.</li>
              </ul>
            </>
          )}
          <div className="hub-manager-buttons">
            {!anyRunning && !(confirm === "cloud" && needsToken) && (
              <button className="btn primary" autoFocus disabled={busy} onClick={() => void start(confirm)}>{busy ? <Loader2 size={14} className="spin" /> : <Play size={14} />} Başlat</button>
            )}
            <button className="btn" onClick={() => setConfirm(null)}>Vazgeç</button>
          </div>
        </div>
      )}

      {setup && (
        <div className="hub-manager-setup">
          <p><b>Bulut için anahtarı bir kez kur (2 dk; bilgisayarda çalıştırmak için gerekmez):</b></p>
          <ol>
            <li><button className="link" onClick={() => void api.hub.openApp("claudeRoutines")}>claude.ai → Rutinler</button>'i aç, <b>basketball-v6: manager</b> rutinine tıkla.</li>
            <li><b>Edit</b> → <b>Trigger</b> satırındaki <b>+</b> → <b>API</b> → <b>Generate token</b>.</li>
            <li>Çıkan anahtarı kopyala (bir kez gösterilir) ve aşağıya yapıştır.</li>
          </ol>
          <div className="hub-manager-token">
            <input type="password" autoComplete="off" spellCheck={false} placeholder="sk-ant-oat01-…" value={token} onChange={(e) => setToken(e.target.value)} />
            <button className="btn primary" disabled={!token.trim()} onClick={() => void save()}><ShieldCheck size={14} /> Kaydet</button>
            <button className="btn" onClick={() => { setSetup(false); setToken(""); }}>Vazgeç</button>
          </div>
          <p className="muted small">Anahtar yalnız bu bilgisayarda, Windows'un şifreli deposunda durur; GitHub'a ya da dosyalara yazılmaz. Sadece bu rutini başlatabilir.</p>
        </div>
      )}
      <div className="hub-manager-foot muted small">
        Bulut anahtarı: {st?.hasToken ? <>kayıtlı · <button className="link" onClick={() => setSetup(true)}>değiştir</button> · <button className="link" onClick={() => void api.manager.clearToken().then(load)}><Trash2 size={11} /> sil</button></> : <>yok · <button className="link" onClick={() => setSetup(true)}><KeyRound size={11} /> kur</button> (yalnız bulut için)</>}
      </div>
    </section>
  );
}
