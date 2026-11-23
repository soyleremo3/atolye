/**
 * Merkez → Yonetici karti: tek tusla buluttaki Claude yoneticiyi baslatir (en fazla 5 is).
 * Yonetici panoya, raporlara ve yapilacaklara bakar, isleri ajanlara dagitir: Claude isleri ayni
 * calismada sirayla biter, Google arastirmalari Antigravity'ye bilet olarak gider.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { ExternalLink, KeyRound, Loader2, Play, ShieldCheck, Trash2, UserCog } from "lucide-react";
import { api, type ManagerStatus } from "../api";
import { takeManagerRun, useManagerRun } from "../lib/managerRunState";
import { toast } from "../store";

const errText = (e: unknown) => String((e as Error)?.message || e).replace(/^Error invoking remote method '[^']+': (Error: )?/, "");
const hm = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleTimeString("tr-TR", { hour: "2-digit", minute: "2-digit" }) : "—");

export function ManagerCard({ active, onAfterRun }: { active: boolean; onAfterRun: () => void }) {
  const [st, setSt] = useState<ManagerStatus | null>(null);
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [setup, setSetup] = useState(false);
  const [token, setToken] = useState("");
  const request = useManagerRun((s) => s.pending);
  const startRef = useRef<HTMLButtonElement>(null);

  const load = useCallback(async () => {
    setSt(await api.manager.status().catch(() => null));
  }, []);
  useEffect(() => {
    void load();
  }, [load]);
  useEffect(() => api.hub.onSynced(() => void load()), [load]);
  useEffect(() => {
    if (!active) return;
    const t = window.setInterval(() => void load(), 30_000);
    return () => window.clearInterval(t);
  }, [active, load]);
  // Ctrl+Alt+G: onay kutusunu ac
  useEffect(() => {
    if (request && takeManagerRun()) void load().then(() => setConfirm(true));
  }, [request, load]);
  useEffect(() => {
    if (confirm) startRef.current?.focus();
  }, [confirm]);

  const start = async () => {
    setBusy(true);
    try {
      const r = await api.manager.run();
      toast("Yönetici bulutta başladı; işleri dağıtıyor.");
      setConfirm(false);
      await load();
      onAfterRun();
      if (r.url) void api.hub.openUrl(r.url).catch(() => undefined);
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

  const running = st?.phase === "running" || st?.phase === "starting";
  const needsToken = !!st && !st.hasToken;

  return (
    <section className={`hub-card hub-manager${running ? " is-running" : ""}`}>
      <div className="hub-manager-row">
        <div className="hub-manager-text">
          <h3><UserCog size={16} /> Yönetici <span className="muted">bulutta · en fazla 5 iş</span></h3>
          <div className="muted small">
            {!st ? "Durum okunuyor…" : running
              ? <>Çalışıyor · başlatıldı {hm(st.last?.at)}{st.managerState === "working" && st.managerDid ? ` · ${st.managerDid}` : ""}</>
              : st.phase === "done"
                ? <>Son çalışma bitti {hm(st.managerLastRun)}{st.managerDid ? ` · ${st.managerDid}` : ""}</>
                : "Panoya, raporlara ve yapılacaklara bakar; en önemli 5 işi seçip ajanlara dağıtır."}
          </div>
        </div>
        <div className="hub-manager-actions">
          {st?.last?.url && <button className="btn small" onClick={() => void api.hub.openUrl(st.last!.url).catch((e) => toast(errText(e), "error"))}><ExternalLink size={13} /> Oturumu aç</button>}
          {needsToken
            ? <button className="btn primary" onClick={() => setSetup(true)}><KeyRound size={15} /> Tuşu kur</button>
            : <button className="btn primary hub-manager-go" disabled={!st || running || busy} onClick={() => setConfirm(true)} title="Ctrl+Alt+G">
                {running ? <Loader2 size={15} className="spin" /> : <Play size={15} />} {running ? "Yönetici çalışıyor" : "Yöneticiyi çalıştır"} <kbd>Ctrl+Alt+G</kbd>
              </button>}
        </div>
      </div>

      {confirm && st && (
        <div className="hub-manager-confirm" role="dialog" aria-label="Yöneticiyi çalıştır">
          {needsToken ? (
            <p>Önce tuşu kur: claude.ai'de yönetici için bir anahtar oluşturup buraya kaydet.</p>
          ) : running ? (
            <p>Yönetici şu an çalışıyor. Bitince yeniden basabilirsin (aynı anda iki yönetici çalışmaz).</p>
          ) : (
            <>
              <p><b>Yönetici şimdi bulutta başlasın mı?</b></p>
              <ul>
                <li>Panoya, son raporlara, eleştirmen notlarına ve yapılacaklar listesine bakar.</li>
                <li>En önemli <b>5 işe kadar</b> seçer ve ajanlara dağıtır: Claude işlerini bu çalışmada sırayla bitirir, Google araştırmalarını Antigravity'ye bırakır (hafta içi 19:00).</li>
                <li>Önemli işler (build, e-posta, para, silme) için yine senin onayını ister.</li>
                <li>Ücret yok: Claude Pro kullanım hakkından düşer. Bilgisayarı kapatsan da devam eder.</li>
              </ul>
            </>
          )}
          <div className="hub-manager-buttons">
            {!needsToken && !running && <button ref={startRef} className="btn primary" disabled={busy} onClick={() => void start()}>{busy ? <Loader2 size={14} className="spin" /> : <Play size={14} />} Başlat</button>}
            {needsToken && <button className="btn primary" onClick={() => { setConfirm(false); setSetup(true); }}><KeyRound size={14} /> Tuşu kur</button>}
            <button className="btn" onClick={() => setConfirm(false)}>Vazgeç</button>
          </div>
        </div>
      )}

      {setup && (
        <div className="hub-manager-setup">
          <p><b>Tuşu bir kez kur (2 dk):</b></p>
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
      {st?.hasToken && !setup && (
        <div className="hub-manager-foot muted small">
          Anahtar kayıtlı · <button className="link" onClick={() => setSetup(true)}>değiştir</button> · <button className="link" onClick={() => void api.manager.clearToken().then(load)}><Trash2 size={11} /> sil</button>
        </div>
      )}
    </section>
  );
}
