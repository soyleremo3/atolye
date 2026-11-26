/**
 * Ajanlar: basketball-agents reposunu okur, git ile esitler, onay/gorev/not yazar ve
 * "Hemen calistir" ile bir rolu bu PC'de `claude -p` ile calistirir.
 * Guvenlik: sadece secilen ajan reposunun icindeki bilinen yollar okunur/yazilir; dosya adlari
 * siki regex ile dogrulanir; git ve claude kabuksuz argumanlarla cagrilir, istem stdin'den verilir.
 */
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { existsSync, promises as fs, readFileSync } from "node:fs";
import path from "node:path";
import { runningRoles } from "./antigravity";

export type AgentsConfig = { repoPath: string; appPath: string };

const NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,120}\.md$/;
const ROLE = /^[a-z][a-z0-9-]{0,40}$/;
const MAX_FILE = 256 * 1024;

export function guessPaths(home: string): AgentsConfig {
  const base = path.join(home, "Desktop", "Basketball APP");
  const repo = path.join(base, "basketball-agents");
  const app = path.join(base, "version6");
  return { repoPath: existsSync(repo) ? repo : "", appPath: existsSync(app) ? app : "" };
}

export async function readText(file: string): Promise<string> {
  try {
    const st = await fs.stat(file);
    if (st.size > MAX_FILE) return `(dosya çok büyük: ${Math.round(st.size / 1024)} KB)`;
    return await fs.readFile(file, "utf8");
  } catch {
    return "";
  }
}

export async function readJson<T>(file: string, fallback: T): Promise<T> {
  try {
    return JSON.parse(await fs.readFile(file, "utf8")) as T;
  } catch {
    return fallback;
  }
}

export async function listMd(dir: string): Promise<string[]> {
  try {
    return (await fs.readdir(dir)).filter((n) => NAME.test(n)).sort().reverse();
  } catch {
    return [];
  }
}

export function frontMatter(text: string): { fm: Record<string, string>; body: string } {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(text);
  if (!m) return { fm: {}, body: text };
  const fm: Record<string, string> = {};
  for (const line of m[1].split(/\r?\n/)) {
    const i = line.indexOf(":");
    if (i > 0) fm[line.slice(0, i).trim()] = line.slice(i + 1).replace(/\s+#.*$/, "").trim();
  }
  return { fm, body: text.slice(m[0].length) };
}

export function run(cmd: string, args: string[], cwd: string, timeoutMs = 60_000): Promise<{ code: number; out: string }> {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { cwd, windowsHide: true });
    let out = "";
    const MAX_OUT = 512_000;
    const add = (d: Buffer) => {
      out += d.toString();
      if (out.length > MAX_OUT) out = out.slice(-MAX_OUT);
    };
    child.stdout.on("data", add);
    child.stderr.on("data", add);
    const t = setTimeout(() => child.kill(), timeoutMs);
    child.on("error", (e) => { clearTimeout(t); resolve({ code: -1, out: String(e.message) }); });
    child.on("close", (code) => { clearTimeout(t); resolve({ code: code ?? -1, out }); });
  });
}

export function requireRepo(cfg: AgentsConfig): string {
  if (!cfg.repoPath || !existsSync(path.join(cfg.repoPath, "roster.json"))) throw new Error("Ajan reposu bulunamadı. Ajanlar → Ayarlar'dan basketball-agents klasörünü seç.");
  return cfg.repoPath;
}

/** Gonderi reposunun son kayitlari (bulut hazirlar "Queue …", paylasir "Publish …"); 5 dk onbellek. */
let postsCache: { at: number; items: { at: string; subject: string }[] } | null = null;
export async function postsCommits(cwd: string): Promise<{ at: string; subject: string }[]> {
  if (postsCache && Date.now() - postsCache.at < 5 * 60_000) return postsCache.items;
  const r = await run("gh", ["api", "repos/soyleremo3/Basketball-APP-Posts/commits?per_page=40", "--jq", ".[] | [.commit.committer.date, (.commit.message | split(\"\\n\")[0])] | @tsv"], cwd, 30_000);
  if (r.code !== 0) return postsCache?.items ?? [];
  const items = r.out.split("\n").filter(Boolean).map((l) => { const [at, subject] = l.split("\t"); return { at, subject: subject ?? "" }; });
  postsCache = { at: Date.now(), items };
  return items;
}

async function gitLast(cwd: string, paths: string[], grep?: string): Promise<{ at: string; subject: string } | null> {
  if (!cwd || !existsSync(path.join(cwd, ".git"))) return null;
  const args = ["log", "-1", ...(grep ? ["--fixed-strings", `--grep=${grep}`] : []), "--format=%cI\x1f%s", ...(paths.length ? ["--", ...paths] : [])];
  const r = await run("git", args, cwd, 10_000);
  if (r.code !== 0 || !r.out.trim()) return null;
  const [at, subject] = r.out.trim().split("\n")[0].split("\x1f");
  return at ? { at, subject: subject ?? "" } : null;
}

/** Isini baska bir repoya ya da rapora yazan roller: durum.json'u yazmasalar da ofiste son isleri gorunsun. */
async function evidence(root: string, appPath: string, id: string): Promise<{ at: string; did: string } | null> {
  if (id === "social") {
    const c = (await postsCommits(root)).find((x) => /^(Queue |Publish 20)/.test(x.subject));
    return c ? { at: c.at, did: c.subject.startsWith("Publish") ? `LinkedIn'de paylaşıldı: ${c.subject.slice(8)}` : `Gönderi hazırlandı: ${c.subject.slice(6)}` } : null;
  }
  if (id === "reporter" || id === "news") {
    const names = (await listMd(path.join(root, "raporlar", "haftalik"))).filter((n) => n.startsWith("haberler-") === (id === "news"));
    if (!names.length) return null;
    const rel = `raporlar/haftalik/${names[0]}`;
    const g = await gitLast(root, [rel]);
    const st = !g ? await fs.stat(path.join(root, rel)).catch(() => null) : null;
    const at = g?.at ?? (st ? new Date(st.mtimeMs).toISOString() : "");
    return at ? { at, did: `${id === "news" ? "Haftalık haberler" : "Haftalık rapor"} yazıldı: ${names[0].replace(/\.md$/, "")}` } : null;
  }
  if (id === "build") {
    const state = await readText(path.join(root, "state.md"));
    const sec = state.split(/^## Build decision log\b/m)[1] ?? "";
    const m = /^-\s+(\d{4}-\d{2}-\d{2})\s+(\d{2}:\d{2}):\s+(.+)$/m.exec(sec);
    return m ? { at: `${m[1]}T${m[2]}:00+03:00`, did: m[3].trim() } : null;
  }
  if (id === "bridge") {
    const g = await gitLast(root, ["board"]);
    return g ? { at: g.at, did: g.subject } : null;
  }
  if (id === "info") {
    const g = (await gitLast(appPath, ["CLAUDE.md", "README.md", "RULES.md", "docs"])) ?? (await gitLast(root, ["ANAYASA.md", "defter/genel.md", "state.md"]));
    return g ? { at: g.at, did: g.subject } : null;
  }
  if (id === "github") {
    const gate = appPath ? await readJson<{ ok?: boolean; commit?: string; at?: string } | null>(path.join(appPath, ".git", "ci-local.json"), null) : null;
    const rel = await gitLast(appPath, [], "release: v");
    if (gate?.at && (!rel || Date.parse(gate.at) >= Date.parse(rel.at))) {
      return { at: gate.at, did: `Yerel CI kontrolü ${gate.ok ? "yeşil" : "kırmızı"} (${gate.commit ?? ""})` };
    }
    return rel ? { at: rel.at, did: rel.subject } : null;
  }
  if (id === "data") {
    const g = await gitLast(appPath, ["training", "scripts/label-count.py"]);
    return g ? { at: g.at, did: g.subject } : null;
  }
  if (id === "colab") {
    const g = await gitLast(appPath, ["training/teacher.ipynb", "training/referee.ipynb", "training/ball_motion.ipynb"]);
    return g ? { at: g.at, did: g.subject } : null;
  }
  if (id === "drive") {
    const log = appPath ? await readText(path.join(appPath, "docs", "reference", "activity-log.md")) : "";
    const m = /^-\s+(\d{4}-\d{2}-\d{2})\s+—\s+([^\r\n]*\bDrive\b[^\r\n]*)$/m.exec(log);
    if (m) return { at: `${m[1]}T12:00:00+03:00`, did: m[2].replace(/\*\*/g, "").slice(0, 140) };
    const g = await gitLast(appPath, ["training"]);
    return g ? { at: g.at, did: `Eğitim dosyası güncellendi: ${g.subject}` } : null;
  }
  if (id === "coach") {
    const g = await gitLast(appPath, ["src/coach"]);
    return g ? { at: g.at, did: g.subject } : null;
  }
  return null;
}

const STALE_WORKING_MS = 3 * 60 * 60_000;

export async function snapshot(cfg: AgentsConfig) {
  const root = requireRepo(cfg);
  const roster = (await readJson<{ roles: any[] }>(path.join(root, "roster.json"), { roles: [] })).roles;
  const agy = await runningRoles(root).catch(() => ({} as Awaited<ReturnType<typeof runningRoles>>));
  const roles = await Promise.all(roster.map(async (r) => {
    const durumFile = path.join(root, "roller", r.id, "durum.json");
    let live = await readJson<Record<string, unknown> | null>(durumFile, null);
    if (live?.state === "working" && !isRunning(r.id)) {
      const mtime = (await fs.stat(durumFile).catch(() => null))?.mtimeMs ?? 0;
      const lastMs = live.lastRun ? Date.parse(String(live.lastRun)) || 0 : 0;
      const seenAt = Math.max(mtime, lastMs);
      if (seenAt > 0 && Date.now() - seenAt >= STALE_WORKING_MS) {
        live = { ...live, state: "done", did: `${String(live.did || "çalışma")} (yarıda kaldı)` };
      }
    }
    const ev = await evidence(root, cfg.appPath, r.id).catch(() => null);
    if (ev && live?.state !== "working" && (!live?.lastRun || (Date.parse(ev.at) || 0) > (Date.parse(String(live.lastRun)) || 0)))
      live = { ...(live ?? { role: r.id, number: r.number, model: r.model, next: "", blockedOn: "" }), state: "done", lastRun: ev.at, did: ev.did };
    if (isRunning(r.id)) {
      const lastTool = current ? [...current.info.events].reverse().find((e) => e.kind === "tool")?.text : "";
      live = {
        ...(live ?? { role: r.id, number: r.number, model: r.model, lastRun: new Date().toISOString(), next: "", blockedOn: "" }),
        state: "working",
        did: `Bu PC'de çalışıyor${lastTool ? `: ${lastTool}` : ""}`,
      };
    }
    const run = agy[r.id];
    // Antigravity su an bu rol icin calisiyorsa ofiste "calisiyor" gorunsun (durum.json is bitince yazilir)
    return { ...r, live: run ? { ...(live ?? { role: r.id, number: r.number, model: r.model, lastRun: null, next: "", blockedOn: "" }), state: "working", did: `Antigravity çalışıyor (${run.name}, ${run.note})`, source: "antigravity" } : live };
  }));
  const items = async (dir: string) => Promise.all((await listMd(path.join(root, dir))).map(async (name) => {
    const { fm, body } = frontMatter(await readText(path.join(root, dir, name)));
    return { name, fm, body };
  }));
  const reports: { kind: string; name: string }[] = [];
  for (const kind of ["gunluk", "haftalik", "aylik"]) for (const name of await listMd(path.join(root, "raporlar", kind))) reports.push({ kind, name });
  const log = await run("git", ["log", "-8", "--pretty=format:%h\x1f%cI\x1f%s"], root, 15_000);
  return {
    repoPath: root,
    appPath: cfg.appPath,
    roles,
    approvals: { pending: await items("approvals/pending"), decided: (await items("approvals/decided")).slice(0, 20) },
    board: { inbox: await items("board/inbox"), doing: await items("board/doing"), done: (await items("board/done")).slice(0, 20), results: (await listMd(path.join(root, "board", "results"))).slice(0, 20) },
    reports,
    state: await readText(path.join(root, "state.md")),
    commits: log.code === 0 ? log.out.split("\n").filter(Boolean).map((l) => { const [hash, date, subject] = l.split("\x1f"); return { hash, date, subject }; }) : [],
  };
}

/** Ajan reposundaki bir metin dosyasini okur (yalniz bilinen klasorler). */
export async function readDoc(cfg: AgentsConfig, rel: string): Promise<string> {
  const root = requireRepo(cfg);
  const ok = /^(ANAYASA\.md|KURULUM\.md|README\.md|state\.md|sahip-notlari\.md|defter\/genel\.md|roller\/[a-z0-9-]+\/(rol|defter)\.md|raporlar\/(gunluk|haftalik|aylik)\/[^/]+\.md|board\/(inbox|doing|done|results)\/[^/]+\.md|approvals\/(pending|decided)\/[^/]+\.md|playbooks\/[a-z-]+\.md)$/.test(rel);
  if (!ok || rel.includes("..")) throw new Error("Bu dosya okunamaz");
  return readText(path.join(root, rel));
}

// Ayni repoda iki git islemi ayni anda calismasin (arka plan esitlemesi + onay/gorev yazimi)
let gitChain: Promise<unknown> = Promise.resolve();
export function withGitLock<T>(fn: () => Promise<T>): Promise<T> {
  const next = gitChain.then(fn, fn);
  gitChain = next.catch(() => undefined);
  return next;
}

export async function sync(cfg: AgentsConfig): Promise<string> {
  const root = requireRepo(cfg);
  const r = await withGitLock(() => run("git", ["pull", "--rebase", "--autostash"], root));
  if (r.code !== 0) throw new Error(`Eşitleme olmadı (internet ya da git): ${r.out.slice(-300)}`);
  return r.out.trim().split("\n").pop() || "Güncel";
}

function commitPush(root: string, files: string[], message: string): Promise<string> {
  return withGitLock(() => commitPushNow(root, files, message));
}

async function commitPushNow(root: string, files: string[], message: string): Promise<string> {
  for (const f of files) {
    const a = await run("git", ["add", "--", f], root, 15_000);
    if (a.code !== 0) throw new Error(`git add: ${a.out.slice(-200)}`);
  }
  const c = await run("git", ["commit", "-m", message], root, 15_000);
  if (c.code !== 0) throw new Error(`git commit: ${c.out.slice(-200)}`);
  const p = await run("git", ["push"], root);
  if (p.code !== 0) {
    const pr = await run("git", ["pull", "--rebase", "--autostash"], root);
    const p2 = pr.code === 0 ? await run("git", ["push"], root) : pr;
    if (p2.code !== 0) return "Kaydedildi ama gönderilemedi (internet yok?). Sonraki eşitlemede gönderilir.";
  }
  return "Kaydedildi ve gönderildi.";
}

const nowIso = () => {
  const d = new Date();
  const off = -d.getTimezoneOffset();
  const pad = (n: number) => String(Math.trunc(Math.abs(n))).padStart(2, "0");
  return new Date(d.getTime() + off * 60_000).toISOString().slice(0, 19) + (off >= 0 ? "+" : "-") + pad(off / 60) + ":" + pad(off % 60);
};
const today = () => nowIso().slice(0, 10);
const slug = (s: string) => s.toLocaleLowerCase("tr").normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/ı/g, "i").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "is";

export async function decide(cfg: AgentsConfig, name: string, decision: "approved" | "rejected", note: string): Promise<string> {
  const root = requireRepo(cfg);
  if (!NAME.test(name) || !["approved", "rejected"].includes(decision)) throw new Error("Geçersiz onay");
  const from = path.join(root, "approvals", "pending", name);
  const text = await fs.readFile(from, "utf8");
  const clean = String(note || "").replace(/[\r\n]+/g, " ").slice(0, 400);
  const extra = `decision: ${decision}\ndecided: ${nowIso()}${clean ? `\nnote: ${clean}` : ""}\n`;
  const next = /^---\r?\n/.test(text) ? text.replace(/^---\r?\n/, `---\n${extra}`) : `---\n${extra}---\n${text}`;
  const to = path.join(root, "approvals", "decided", name);
  await fs.writeFile(to, next, "utf8");
  await fs.rm(from);
  return commitPush(root, [`approvals/pending/${name}`, `approvals/decided/${name}`], `chore(approvals): ${decision === "approved" ? "approve" : "reject"} ${name.replace(/\.md$/, "")}`);
}

export async function newTask(cfg: AgentsConfig, title: string, body: string, forWho: "claude" | "agy"): Promise<string> {
  const root = requireRepo(cfg);
  const t = String(title || "").trim().slice(0, 120);
  if (!t) throw new Error("Görevin bir başlığı olmalı");
  const name = `${today()}-${slug(t)}.md`;
  const file = path.join(root, "board", "inbox", name);
  if (existsSync(file)) throw new Error("Bu adla bir görev zaten var");
  const text = `---\nfor: ${forWho === "agy" ? "agy" : "claude"}\nscore: 25\nbar: owner\nbudget: 1 run\ncreated: ${today()}\n---\n# ${t}\n\n${String(body || "").slice(0, 4000)}\n\nSahibin görevi (Atölye). Done-test: yönetici belirler ve sonuna yazar.\n`;
  await fs.writeFile(file, text, "utf8");
  return commitPush(root, [`board/inbox/${name}`], `chore(board): owner task ${slug(t)}`);
}

export async function ownerNote(cfg: AgentsConfig, text: string, roles: string): Promise<string> {
  const root = requireRepo(cfg);
  const t = String(text || "").replace(/[\r\n]+/g, " ").trim().slice(0, 600);
  const who = String(roles || "hepsi").replace(/[^0-9a-zA-Zçğıöşü+, ]/g, "").trim() || "hepsi";
  if (!t) throw new Error("Not boş olamaz");
  const file = path.join(root, "sahip-notlari.md");
  const cur = await fs.readFile(file, "utf8");
  await fs.writeFile(file, `${cur.replace(/\s*$/, "\n")}- ${today()} · kimler: ${who} · ${t}\n`, "utf8");
  return commitPush(root, ["sahip-notlari.md"], "docs(notes): owner note");
}

// ------------------------------------------------------------------ Hemen calistir
export type RunEvent = { runId: string; role?: string; kind: "start" | "tool" | "text" | "end"; text: string; at: number };
type RunInfo = { id: string; role: string; started: number; ended?: number; ok?: boolean; summary?: string; events: RunEvent[] };
const runs: RunInfo[] = [];
let runsLoadedFrom = "";
let current: { info: RunInfo; child: ChildProcessWithoutNullStreams } | null = null;

function loadSavedRuns(root?: string): void {
  if (process.env.ATOLYE_SMOKE || !root || runsLoadedFrom === root) return;
  runsLoadedFrom = root;
  try {
    const file = path.join(root, ".atolye", "runs.json");
    if (!existsSync(file)) return;
    const saved = JSON.parse(readFileSync(file, "utf8")) as RunInfo[];
    if (!Array.isArray(saved) || runs.length > 0) return;
    for (const r of saved.slice(-10)) {
      if (r && typeof r.id === "string" && typeof r.role === "string") {
        runs.push({ ...r, ended: r.ended ?? r.started, ok: r.ok ?? false, events: Array.isArray(r.events) ? r.events.slice(-200) : [] });
      }
    }
  } catch {
    /* bozuk kayit yoksayilir */
  }
}

async function saveRuns(root: string): Promise<void> {
  if (process.env.ATOLYE_SMOKE || !root) return;
  try {
    const dir = path.join(root, ".atolye");
    await fs.mkdir(dir, { recursive: true });
    const data = runs.slice(-10).map((r) => ({ ...r, events: r.events.slice(-200) }));
    await fs.writeFile(path.join(dir, "runs.json"), JSON.stringify(data), "utf8");
  } catch {
    /* yazilamadiysa gec */
  }
}

export function listRuns(cfg?: AgentsConfig): RunInfo[] {
  if (cfg?.repoPath) loadSavedRuns(cfg.repoPath);
  return runs.slice(-10).reverse().map((r) => ({ ...r, events: r.events.slice(-200) }));
}

/** Bir ajan (ya da yerel yonetici) su an bu PC'de calisiyor mu; calisirken otomatik esitleme bekler. */
export function isRunning(role?: string): boolean {
  return !!current && (!role || current.info.role === role);
}

export function stopRun(): boolean {
  if (!current) return false;
  current.child.kill();
  return true;
}

/** Claude Code'un yerel kurulumu (Windows yerel yukleyicisi ~/.local/bin/claude.exe koyar). */
export function claudeBinary(): string {
  const home = process.env.USERPROFILE || process.env.HOME || "";
  const local = path.join(home, ".local", "bin", process.platform === "win32" ? "claude.exe" : "claude");
  return existsSync(local) ? local : process.platform === "win32" ? "claude.exe" : "claude";
}

function promptFor(role: string, task: string, cfg: AgentsConfig): string {
  return [
    `You are role "${role}" of the Basketball APP agent system, started by the owner from Atölye ("Hemen çalıştır").`,
    `Agent repo: ${cfg.repoPath}. App repo: ${cfg.appPath || "(not set)"}.`,
    "First read ANAYASA.md, roller/" + role + "/rol.md, roller/" + role + "/defter.md and defter/genel.md in the agent repo; for app work also CLAUDE.md and RULES.md in the app repo.",
    task.trim() ? `Task from the owner: ${task.trim()}` : "Task: take the highest-score ticket for you in board/inbox (lock it by moving it to board/doing and pushing), or report that there is none.",
    "Important actions (builds, emails, posts, dependencies, deletions, money, rule files) are never done: write an approval request in approvals/pending/ instead.",
    "Run the gate for app changes. Commit named files only, short English messages, no AI attribution; push. Update roller/" + role + "/durum.json and add at most one lesson to its defter.md. End with a 3-line Turkish summary for the owner.",
  ].join("\n");
}

/** roster.json'daki model (claude-opus / claude-sonnet / claude-haiku) -> claude --model takma adi. */
export function modelFor(root: string, role: string): string | null {
  try {
    const roster = JSON.parse(readFileSync(path.join(root, "roster.json"), "utf8")).roles as { id: string; model: string }[];
    const m = roster.find((r) => r.id === role)?.model ?? "";
    const alias = /^claude-(opus|sonnet|haiku)$/.exec(m)?.[1];
    return alias ?? null;
  } catch {
    return null;
  }
}

/**
 * Bu PC'de "rtk" kancasi (kullanici ayari) bazi komutlarin basina "rtk " ekler (git, gh, npm...);
 * kural eslesmesi bozulmasin diye her Bash kuralinin "rtk " bicimi de eklenir (izin ve yasak icin ayni).
 */
export function withRtk(rules: string): string {
  const out: string[] = [];
  for (const r of rules.split(",")) {
    out.push(r);
    const m = /^Bash\((.+)\)$/.exec(r);
    if (m && !m[1].startsWith("cd ")) out.push(`Bash(rtk ${m[1]})`);
  }
  return out.join(",");
}

/**
 * Kapi komutlari (test, tur kontrolu, lint). rtk "npx jest" -> "rtk jest", "npx tsc" -> "rtk tsc",
 * "npx eslint" -> "rtk lint" diye yeniden yazar ve izin vermez (2026-11-23 olculdu; ilk yerel yonetici
 * calismasinda lint bu yuzden reddedildi). Bu bicimler acikca eklenir.
 */
const GATE = "Bash(npm run *),Bash(npm test*),Bash(npx jest*),Bash(npx tsc*),Bash(npx eslint*)";
const GATE_RTK = "Bash(rtk jest*),Bash(rtk tsc*),Bash(rtk lint*)";

const ROLE_TOOLS = withRtk(`Read,Edit,Write,Glob,Grep,Bash(cd *),Bash(git *),${GATE},Bash(node *)`) + "," + GATE_RTK;

export function startRun(cfg: AgentsConfig, role: string, task: string, send: (e: RunEvent) => void): string {
  const root = requireRepo(cfg);
  if (!ROLE.test(role) || !existsSync(path.join(root, "roller", role, "rol.md"))) throw new Error("Bilinmeyen rol");
  return launch(cfg, role, promptFor(role, task, cfg), { model: modelFor(root, role), allowed: ROLE_TOOLS }, send);
}

// ------------------------------------------------------------------ yerel yonetici (sahip tusu)
/** Yerel yonetici en fazla bu kadar is alir (sahip, 2026-11-23). */
export const LOCAL_MAX_TASKS = 5;
/** Yonetici: alt ajanlari (auto-worker-opus / auto-worker / auto-scout) calistirir, kapiyi kosar, gonderir. */
const MANAGER_TOOLS = withRtk(`Read,Edit,Write,Glob,Grep,Agent,Task,Bash(cd *),Bash(git *),Bash(gh *),${GATE},Bash(node *)`) + "," + GATE_RTK;
/** Asla: build, paket kurma (sahibin calisma kopyasi), zorla gonderme, geri alinamaz git temizligi. */
const MANAGER_DENY = withRtk("Bash(npm run build*),Bash(npm ci*),Bash(npm install*),Bash(npm i *),Bash(git push --force*),Bash(git push -f*),Bash(git reset --hard*),Bash(git clean*),Bash(eas *),Bash(npx eas*)");

export function managerPrompt(cfg: AgentsConfig): string {
  return [
    "You are the manager (roles 11 + 23) of the Basketball APP agent system, started by the owner with the Atölye button on the owner's PC: a LOCAL OWNER RUN. Nobody answers questions during the run; decide by the rules.",
    `Agent repo (your working directory): ${cfg.repoPath}. App repo (the owner's working copy): ${cfg.appPath || "(not set: agent-repo work only)"}.`,
    "0. If roller/manager/durum.json says \"working\" and its last commit is under 3 hours old, another manager run is active: stop at once without changing anything.",
    "1. Run git pull --rebase in both repos. Read ANAYASA.md, playbooks/manager.md, roller/manager/rol.md, roller/manager/defter.md and state.md; in the app repo read CLAUDE.md and RULES.md. Follow playbooks/manager.md as an owner run: skip the idle check and pick up to " + LOCAL_MAX_TASKS + " tasks, one after another. Set your durum.json to working and push at once.",
    "2. Local rules: the app repo is the owner's working copy. Never run npm ci or npm install, never switch branches, never touch files the owner changed but did not commit (check git status first). Gate = npm run typecheck, npm run lint and npm test in the app repo. Push your commits to main (agents) and master (app).",
    "3. You manage, you do not build: delegate code to the auto-worker-opus (Shoot engine, coach), auto-worker (Sonnet) and auto-scout (Haiku) subagents, one at a time, with a tight brief. Google/research work goes to Antigravity as a for: agy ticket in board/inbox (Antigravity runs it on this PC by its own automation; never call agy yourself). Important actions (builds, emails, posts, dependencies, deletions, money, rule files) are never done: file an approval request in approvals/pending/.",
    "4. Commits: named files only, short English 'type(scope): summary', NO AI attribution of any kind. Zero spending (a usage-limit sign means stop). Never print, log or commit a token or secret; never invent facts; never touch other repos, version5 or version2.",
    "5. Always end by updating state.md, roller/manager/durum.json and raporlar/gunluk/<date>.md (say 'local owner run'), pushing both repos, then a short Turkish summary for the owner (max 6 lines): which task went to which agent, what finished, what waits for Antigravity or for the owner.",
  ].join("\n");
}

export function startManager(cfg: AgentsConfig, send: (e: RunEvent) => void): string {
  const root = requireRepo(cfg);
  if (!existsSync(path.join(root, "roller", "manager", "rol.md"))) throw new Error("Yönetici rolü bulunamadı");
  return launch(cfg, "manager", managerPrompt(cfg), { model: "opus", allowed: MANAGER_TOOLS, deny: MANAGER_DENY }, send);
}

type LaunchOpts = { model: string | null; allowed: string; deny?: string };

function launch(cfg: AgentsConfig, role: string, prompt: string, opts: LaunchOpts, send: (e: RunEvent) => void): string {
  const root = requireRepo(cfg);
  loadSavedRuns(root);
  if (current) throw new Error(current.info.role === "manager" ? "Yönetici şu an bu PC'de çalışıyor; bitince yeniden başlatabilirsin." : "Şu an başka bir ajan çalışıyor; işler sırayla yapılır.");
  const id = `r${Date.now().toString(36)}`;
  const info: RunInfo = { id, role, started: Date.now(), events: [] };
  runs.push(info);
  const emit = (kind: RunEvent["kind"], text: string) => {
    const e: RunEvent = { runId: id, role, kind, text: text.slice(0, 500), at: Date.now() };
    info.events.push(e);
    send(e);
  };
  const args = ["-p", "--output-format", "stream-json", "--verbose", "--permission-mode", "acceptEdits", "--allowedTools", opts.allowed];
  if (opts.deny) args.push("--disallowedTools", opts.deny);
  if (opts.model) args.push("--model", opts.model);
  if (cfg.appPath && existsSync(cfg.appPath)) args.push("--add-dir", cfg.appPath);
  // Kabuk kullanilmaz (argumanlar oldugu gibi gider); istem stdin'den verilir.
  // Testte sahte "claude" (ATOLYE_FAKE_CLAUDE=<node betigi>); gercek kotaya dokunmaz
  const fake = process.env.ATOLYE_SMOKE && process.env.ATOLYE_FAKE_CLAUDE;
  const child = fake ? spawn(process.env.ATOLYE_FAKE_NODE || "node", [fake, ...args], { cwd: root, windowsHide: true }) : spawn(claudeBinary(), args, { cwd: root, windowsHide: true });
  current = { info, child };
  emit("start", `${role} başladı`);
  void saveRuns(root);
  let buf = "";
  child.stdout.on("data", (d: Buffer) => {
    buf += d.toString();
    let i: number;
    while ((i = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, i).trim();
      buf = buf.slice(i + 1);
      if (!line) continue;
      try {
        const ev = JSON.parse(line);
        if (ev.type === "assistant") {
          for (const c of ev.message?.content ?? []) {
            if (c.type === "tool_use") {
              const target = String(c.input?.file_path ?? c.input?.pattern ?? c.input?.command ?? c.input?.subagent_type ?? c.input?.description ?? "").split(/\s+/).slice(0, 4).join(" ");
              const desc = c.input?.subagent_type && c.input?.description ? ` (${String(c.input.description).slice(0, 60)})` : "";
              emit("tool", `${c.name} ${target}${desc}`.trim());
            }
          }
        } else if (ev.type === "result") {
          info.summary = String(ev.result ?? "").slice(0, 2000);
          emit("text", info.summary);
        }
      } catch {
        /* stream-json disi satirlar yok sayilir */
      }
    }
  });
  child.stderr.on("data", (d: Buffer) => emit("text", d.toString()));
  child.stdin.end(prompt);
  child.on("error", (e) => emit("text", `Başlatılamadı: ${e.message} (Claude Code kurulu mu?)`));
  child.on("close", (code) => {
    info.ended = Date.now();
    info.ok = code === 0;
    emit("end", code === 0 ? "bitti" : `hata (çıkış ${code})`);
    current = null;
    void saveRuns(root);
  });
  return id;
}
