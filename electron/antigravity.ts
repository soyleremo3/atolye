/**
 * Antigravity otomasyonlarinin canli durumu (yalniz okur, hicbir seye yazmaz).
 * Kaynaklar (bu PC, Antigravity'nin kendi dosyalari):
 *  - ~/.gemini/config/sidecars/<ad>/sidecar.json            otomasyonun adi
 *  - ~/.gemini/antigravity/sidecar_data/<ad>/logs/sidecar.log  "Triggering command" + conversationId
 *  - ~/.gemini/antigravity/brain/<id>/.system_generated/logs/transcript.jsonl  sohbetin adimlari
 * Son adim icerikli ve arac cagrisiz bir model yaniti ise is bitmistir; transcript yakin zamanda
 * yazildiysa calisiyordur; hata mesajinda kalip uzun sure sessiz kaldiysa hata vermistir.
 */
import { existsSync, promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

export type AgyRun = {
  sidecar: string;
  name: string;
  state: "running" | "done" | "failed";
  started: string;
  updated: string;
  model: string | null;
  note: string;
};

const MIN = 60_000;
/** Bu kadar sessiz kalan (ve bitmemis) sohbet durmus sayilir. */
const STALL = 10 * MIN;
/** Hata mesajindan sonra Antigravity uzun araliklarla yeniden dener; bu sure dolmadan "hata" denmez. */
const RETRY = 30 * MIN;
/** Daha eski calismalar "calisiyor/hata" olarak gosterilmez. */
const RECENT = 12 * 60 * MIN;

function home(): string | null {
  if (process.env.ATOLYE_AGY_HOME) return process.env.ATOLYE_AGY_HOME;
  if (process.env.ATOLYE_SMOKE) return null; // testlerde gercek Antigravity verisi karismasin
  return path.join(os.homedir(), ".gemini");
}

async function tail(file: string, bytes: number): Promise<string> {
  const h = await fs.open(file, "r").catch(() => null);
  if (!h) return "";
  try {
    const { size } = await h.stat();
    const len = Math.min(size, bytes);
    const buf = Buffer.alloc(len);
    await h.read(buf, 0, len, size - len);
    return buf.toString("utf8");
  } finally {
    await h.close();
  }
}

function errorNote(text: string): string {
  if (/no such host|dial tcp|network|ECONN|timeout/i.test(text)) return "İnternet bağlantısı yoktu";
  if (/429|RESOURCE_EXHAUSTED|quota|rate limit/i.test(text)) return "Model limiti doldu";
  return "Hata verdi";
}

type Step = { source?: string; type?: string; status?: string; created_at?: string; model?: string; content?: string; tool_calls?: unknown; error?: string };

/** Son 12 saatte yazilmis sohbetler: id -> ilk mesaj (istem) ve baslama zamani. Bir kez okunur, tum otomasyonlar paylasir. */
type Conv = { id: string; prompt: string; started: number };
async function recentConversations(root: string, now: number): Promise<Conv[]> {
  const dir = path.join(root, "antigravity", "brain");
  const ids = await fs.readdir(dir).catch(() => [] as string[]);
  const out: Conv[] = [];
  await Promise.all(ids.map(async (id) => {
    const file = path.join(dir, id, ".system_generated", "logs", "transcript.jsonl");
    const st = await fs.stat(file).catch(() => null);
    if (!st || now - st.mtimeMs > RECENT) return;
    const h = await fs.open(file, "r").catch(() => null);
    if (!h) return;
    try {
      const buf = Buffer.alloc(16 * 1024);
      const { bytesRead } = await h.read(buf, 0, buf.length, 0);
      const first = JSON.parse(buf.subarray(0, bytesRead).toString("utf8").split("\n")[0]) as Step;
      if (first.type !== "USER_INPUT") return;
      out.push({ id, prompt: norm(first.content ?? ""), started: new Date(first.created_at ?? st.mtimeMs).getTime() });
    } catch {
      /* okunamayan sohbet */
    } finally {
      await h.close();
    }
  }));
  return out;
}

/** Karsilastirma icin: <USER_REQUEST> sarmalayicisi ve bosluk farklari atilir, ilk 160 karakter. */
const norm = (t: string) => t.replace(/<\/?USER_REQUEST>/g, "").replace(/\s+/g, " ").trim().slice(0, 160);

/**
 * Bir otomasyonun en son calismasi. Iki kaynak: zamanlayici kaydi (sidecar.log "Triggering command")
 * ve sohbetin ilk mesaji: Antigravity'de "Run Now" ya da Atolye'nin "simdi calistir" istegiyle baslayan
 * isler zamanlayici kaydina dusmez, ama ilk mesaj otomasyonun istemiyle aynidir.
 */
async function one(root: string, sidecar: string, now: number, convs: Conv[]): Promise<AgyRun | null> {
  const cfg = JSON.parse(await fs.readFile(path.join(root, "config", "sidecars", sidecar, "sidecar.json"), "utf8").catch(() => "{}")) as { display_name?: string; args?: string[] };
  const args = cfg.args ?? [];
  const prompt = norm(args[args.length - 1] ?? "");
  const cfgModel = args.map((x) => /^--model=(\S+)$/.exec(x)?.[1]).find(Boolean) ?? null;
  const log = await tail(path.join(root, "antigravity", "sidecar_data", sidecar, "logs", "sidecar.log"), 64 * 1024);
  const trig = [...log.matchAll(/^(\d{4}-\d\d-\d\d \d\d:\d\d:\d\d) \[schedule\] Triggering command: "agentapi" \[([^\n]*)/gm)].pop();
  let started = trig ? new Date(trig[1].replace(" ", "T") + "Z") : null;
  if (started && Number.isNaN(started.getTime())) started = null;
  let conv = trig ? /"conversationId":\s*"([0-9a-f-]{36})"/.exec(log.slice((trig.index ?? 0) + trig[0].length))?.[1] : undefined;
  let model = trig ? /--model=(\S+)/.exec(trig[2])?.[1] ?? null : cfgModel;
  // ilk mesaji bu otomasyonun istemi olan daha yeni bir sohbet varsa (Run Now) o gecerli
  const match = prompt.length > 40 ? convs.filter((c) => c.prompt === prompt).sort((x, y) => y.started - x.started)[0] : undefined;
  if (match && (!started || match.started > started.getTime() + 60_000)) {
    conv = match.id;
    started = new Date(match.started);
    model = cfgModel;
  }
  if (!started) return null;
  const base = { sidecar, name: cfg.display_name || sidecar, started: started.toISOString(), model };
  const age = now - started.getTime();
  if (!conv) return age < 5 * MIN ? { ...base, state: "running", updated: base.started, note: "Başlıyor" } : null;

  const file = path.join(root, "antigravity", "brain", conv, ".system_generated", "logs", "transcript.jsonl");
  const st = await fs.stat(file).catch(() => null);
  if (!st) return age < 5 * MIN ? { ...base, state: "running", updated: base.started, note: "Başlıyor" } : null;
  const lines = (await tail(file, 256 * 1024)).trim().split("\n");
  let last: Step | null = null;
  let steps = 0;
  for (const l of lines) {
    try {
      const j = JSON.parse(l) as Step;
      last = j;
      steps++;
    } catch {
      /* kesik ilk satir */
    }
  }
  const updated = new Date(st.mtimeMs).toISOString();
  const idle = now - st.mtimeMs;
  const usedModel = lines.map((l) => /"model":"([^"]+)"/.exec(l)?.[1]).filter(Boolean).pop() ?? model;
  const out = { ...base, model: usedModel, updated };
  if (last?.type === "PLANNER_RESPONSE" && last.content && !last.tool_calls) return { ...out, state: "done", note: "Bitti" };
  if (age > RECENT) return null;
  if (last?.type === "ERROR_MESSAGE") {
    return idle < RETRY ? { ...out, state: "running", note: `${errorNote(last.error ?? "")}; yeniden deniyor` } : { ...out, state: "failed", note: errorNote(last.error ?? "") };
  }
  if (idle < STALL) return { ...out, state: "running", note: `${steps} adım` };
  return { ...out, state: "failed", note: "Yarıda kaldı" };
}

type ScheduleRobot = { id: string; sidecar?: string; roles?: string[] };

/** schedule.json'daki robot -> o an calisan Antigravity isi (yalniz sidecar'i olanlar). */
export async function robotRuns(repo: string, runs?: Record<string, AgyRun>): Promise<Record<string, AgyRun>> {
  const all = runs ?? (await agyRuns());
  const list = (JSON.parse(await fs.readFile(path.join(repo, "schedule.json"), "utf8").catch(() => "{}")) as { robots?: ScheduleRobot[] }).robots ?? [];
  const out: Record<string, AgyRun> = {};
  for (const r of list) if (r.sidecar && all[r.sidecar]) out[r.id] = all[r.sidecar];
  return out;
}

/** board/doing'deki "for: agy" biletlerinin rolleri (gorev alici hangi rol icin calisiyor). */
async function doingRoles(repo: string): Promise<string[]> {
  const dir = path.join(repo, "board", "doing");
  const names = (await fs.readdir(dir).catch(() => [] as string[])).filter((n) => n.endsWith(".md"));
  const roles: string[] = [];
  for (const n of names) {
    const head = (await fs.readFile(path.join(dir, n), "utf8").catch(() => "")).split(/\r?\n---/)[0];
    if (!/^for:\s*agy\s*$/m.test(head)) continue;
    const role = /^role:\s*([a-z0-9-]+)\s*$/m.exec(head)?.[1];
    if (role) roles.push(role);
  }
  return roles;
}

/** Su an calisan Antigravity islerinin ofisteki rolleri: rol id -> calisma. */
export async function runningRoles(repo: string): Promise<Record<string, AgyRun>> {
  const all = await agyRuns();
  if (!Object.values(all).some((r) => r.state === "running")) return {};
  const list = (JSON.parse(await fs.readFile(path.join(repo, "schedule.json"), "utf8").catch(() => "{}")) as { robots?: ScheduleRobot[] }).robots ?? [];
  const out: Record<string, AgyRun> = {};
  for (const r of list) {
    const run = r.sidecar ? all[r.sidecar] : undefined;
    if (run?.state !== "running") continue;
    for (const role of r.roles ?? []) {
      if (role === "doing") for (const d of await doingRoles(repo)) out[d] = run;
      else out[role] = run;
    }
  }
  return out;
}

/** Her otomasyonun son calismasi, sidecar adina gore. Antigravity yoksa bos. */
export async function agyRuns(now = Date.now()): Promise<Record<string, AgyRun>> {
  const root = home();
  if (!root) return {};
  const dir = path.join(root, "config", "sidecars");
  if (!existsSync(dir)) return {};
  const names = (await fs.readdir(dir, { withFileTypes: true }).catch(() => [])).filter((d) => d.isDirectory()).map((d) => d.name);
  const out: Record<string, AgyRun> = {};
  const convs = await recentConversations(root, now);
  await Promise.all(names.map(async (n) => {
    const r = await one(root, n, now, convs).catch(() => null);
    if (r) out[n] = r;
  }));
  return out;
}
