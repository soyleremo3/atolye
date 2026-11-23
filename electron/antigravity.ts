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

async function one(root: string, sidecar: string, now: number): Promise<AgyRun | null> {
  const cfg = JSON.parse(await fs.readFile(path.join(root, "config", "sidecars", sidecar, "sidecar.json"), "utf8").catch(() => "{}")) as { display_name?: string };
  const log = await tail(path.join(root, "antigravity", "sidecar_data", sidecar, "logs", "sidecar.log"), 64 * 1024);
  const trig = [...log.matchAll(/^(\d{4}-\d\d-\d\d \d\d:\d\d:\d\d) \[schedule\] Triggering command: "agentapi" \[([^\n]*)/gm)].pop();
  if (!trig) return null;
  const started = new Date(trig[1].replace(" ", "T") + "Z");
  if (Number.isNaN(started.getTime())) return null;
  const model = /--model=(\S+)/.exec(trig[2])?.[1] ?? null;
  const conv = /"conversationId":\s*"([0-9a-f-]{36})"/.exec(log.slice((trig.index ?? 0) + trig[0].length))?.[1];
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
  await Promise.all(names.map(async (n) => {
    const r = await one(root, n, now).catch(() => null);
    if (r) out[n] = r;
  }));
  return out;
}
