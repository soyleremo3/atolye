/**
 * Gun ozeti: secilen gunde ne yapildi, gercek kayitlardan (ajanlarin rapor yazmasina bagli degil).
 * Kaynaklar (yalniz okunur):
 *  - raporlar/gunluk/<gun>.md      yoneticinin her calismada yazdigi Turkce satirlar
 *  - uygulama reposu git gecmisi   o gun uygulamaya giren degisiklikler (surumler dahil)
 *  - roller/<id>/durum.json        o gun calisan ajanlar ve yaptiklari
 *  - board/results, raporlar/*     o gun yazilan sonuclar (Antigravity + Claude)
 *  - approvals/                    o gun acilan / karar verilen onaylar
 *  - Basketball-APP-Posts (gh)     o gunun sosyal medya kayitlari (internet varsa)
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import { frontMatter, listMd, readJson, readText, requireRepo, run, type AgentsConfig } from "./agents";

export type DayItem = { text: string; at: string; rel?: string; tag?: string };
export type DaySummary = {
  day: string;
  manager: DayItem[];
  app: DayItem[];
  agents: DayItem[];
  results: DayItem[];
  approvals: DayItem[];
  social: DayItem[];
  socialError?: string;
  empty: boolean;
};

const DAY = /^\d{4}-\d{2}-\d{2}$/;
/** Bu PC'nin saatine gore "YYYY-AA-GG". */
export function localDay(d = new Date()): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
const sameDay = (iso: string | null | undefined, day: string) => !!iso && !Number.isNaN(new Date(iso).getTime()) && localDay(new Date(iso)) === day;
function nextDay(day: string): string {
  const d = new Date(`${day}T12:00:00`);
  d.setDate(d.getDate() + 1);
  return localDay(d);
}

/** Commit ozetinin turu: sahibin anlayacagi kisa etiket. */
function commitTag(subject: string): string {
  if (/^release:/i.test(subject)) return "Sürüm";
  if (/^feat/i.test(subject)) return "Yeni";
  if (/^fix/i.test(subject)) return "Düzeltme";
  if (/^(test)/i.test(subject)) return "Test";
  if (/^(docs|chore)/i.test(subject)) return "Belge";
  if (/^(perf|refactor)/i.test(subject)) return "İyileştirme";
  return "Değişiklik";
}

async function gitDay(repo: string, day: string, paths: string[] = []): Promise<{ at: string; subject: string }[]> {
  const r = await run("git", ["log", `--after=${day}T00:00:00`, `--before=${nextDay(day)}T00:00:00`, "--format=%cI%x1f%s", ...(paths.length ? ["--", ...paths] : [])], repo, 20_000);
  if (r.code !== 0) return [];
  return r.out.split("\n").filter(Boolean).map((l) => {
    const [at, subject] = l.split("\x1f");
    return { at, subject: subject ?? "" };
  });
}

let socialCache: { day: string; at: number; items: DayItem[]; error?: string } | null = null;
async function socialDay(cwd: string, day: string): Promise<{ items: DayItem[]; error?: string }> {
  if (socialCache && socialCache.day === day && Date.now() - socialCache.at < 5 * 60_000) return socialCache;
  const since = new Date(`${day}T00:00:00`).toISOString();
  const until = new Date(`${nextDay(day)}T00:00:00`).toISOString();
  const r = await run("gh", ["api", `repos/soyleremo3/Basketball-APP-Posts/commits?since=${since}&until=${until}&per_page=30`, "--jq", ".[] | [.commit.committer.date, (.commit.message | split(\"\\n\")[0])] | @tsv"], cwd, 30_000);
  const out = r.code === 0
    ? { items: r.out.split("\n").filter(Boolean).map((l) => { const [at, text] = l.split("\t"); return { at, text, tag: "Sosyal" }; }) }
    : { items: [], error: "Sosyal medya kaydı okunamadı (internet ya da gh?)" };
  socialCache = { day, at: Date.now(), ...out };
  return out;
}

export async function daySummary(cfg: AgentsConfig, dayIn?: string): Promise<DaySummary> {
  const root = requireRepo(cfg);
  const day = dayIn && DAY.test(dayIn) ? dayIn : localDay();

  // 1) yoneticinin satirlari: "- 17:15 — ..." bicimi
  const manager: DayItem[] = [];
  const md = await readText(path.join(root, "raporlar", "gunluk", `${day}.md`)).catch(() => "");
  for (const line of md.split(/\r?\n/)) {
    const m = /^\s*-\s+(.*)$/.exec(line);
    if (!m) continue;
    const hm = /^(\d{1,2}:\d{2})/.exec(m[1])?.[1] ?? "";
    // saat zaten ayri sutunda: metnin basindaki "17:15 — " tekrari atilir
    const text = hm ? m[1].replace(/^\d{1,2}:\d{2}\s*/, "").replace(/^[—–-]\s*/, "").trim() : m[1].trim();
    manager.push({ text, at: hm ? `${day}T${hm.padStart(5, "0")}:00` : `${day}T00:00:00`, rel: `raporlar/gunluk/${day}.md` });
  }

  // 2) uygulamaya giren degisiklikler
  const app: DayItem[] = [];
  if (cfg.appPath) for (const c of await gitDay(cfg.appPath, day)) app.push({ text: c.subject, at: c.at, tag: commitTag(c.subject) });

  // 3) o gun calisan ajanlar (durum.json lastRun o gun)
  const agents: DayItem[] = [];
  const roster = (await readJson<{ roles: { id: string; ad?: string; name: string }[] }>(path.join(root, "roster.json"), { roles: [] })).roles;
  for (const r of roster) {
    const live = await readJson<{ state?: string; lastRun?: string | null; did?: string } | null>(path.join(root, "roller", r.id, "durum.json"), null);
    if (!live?.did || !sameDay(live.lastRun, day)) continue;
    const state = live.state === "failed" ? "hata" : live.state === "blocked" ? "takıldı" : live.state === "working" ? "çalışıyor" : live.state === "idle" ? "bekliyor" : "bitti";
    agents.push({ text: `${r.ad || r.name}: ${live.did}`, at: live.lastRun!, tag: state });
  }

  // 4) o gun yazilan sonuclar (son commit tarihi ya da, gonderilmediyse, dosya tarihi)
  const results: DayItem[] = [];
  const dirs = ["board/results", "raporlar/haftalik", "raporlar/aylik"];
  const log = await run("git", ["-c", "core.quotePath=false", "log", `--after=${day}T00:00:00`, `--before=${nextDay(day)}T00:00:00`, "--format=%x1e%cI", "--name-only", "--diff-filter=AM", "--", ...dirs], root, 20_000);
  const when = new Map<string, string>();
  for (const block of log.out.split("\x1e").slice(1)) {
    const [at, ...names] = block.split("\n");
    for (const n of names.map((x) => x.trim()).filter((x) => x.endsWith(".md"))) if (!when.has(n)) when.set(n, at.trim());
  }
  for (const d of dirs) for (const n of await listMd(path.join(root, d))) {
    const rel = `${d}/${n}`;
    if (when.has(rel)) continue;
    const st = await fs.stat(path.join(root, rel)).catch(() => null);
    if (st && sameDay(new Date(st.mtimeMs).toISOString(), day)) when.set(rel, new Date(st.mtimeMs).toISOString());
  }
  for (const [rel, at] of when) {
    const name = path.basename(rel, ".md");
    const tag = name.startsWith("critic-") ? "Eleştirmen" : name.startsWith("media-") ? "Medya" : name.startsWith("haberler-") ? "Haberler" : rel.startsWith("raporlar/") ? "Rapor" : "Araştırma";
    results.push({ text: name, at, rel, tag });
  }

  // 5) onaylar: o gun acilan ya da karara baglanan
  const approvals: DayItem[] = [];
  for (const [dir, tag] of [["approvals/pending", "Bekliyor"], ["approvals/decided", "Karar verildi"]] as const) {
    for (const n of await listMd(path.join(root, dir))) {
      const { fm, body } = frontMatter(await readText(path.join(root, dir, n)).catch(() => ""));
      const at = tag === "Bekliyor" ? fm.created : fm.decided || fm.created;
      if (!sameDay(at, day)) continue;
      const title = /^#\s+(.+)$/m.exec(body)?.[1] ?? n.replace(/\.md$/, "");
      approvals.push({ text: title, at: at!, rel: `${dir}/${n}`, tag: tag === "Bekliyor" ? tag : fm.decision === "rejected" ? "Reddedildi" : "Onaylandı" });
    }
  }

  // 6) sosyal medya (GitHub'daki ayri repo; internet gerekir)
  const social = await socialDay(root, day);

  const by = (a: DayItem, b: DayItem) => new Date(a.at).getTime() - new Date(b.at).getTime();
  const out: DaySummary = {
    day,
    manager: manager.sort(by),
    app: app.sort(by),
    agents: agents.sort(by),
    results: results.sort(by),
    approvals: approvals.sort(by),
    social: social.items.sort(by),
    socialError: social.error,
    empty: false,
  };
  out.empty = !out.manager.length && !out.app.length && !out.agents.length && !out.results.length && !out.approvals.length && !out.social.length;
  return out;
}
