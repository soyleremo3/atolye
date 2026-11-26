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
const sameDay = (iso: string | null | undefined, day: string) => {
  if (!iso) return false;
  if (/^\d{4}-\d{2}-\d{2}$/.test(iso)) return iso === day;
  const t = Date.parse(iso);
  return !Number.isNaN(t) && localDay(new Date(t)) === day;
};
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

  // 1) yoneticinin satirlari: "- 17:15 — ..." ya da "- 2026-11-24 20:14 — ..." bicimi
  const manager: DayItem[] = [];
  const md = await readText(path.join(root, "raporlar", "gunluk", `${day}.md`)).catch(() => "");
  for (const line of md.split(/\r?\n/)) {
    const m = /^\s*-\s+(.*)$/.exec(line);
    if (!m) continue;
    const hmMatch = /^(?:\d{4}-\d{2}-\d{2}\s+)?(\d{1,2}:\d{2})\b/.exec(m[1]);
    const hm = hmMatch?.[1] ?? "";
    // saat zaten ayri sutunda: metnin basindaki "17:15 — " tekrari atilir
    const text = hmMatch ? m[1].slice(hmMatch[0].length).replace(/^\s*[—–-]\s*/, "").trim() : m[1].trim();
    manager.push({ text, at: hm ? `${day}T${hm.padStart(5, "0")}:00` : `${day}T00:00:00`, rel: `raporlar/gunluk/${day}.md` });
  }

  // 2) uygulamaya giren degisiklikler
  const app: DayItem[] = [];
  if (cfg.appPath) for (const c of await gitDay(cfg.appPath, day)) app.push({ text: c.subject, at: c.at, tag: commitTag(c.subject) });

  // 3) o gun calisan ajanlar (durum.json diskte ya da o gunun git gecmisinde)
  const agents: DayItem[] = [];
  const roster = (await readJson<{ roles: { id: string; ad?: string; name: string }[] }>(path.join(root, "roster.json"), { roles: [] })).roles;
  const roleLabel = new Map(roster.map((r) => [r.id, r.ad || r.name]));
  const stateLabel = (s?: string) => (s === "failed" ? "hata" : s === "blocked" ? "takıldı" : s === "working" ? "çalışıyor" : s === "idle" ? "bekliyor" : "bitti");
  type Rec = { role: string; state?: string; lastRun: string; did: string };
  const recs: Rec[] = [];
  for (const r of roster) {
    const live = await readJson<{ state?: string; lastRun?: string | null; did?: string } | null>(path.join(root, "roller", r.id, "durum.json"), null);
    if (live?.did && live.lastRun && sameDay(live.lastRun, day)) recs.push({ role: r.id, state: live.state, lastRun: live.lastRun, did: live.did });
  }
  const prev = new Date(`${day}T12:00:00`);
  prev.setDate(prev.getDate() - 1);
  const after = new Date(`${day}T12:00:00`);
  after.setDate(after.getDate() + 2);
  const hist = await run("git", ["log", `--after=${localDay(prev)}T00:00:00`, `--before=${localDay(after)}T00:00:00`, "-p", "--", "roller/*/durum.json"], root, 20_000);
  if (hist.code === 0) {
    for (const chunk of hist.out.split(/^diff --git /m).slice(1)) {
      const role = /^a\/roller\/([a-z0-9-]+)\/durum\.json\b/.exec(chunk)?.[1];
      if (!role || !roleLabel.has(role)) continue;
      const added = chunk.split(/\r?\n/).filter((l) => l.startsWith("+") && !l.startsWith("+++")).map((l) => l.slice(1)).join("\n");
      const state = /"state"\s*:\s*"([^"]+)"/.exec(added)?.[1];
      const lastRun = /"lastRun"\s*:\s*"([^"]+)"/.exec(added)?.[1];
      const did = /"did"\s*:\s*"((?:[^"\\]|\\.)*)"/.exec(added)?.[1]?.replace(/\\"/g, '"');
      if (did && lastRun && sameDay(lastRun, day)) recs.push({ role, state, lastRun, did });
    }
  }
  if (roleLabel.has("build")) {
    const stMd = await readText(path.join(root, "state.md")).catch(() => "");
    const sec = stMd.split(/^## Build decision log\b/m)[1] ?? "";
    for (const line of sec.split(/\r?\n/)) {
      const bm = /^-\s+(\d{4}-\d{2}-\d{2})\s+(\d{2}:\d{2}):\s+(.+)$/.exec(line);
      if (bm && bm[1] === day) recs.push({ role: "build", state: "done", lastRun: `${day}T${bm[2]}:00+03:00`, did: bm[3].trim() });
    }
  }
  const seenAgents = new Set<string>();
  for (const rec of recs) {
    const isWorking = rec.state === "working" || /^run started\b/i.test(rec.did);
    if (isWorking) {
      const t0 = Date.parse(rec.lastRun) || 0;
      const finished = recs.some((o) => o.role === rec.role && o.state !== "working" && !/^run started\b/i.test(o.did) && Math.abs((Date.parse(o.lastRun) || 0) - t0) < 120 * 60_000);
      if (finished) continue;
    }
    const key = `${rec.role}|${rec.did}`;
    if (seenAgents.has(key)) continue;
    seenAgents.add(key);
    const cutOff = isWorking && Date.now() - (Date.parse(rec.lastRun) || 0) >= 3 * 60 * 60_000;
    const tag = cutOff ? "yarıda kaldı" : stateLabel(rec.state);
    agents.push({ text: `${roleLabel.get(rec.role)}: ${rec.did}`, at: rec.lastRun, tag });
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
      const title = /^#\s+(.+)$/m.exec(body)?.[1] ?? n.replace(/\.md$/, "");
      const rel = `${dir}/${n}`;
      if (tag === "Bekliyor") {
        if (sameDay(fm.created, day)) approvals.push({ text: title, at: fm.created!, rel, tag });
      } else {
        const decAt = fm.decided || fm.created;
        if (sameDay(decAt, day)) approvals.push({ text: title, at: decAt!, rel, tag: fm.decision === "rejected" ? "Reddedildi" : "Onaylandı" });
        else if (sameDay(fm.created, day)) approvals.push({ text: title, at: fm.created!, rel, tag: "Açıldı" });
      }
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
