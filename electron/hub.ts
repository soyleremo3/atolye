/**
 * Merkez: sahibin her seyi tek yerden gordugu ve yonettigi ekranin ana sureci.
 *  - Otomatik esitleme: Antigravity'nin bu PC'de yazdigi sonuclari kaydedip gonderir (Antigravity'nin
 *    korumali alani .git'e yazamaz), buluttaki degisiklikleri ajan reposuna ve uygulama reposuna indirir.
 *  - Robotlar: schedule.json'daki her robotun bir sonraki ve son calismasi.
 *  - Raporlar: buluttaki (Claude) ve bu PC'deki (Antigravity) tum raporlar tek listede.
 *  - GitHub: uygulama reposunun acik issue'lari (haftalik rapor), son surum, CI.
 * Guvenlik: yalniz bilinen klasorlerdeki dosyalar kaydedilir; uygulama reposuna yalniz ileri sarma
 * (fast-forward) yapilir, yerelde kaydedilmemis ya da gonderilmemis is varsa dokunulmaz.
 */
import { existsSync, promises as fs } from "node:fs";
import path from "node:path";
import { isRunning, listMd, readJson, requireRepo, run, withGitLock, type AgentsConfig } from "./agents";
import { robotRuns, type AgyRun } from "./antigravity";

// ---------------------------------------------------------------- otomatik esitleme
/** Antigravity'nin yazdigi ve Atolye'nin onun yerine kaydettigi yollar (baska hicbir dosyaya dokunulmaz). */
const SAFE = /^(board\/(inbox|doing|done|results)\/[^/]+\.md|roller\/[a-z0-9-]+\/(durum\.json|defter\.md)|raporlar\/(gunluk|haftalik|aylik)\/[^/]+\.md)$/;

export type RepoSync = { ok: boolean; text: string; at: string };
export type SyncStatus = { agents: RepoSync; app: RepoSync | null; saved: number; at: string };

let lastStatus: SyncStatus | null = null;
export const getSyncStatus = () => lastStatus;

/** `git status --porcelain -z` ciktisindaki yollar (yeniden adlandirmada iki yol da). */
function porcelainPaths(out: string): string[] {
  const parts = out.split("\0").filter(Boolean);
  const paths: string[] = [];
  for (let i = 0; i < parts.length; i++) {
    const code = parts[i].slice(0, 2);
    paths.push(parts[i].slice(3));
    if (code.startsWith("R") || code.startsWith("C")) paths.push(parts[++i]);
  }
  return paths;
}

async function syncAgents(root: string): Promise<{ r: RepoSync; saved: number }> {
  const at = new Date().toISOString();
  const st = await run("git", ["-c", "core.quotePath=false", "status", "--porcelain", "-z", "-uall"], root, 20_000);
  if (st.code !== 0) return { r: { ok: false, text: `git okunamadı: ${st.out.slice(-160)}`, at }, saved: 0 };
  const mine = [...new Set(porcelainPaths(st.out).filter((p) => SAFE.test(p)))];
  let saved = 0;
  if (mine.length) {
    const add = await run("git", ["add", "-A", "--", ...mine], root, 20_000);
    if (add.code === 0) {
      const c = await run("git", ["commit", "-m", "chore(board): save Antigravity results from the owner's PC"], root, 20_000);
      if (c.code === 0) saved = mine.length;
    }
  }
  const pull = await run("git", ["pull", "--rebase", "--autostash"], root, 90_000);
  if (pull.code !== 0) {
    await run("git", ["rebase", "--abort"], root, 20_000);
    return { r: { ok: false, text: "İnternet yok ya da çakışma var; yerel dosyalar güvende, sonra yeniden denenecek", at }, saved };
  }
  const ahead = await run("git", ["rev-list", "--count", "@{u}..HEAD"], root, 10_000);
  if (ahead.code === 0 && Number(ahead.out.trim()) > 0) {
    const push = await run("git", ["push"], root, 90_000);
    if (push.code !== 0) return { r: { ok: false, text: "Kaydedildi ama gönderilemedi (internet?); sonra yeniden denenecek", at }, saved };
  }
  return { r: { ok: true, text: saved ? `${saved} dosya buluta gönderildi, bulut indirildi` : "Bulutla aynı", at }, saved };
}

async function syncApp(root: string): Promise<RepoSync> {
  const at = new Date().toISOString();
  const dirty = await run("git", ["status", "--porcelain", "--untracked-files=no"], root, 20_000);
  if (dirty.code !== 0) return { ok: false, text: "git okunamadı", at };
  const fetch = await run("git", ["fetch", "--quiet"], root, 90_000);
  if (fetch.code !== 0) return { ok: false, text: "İnternet yok; sonra yeniden denenecek", at };
  const count = async (range: string) => Number((await run("git", ["rev-list", "--count", range], root, 10_000)).out.trim()) || 0;
  const behind = await count("HEAD..@{u}");
  const ahead = await count("@{u}..HEAD");
  if (!behind) return { ok: true, text: ahead ? `Güncel (${ahead} kayıt gönderilmeyi bekliyor)` : "Bulutla aynı", at };
  if (dirty.out.trim()) return { ok: false, text: `Buluttan ${behind} yeni kayıt var ama bu PC'de kaydedilmemiş değişiklik var; dokunulmadı`, at };
  if (ahead) return { ok: false, text: `Buluttan ${behind} yeni kayıt var ama bu PC'de gönderilmemiş ${ahead} kayıt var; dokunulmadı`, at };
  const ff = await run("git", ["merge", "--ff-only", "@{u}"], root, 60_000);
  return ff.code === 0 ? { ok: true, text: `Buluttan ${behind} yeni kayıt indirildi`, at } : { ok: false, text: "İleri sarılamadı; dokunulmadı", at };
}

/** Iki repoyu esitler (sirayla, git kilidiyle). Hata atmaz; durumu dondurur. */
export function autoSync(cfg: AgentsConfig): Promise<SyncStatus> {
  return withGitLock(async () => {
    const root = requireRepo(cfg);
    const a = await syncAgents(root);
    const app = cfg.appPath && existsSync(path.join(cfg.appPath, ".git")) ? await syncApp(cfg.appPath) : null;
    lastStatus = { agents: a.r, app, saved: a.saved, at: new Date().toISOString() };
    return lastStatus;
  });
}

// ---------------------------------------------------------------- robotlar
type Robot = { id: string; ad: string; where: "cloud" | "pc"; cron: string; model: string; what: string; last: { commit?: string; file?: string; roles?: string[] } | null };
export type RobotView = Omit<Robot, "last"> & { next: string | null; last: string | null; live: AgyRun | null };

function field(spec: string, min: number, max: number): Set<number> {
  const out = new Set<number>();
  for (const part of spec.split(",")) {
    const [range, stepText] = part.split("/");
    const step = Math.max(1, Number(stepText) || 1);
    let lo: number;
    let hi: number;
    if (range === "*") [lo, hi] = [min, max];
    else if (range.includes("-")) [lo, hi] = range.split("-").map(Number) as [number, number];
    else [lo, hi] = [Number(range), stepText ? max : Number(range)];
    for (let v = lo; v <= hi; v += step) out.add(v);
  }
  return out;
}

/** 5 alanli cron'un (dakika saat gun ay haftagunu) bu PC saatine gore bir sonraki zamani. */
export function nextRun(cron: string, from = new Date()): Date | null {
  const parts = cron.replace(/^CRON_TZ=\S+\s+/, "").trim().split(/\s+/);
  if (parts.length !== 5) return null;
  const [m, h, dom, mon, dow] = parts;
  const M = field(m, 0, 59), H = field(h, 0, 23), D = field(dom, 1, 31), Mo = field(mon, 1, 12), W = field(dow, 0, 7);
  if (W.has(7)) W.add(0);
  const d = new Date(from);
  d.setSeconds(0, 0);
  d.setMinutes(d.getMinutes() + 1);
  for (let i = 0; i < 60 * 24 * 9; i++) {
    const dayOk = dom === "*" && dow === "*" ? true : dom === "*" ? W.has(d.getDay()) : dow === "*" ? D.has(d.getDate()) : D.has(d.getDate()) || W.has(d.getDay());
    if (Mo.has(d.getMonth() + 1) && dayOk && H.has(d.getHours()) && M.has(d.getMinutes())) return d;
    d.setMinutes(d.getMinutes() + 1);
  }
  return null;
}

async function lastOf(root: string, last: Robot["last"]): Promise<string | null> {
  if (!last) return null;
  if (last.commit) {
    const r = await run("git", ["log", "-1", "--fixed-strings", `--grep=${last.commit}`, "--format=%cI"], root, 10_000);
    return r.code === 0 && r.out.trim() ? r.out.trim() : null;
  }
  if (last.file) {
    const dir = path.join(root, path.dirname(last.file));
    const prefix = path.basename(last.file);
    const names = (await listMd(dir)).filter((n) => n.startsWith(prefix));
    let best = 0;
    for (const n of names) {
      const st = await fs.stat(path.join(dir, n)).catch(() => null);
      if (st && st.mtimeMs > best) best = st.mtimeMs;
    }
    return best ? new Date(best).toISOString() : null;
  }
  if (last.roles) {
    let best = "";
    for (const id of last.roles) {
      const live = await readJson<{ lastRun?: string } | null>(path.join(root, "roller", id, "durum.json"), null);
      if (live?.lastRun && new Date(live.lastRun).getTime() > new Date(best || 0).getTime()) best = live.lastRun;
    }
    return best || null;
  }
  return null;
}

export async function robots(cfg: AgentsConfig): Promise<RobotView[]> {
  const root = requireRepo(cfg);
  const list = (await readJson<{ robots: Robot[] }>(path.join(root, "schedule.json"), { robots: [] })).robots;
  const runs = await robotRuns(root).catch(() => ({} as Record<string, AgyRun>));
  // Buluttaki yonetici: durum.json "working" ve son 3 saatte degismis -> su an calisiyor (zamanlanmis ya da tusla)
  const mgrFile = path.join(root, "roller", "manager", "durum.json");
  const mgr = await readJson<{ state?: string; did?: string } | null>(mgrFile, null);
  const mgrAt = (await fs.stat(mgrFile).catch(() => null))?.mtimeMs ?? 0;
  if (isRunning("manager")) {
    const at = new Date().toISOString();
    runs.manager = { sidecar: "", name: "Claude yönetici", state: "running", started: at, updated: at, model: "opus", note: "bu PC'de, işleri dağıtıyor" };
  } else if (mgr?.state === "working" && Date.now() - mgrAt < 3 * 60 * 60_000) {
    const at = new Date(mgrAt).toISOString();
    runs.manager = { sidecar: "", name: "Claude yönetici", state: "running", started: at, updated: at, model: null, note: mgr.did || "işleri dağıtıyor" };
  }
  return Promise.all(list.map(async (r) => {
    const run = runs[r.id] ?? null;
    let last = await lastOf(root, r.last);
    // Antigravity'nin kendi kaydi daha yeniyse son calisma odur (rapor dosyasi yazilmasa da)
    if (run && run.state !== "running" && (!last || run.updated > last)) last = run.updated;
    return { id: r.id, ad: r.ad, where: r.where, cron: r.cron, model: r.model, what: r.what, next: nextRun(r.cron)?.toISOString() ?? null, last, live: run };
  }));
}

// ---------------------------------------------------------------- tum raporlar
export type ReportItem = { rel: string; title: string; kind: string; origin: "cloud" | "pc"; pending: boolean; date: string };

function kindOf(rel: string): string {
  const name = path.basename(rel);
  if (rel.startsWith("raporlar/gunluk/")) return "Günlük rapor";
  if (rel.startsWith("raporlar/aylik/")) return "Aylık rapor";
  if (rel.startsWith("raporlar/haftalik/")) return name.startsWith("haberler-") ? "Haberler" : "Haftalık rapor";
  if (name.startsWith("critic-")) return "Eleştirmen";
  if (name.startsWith("media-")) return "Medya istemleri";
  return "Araştırma sonucu";
}

export async function allReports(cfg: AgentsConfig): Promise<ReportItem[]> {
  const root = requireRepo(cfg);
  const dirs = ["raporlar/gunluk", "raporlar/haftalik", "raporlar/aylik", "board/results"];
  const files: string[] = [];
  for (const d of dirs) for (const n of await listMd(path.join(root, d))) files.push(`${d}/${n}`);
  // her dosyanin son kaydi: yazar (Claude = bulut) ve tarih; tek git cagrisi
  const log = await run("git", ["-c", "core.quotePath=false", "log", "-300", "--format=%x1e%an%x1f%cI", "--name-only", "--", ...dirs], root, 20_000);
  const seen = new Map<string, { author: string; date: string }>();
  for (const block of log.out.split("\x1e").slice(1)) {
    const [head, ...names] = block.split("\n");
    const [author, date] = head.split("\x1f");
    for (const n of names.map((x) => x.trim()).filter(Boolean)) if (!seen.has(n)) seen.set(n, { author, date });
  }
  const st = await run("git", ["-c", "core.quotePath=false", "status", "--porcelain", "-z", "-uall", "--", ...dirs], root, 20_000);
  const pendingSet = new Set(porcelainPaths(st.out));
  const out: ReportItem[] = [];
  for (const rel of files) {
    const info = seen.get(rel);
    const stat = await fs.stat(path.join(root, rel)).catch(() => null);
    out.push({
      rel,
      title: path.basename(rel, ".md"),
      kind: kindOf(rel),
      origin: info && /claude/i.test(info.author) ? "cloud" : "pc",
      pending: pendingSet.has(rel),
      date: info?.date ?? (stat ? new Date(stat.mtimeMs).toISOString() : ""),
    });
  }
  return out.sort((a, b) => b.date.localeCompare(a.date));
}

// ---------------------------------------------------------------- GitHub (gh)
export type GhIssue = { number: number; title: string; labels: string[]; updatedAt: string; url: string; repo: "app" | "agents" };
export type GhInfo = { ok: boolean; error?: string; issues: GhIssue[]; release: { tag: string; date: string; url: string } | null; ci: { name: string; title: string; status: string; conclusion: string; date: string; url: string }[]; ciNote?: string };

let ghCache: { at: number; data: GhInfo } | null = null;

async function gh(args: string[], cwd: string): Promise<unknown> {
  const r = await run("gh", args, cwd, 30_000);
  if (r.code !== 0) throw new Error(r.out.slice(-200) || "gh çalışmadı");
  return JSON.parse(r.out || "null");
}

export async function github(cfg: AgentsConfig, force = false): Promise<GhInfo> {
  if (!force && ghCache && Date.now() - ghCache.at < 120_000) return ghCache.data;
  const root = requireRepo(cfg);
  const data: GhInfo = { ok: true, issues: [], release: null, ci: [] };
  try {
    const issueArgs = ["issue", "list", "--state", "open", "--limit", "20", "--json", "number,title,labels,updatedAt,url"];
    const toIssue = (repo: "app" | "agents") => (x: { number: number; title: string; labels: { name: string }[]; updatedAt: string; url: string }): GhIssue => ({ number: x.number, title: x.title, labels: x.labels.map((l) => l.name), updatedAt: x.updatedAt, url: x.url, repo });
    type RawIssue = Parameters<ReturnType<typeof toIssue>>[0];
    const app = cfg.appPath && existsSync(cfg.appPath) ? cfg.appPath : "";
    // tum gh cagrilari ayni anda (sirayla ~6 sn surer)
    const [agentIssues, appIssues, rel, remote, runs] = await Promise.all([
      gh(issueArgs, root) as Promise<RawIssue[]>,
      app ? (gh(issueArgs, app) as Promise<RawIssue[]>) : Promise.resolve([] as RawIssue[]),
      app ? (gh(["release", "list", "-L", "1", "--json", "tagName,publishedAt"], app) as Promise<{ tagName: string; publishedAt: string }[]>) : Promise.resolve([]),
      app ? run("gh", ["repo", "view", "--json", "url", "-q", ".url"], app, 20_000).then((r) => r.out.trim()) : Promise.resolve(""),
      app ? (gh(["run", "list", "-L", "5", "--json", "databaseId,name,displayTitle,status,conclusion,createdAt,url"], app) as Promise<{ databaseId: number; name: string; displayTitle: string; status: string; conclusion: string; createdAt: string; url: string }[]>) : Promise.resolve([]),
    ]);
    data.issues.push(...agentIssues.map(toIssue("agents")), ...appIssues.map(toIssue("app")));
    if (rel[0]) data.release = { tag: rel[0].tagName, date: rel[0].publishedAt, url: `${remote}/releases/tag/${rel[0].tagName}` };
    data.ci = runs.map((x) => ({ name: x.name, title: x.displayTitle, status: x.status, conclusion: x.conclusion, date: x.createdAt, url: x.url }));
    data.issues.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    // Son CI kirmiziysa: is hic baslamadiysa (adim yok) sebep kod degil GitHub hesabidir (dakika/fatura)
    const last = runs[0];
    if (app && last && last.status === "completed" && last.conclusion !== "success") {
      const jobs = (await gh(["run", "view", String(last.databaseId), "--json", "jobs"], app).catch(() => null)) as { jobs: { steps: unknown[] }[] } | null;
      if (jobs && jobs.jobs.length && jobs.jobs.every((j) => !j.steps.length))
        data.ciNote = "CI hiç başlamadı: GitHub, hesabın Actions dakikası/ödeme ayarı (Billing & plans) yüzünden işi başlatmadı. Bu bir kod hatası değil. Ücretsiz dakikalar her ay başında yenilenir; para ödemen gerekmez.";
    }
  } catch (e) {
    data.ok = false;
    data.error = `GitHub okunamadı (internet ya da gh girişi): ${String((e as Error).message || e).slice(0, 160)}`;
  }
  ghCache = { at: Date.now(), data };
  return data;
}

/** Bir issue'nun metni (haftalik rapor gibi) — Atolye icinde okumak icin. */
export async function issueBody(cfg: AgentsConfig, repo: "app" | "agents", n: number): Promise<string> {
  const cwd = repo === "app" ? cfg.appPath : requireRepo(cfg);
  if (!cwd || !Number.isInteger(n) || n <= 0) throw new Error("Geçersiz issue");
  const x = (await gh(["issue", "view", String(n), "--json", "title,body,url"], cwd)) as { title: string; body: string; url: string };
  return `# ${x.title}\n\n${x.body}`;
}
