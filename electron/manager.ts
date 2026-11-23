/**
 * "Yoneticiyi calistir" tusu: buluttaki Claude yonetici rutinini sahibin istegiyle hemen baslatir.
 * Resmi uc: POST https://api.anthropic.com/v1/claude_code/routines/{trig_...}/fire
 * (code.claude.com/docs/en/routines.md, platform.claude.com/docs/en/api/claude-code/routines-fire.md).
 *  - Anahtar: rutine ozel `sk-ant-oat01-...` (claude.ai'de sahip olusturur). Windows DPAPI ile sifreli
 *    (safeStorage) userData'da durur; arayuze, repoya ya da kayda asla yazilmaz.
 *  - Govde `text`: yalniz bir mod isareti. Rutin istemi bunu "sahip calistirmasi, en fazla 5 is" diye okur;
 *    metin talimat olarak kullanilmaz.
 *  - Ucret yok: calisma Claude Pro abonelik kullanimindan duser; saatte 30 tetikleme siniri var.
 *  - Cift calisma onlenir: yonetici zaten calisiyorsa ya da az once baslatildiysa tus calismaz.
 */
import { app, safeStorage } from "electron";
import { existsSync, promises as fs } from "node:fs";
import path from "node:path";
import { readJson, requireRepo, type AgentsConfig } from "./agents";

export const MAX_TASKS = 5;
/** Rutin istemi bu satiri arar (playbooks/manager.md "Owner run"). */
export const OWNER_FLAG = "atolye-owner-run";
const TOKEN_RE = /^sk-ant-oat01-[A-Za-z0-9_-]{20,}$/;
const ROUTINE_RE = /^trig_[A-Za-z0-9]{10,}$/;
/** Bir calisma en cok bu kadar surer sayilir (sonra yeniden basilabilir). */
const RUN_WINDOW = 3 * 60 * 60_000;
/** Ust uste basmayi onler (yonetici durumunu buluta yazana kadar). */
const COOLDOWN = 10 * 60_000;

export type ManagerFire = { at: string; url: string };
export type ManagerStatus = {
  hasToken: boolean;
  canEncrypt: boolean;
  routine: string | null;
  last: ManagerFire | null;
  /** idle: basilabilir; starting: az once baslatildi; running: yonetici calisiyor; done: son sahip calismasi bitti */
  phase: "idle" | "starting" | "running" | "done";
  managerState: string | null;
  managerDid: string;
  managerLastRun: string | null;
};

const dir = () => app.getPath("userData");
const tokenFile = () => path.join(dir(), "manager-token.bin");
const lastFile = () => path.join(dir(), "manager-run.json");

export function canEncrypt(): boolean {
  try {
    return safeStorage.isEncryptionAvailable();
  } catch {
    return false;
  }
}

export async function saveToken(raw: string): Promise<void> {
  const t = String(raw ?? "").trim();
  if (!TOKEN_RE.test(t)) throw new Error("Bu bir rutin anahtarı değil (sk-ant-oat01- ile başlamalı).");
  if (!canEncrypt()) throw new Error("Windows şifreli depo kullanılamıyor; anahtar kaydedilmedi.");
  await fs.writeFile(tokenFile(), safeStorage.encryptString(t));
}

export async function clearToken(): Promise<void> {
  await fs.rm(tokenFile(), { force: true });
}

async function readToken(): Promise<string | null> {
  if (!existsSync(tokenFile()) || !canEncrypt()) return null;
  try {
    return safeStorage.decryptString(await fs.readFile(tokenFile()));
  } catch {
    return null;
  }
}

async function routineId(root: string): Promise<string | null> {
  const s = await readJson<{ robots?: { id: string; routine?: string }[] }>(path.join(root, "schedule.json"), {});
  const id = s.robots?.find((r) => r.id === "manager")?.routine ?? null;
  return id && ROUTINE_RE.test(id) ? id : null;
}

export async function status(cfg: AgentsConfig): Promise<ManagerStatus> {
  const root = requireRepo(cfg);
  const durum = path.join(root, "roller", "manager", "durum.json");
  const live = await readJson<{ state?: string; did?: string; lastRun?: string | null } | null>(durum, null);
  // "working" basta yazilir ama baslama zamani yok: dosyanin bu PC'ye gelis zamani (en cok 3 dk gec) kullanilir
  const changed = (await fs.stat(durum).catch(() => null))?.mtimeMs ?? 0;
  const last = await readJson<ManagerFire | null>(lastFile(), null);
  const now = Date.now();
  let phase: ManagerStatus["phase"] = "idle";
  const firedAt = last ? new Date(last.at).getTime() : 0;
  const finishedAfter = !!live?.lastRun && new Date(live.lastRun).getTime() > firedAt;
  if (live?.state === "working" && now - changed < RUN_WINDOW) phase = "running";
  else if (last && now - firedAt < RUN_WINDOW) phase = finishedAfter ? "done" : now - firedAt < COOLDOWN ? "starting" : "running";
  else if (last && finishedAfter) phase = "done";
  return {
    hasToken: existsSync(tokenFile()),
    canEncrypt: canEncrypt(),
    routine: await routineId(root),
    last,
    phase,
    managerState: live?.state ?? null,
    managerDid: live?.did ?? "",
    managerLastRun: live?.lastRun ?? null,
  };
}

function endpoint(id: string): string {
  // Test icin yerel sahte sunucu (yalniz ATOLYE_SMOKE ile)
  const base = process.env.ATOLYE_SMOKE && process.env.ATOLYE_FIRE_URL ? process.env.ATOLYE_FIRE_URL : "https://api.anthropic.com";
  return `${base}/v1/claude_code/routines/${id}/fire`;
}

/** Yoneticiyi bulutta baslatir. Hata mesajlari sahibe gosterilecek Turkce metinlerdir. */
export async function fire(cfg: AgentsConfig, beforeFire?: () => Promise<unknown>): Promise<ManagerFire> {
  const st = await status(cfg);
  if (st.phase === "running" || st.phase === "starting") throw new Error("Yönetici zaten çalışıyor; bitince yeniden basabilirsin.");
  const id = st.routine;
  if (!id) throw new Error("Yönetici rutini schedule.json'da bulunamadı.");
  const token = await readToken();
  if (!token) throw new Error("Önce yönetici anahtarını kaydet (Merkez → Yönetici).");
  // Bu PC'deki son Antigravity sonuclari once buluta gitsin ki yonetici onlari da gorsun
  if (beforeFire) await beforeFire().catch(() => undefined);
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 30_000);
  let res: Response;
  try {
    res = await fetch(endpoint(id), {
      method: "POST",
      signal: ctrl.signal,
      headers: {
        Authorization: `Bearer ${token}`,
        "anthropic-version": "2023-06-01",
        "anthropic-beta": "experimental-cc-routine-2026-04-01",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ text: `${OWNER_FLAG}\nmax_tasks: ${MAX_TASKS}` }),
    });
  } catch {
    throw new Error("İnternet yok ya da Claude'a ulaşılamadı; yönetici başlatılmadı.");
  } finally {
    clearTimeout(timer);
  }
  if (!res.ok) {
    const wait = Number(res.headers.get("retry-after")) || 0;
    const msg: Record<number, string> = {
      400: "Rutin durdurulmuş ya da istek reddedildi (claude.ai → Rutinler'den kontrol et).",
      401: "Anahtar geçersiz ya da yenilenmiş; claude.ai'de yeni anahtar oluşturup kaydet.",
      403: "Bu anahtarın yetkisi yok; yeni anahtar oluştur.",
      404: "Yönetici rutini bulunamadı.",
      429: `Saatlik sınır doldu${wait ? `; ${Math.ceil(wait / 60)} dk sonra yeniden dene` : ""}.`,
    };
    throw new Error(msg[res.status] ?? `Claude şu an yanıt vermiyor (${res.status}); biraz sonra yeniden dene.`);
  }
  const body = (await res.json().catch(() => ({}))) as { claude_code_session_url?: string };
  const url = /^https:\/\/claude\.ai\/code\/[A-Za-z0-9_-]+$/.test(body.claude_code_session_url ?? "") ? body.claude_code_session_url! : "";
  const out: ManagerFire = { at: new Date().toISOString(), url };
  await fs.writeFile(lastFile(), JSON.stringify(out), "utf8");
  return out;
}
