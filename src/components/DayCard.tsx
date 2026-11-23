/**
 * Merkez → "Gün özeti": secilen gunde ne yapildigi, tek yerde. Gercek kayitlardan toplanir
 * (yoneticinin gunluk satirlari, uygulamaya giren degisiklikler, ajanlarin isleri, Antigravity
 * sonuclari, onaylar, sosyal medya); bir ajan rapor yazmayi unutsa bile gun bos gorunmez.
 */
import { useCallback, useEffect, useState } from "react";
import { CalendarDays, ChevronLeft, ChevronRight, Loader2 } from "lucide-react";
import { api, type DayItem, type DaySummary } from "../api";

const p2 = (n: number) => String(n).padStart(2, "0");
const dayOf = (d: Date) => `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`;
const shift = (day: string, n: number) => {
  const d = new Date(`${day}T12:00:00`);
  d.setDate(d.getDate() + n);
  return dayOf(d);
};
const hm = (iso: string) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleTimeString("tr-TR", { hour: "2-digit", minute: "2-digit" });
};
function label(day: string): string {
  const today = dayOf(new Date());
  if (day === today) return "Bugün";
  if (day === shift(today, -1)) return "Dün";
  return new Date(`${day}T12:00:00`).toLocaleDateString("tr-TR", { weekday: "long", day: "numeric", month: "long" });
}

type Section = { key: keyof Pick<DaySummary, "manager" | "app" | "agents" | "results" | "approvals" | "social">; title: string; hint: string };
const SECTIONS: Section[] = [
  { key: "manager", title: "Yöneticinin özeti", hint: "Her yönetici çalışmasının Türkçe satırı" },
  { key: "app", title: "Uygulamada yapılanlar", hint: "Uygulamaya giren değişiklikler ve sürümler" },
  { key: "agents", title: "Ajanların işleri", hint: "O gün çalışan her ajanın son işi" },
  { key: "results", title: "Raporlar ve araştırmalar", hint: "Antigravity ve Claude'un yazdığı sonuçlar" },
  { key: "approvals", title: "Onaylar", hint: "O gün açılan ya da karar verilen onaylar" },
  { key: "social", title: "Sosyal medya", hint: "Paylaşım kayıtları (GitHub)" },
];

export function DayCard({ active, onOpen }: { active: boolean; onOpen: (title: string, rel: string) => void }) {
  const [day, setDay] = useState(() => dayOf(new Date()));
  const [data, setData] = useState<DaySummary | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async (d: string) => {
    setBusy(true);
    try {
      setData(await api.hub.day(d));
    } catch {
      setData(null);
    } finally {
      setBusy(false);
    }
  }, []);
  useEffect(() => {
    void load(day);
  }, [day, load]);
  useEffect(() => api.hub.onSynced(() => void load(day)), [day, load]);
  useEffect(() => {
    if (!active) return;
    const t = window.setInterval(() => void load(day), 60_000);
    return () => window.clearInterval(t);
  }, [active, day, load]);

  const today = dayOf(new Date());
  const total = data ? SECTIONS.reduce((n, s) => n + data[s.key].length, 0) : 0;
  // yoneticinin Turkce satirlari tam; ajanlarin (Ingilizce, uzun) notlari 2 satir, tamami ustune gelince
  const item = (clamp: boolean) => (it: DayItem, i: number) => (
    <li key={i}>
      <span className="hub-day-time">{it.at.length > 10 && !it.at.endsWith("T00:00:00") ? hm(it.at) : ""}</span>
      {it.tag && <span className="hub-tag">{it.tag}</span>}
      {it.rel ? (
        <button className={`link hub-day-text${clamp ? " clamp" : ""}`} title={it.text} onClick={() => onOpen(it.text.slice(0, 60), it.rel!)}>{it.text}</button>
      ) : (
        <span className={`hub-day-text${clamp ? " clamp" : ""}`} title={it.text}>{it.text}</span>
      )}
    </li>
  );

  return (
    <section className="hub-card hub-day">
      <div className="hub-day-head">
        <h3><CalendarDays size={16} /> Gün özeti <span className="muted">{label(day)}{data && !data.empty ? ` · ${total} kayıt` : ""}</span></h3>
        <div className="hub-day-nav">
          {busy && <Loader2 size={14} className="spin" />}
          <button className="btn small" title="Önceki gün" onClick={() => setDay((d) => shift(d, -1))}><ChevronLeft size={14} /></button>
          <button className="btn small" disabled={day === today} onClick={() => setDay(today)}>Bugün</button>
          <button className="btn small" title="Sonraki gün" disabled={day >= today} onClick={() => setDay((d) => shift(d, 1))}><ChevronRight size={14} /></button>
        </div>
      </div>
      {!data ? (
        <div className="muted small">{busy ? "Okunuyor…" : "Okunamadı."}</div>
      ) : data.empty ? (
        <div className="muted small">{day === today ? "Bugün henüz bir iş kaydı yok. Yönetici 17:00 ve 20:00'de, Antigravity işleri hafta içi akşam çalışır." : "Bu gün hiçbir ajan iş yapmamış."}</div>
      ) : (
        <div className="hub-day-grid">
          {SECTIONS.filter((s) => data[s.key].length).map((s) => (
            <div key={s.key} className="hub-day-sec" title={s.hint}>
              <h4>{s.title} <span className="muted">{data[s.key].length}</span></h4>
              <ul className="hub-day-list">{data[s.key].map(item(s.key === "agents"))}</ul>
            </div>
          ))}
        </div>
      )}
      {data?.socialError && !data.empty && <div className="muted small">{data.socialError}</div>}
    </section>
  );
}
