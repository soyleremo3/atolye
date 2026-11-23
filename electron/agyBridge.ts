/**
 * Atolye -> Antigravity "simdi calistir" koprusu (hesap icin guvenli yol).
 *
 * Atolye Antigravity'yi ASLA kendisi calistirmaz (Antigravity SSS: agy'yi baska bir uygulamanin icinden
 * calistirmak tuketici planlarinda desteklenmiyor). Bunun yerine:
 *  1. Atolye ajan reposuna kucuk bir istek dosyasi yazar: .atolye/agy-now.json {id, which, at}.
 *  2. Antigravity'nin KENDI zamanlayicisi (belgelenmis "schedule" otomasyonu, sahip Automations
 *     sekmesinden acar) dakikada bir kucuk bir node betigi calistirir. Istek yoksa hicbir sey yapmaz,
 *     model kullanmaz. Istek varsa secilen otomasyonun (yalniz bilinen 4'u) kendi istemi ve modeliyle
 *     Antigravity'nin kendi araci `agentapi new-conversation` ile isi baslatir; sonucu
 *     .atolye/agy-now-result.json'a yazar.
 * Istem ve model her zaman o otomasyonun sidecar.json'undan okunur: istek dosyasi istem tasiyamaz.
 */
import { existsSync, promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { agyRuns } from "./antigravity";

export const BRIDGE_ID = "atolye-now";
export const BRIDGE_TARGETS = ["google-task-taker", "critic", "media-prompts", "news-and-learning"] as const;
export type BridgeTarget = (typeof BRIDGE_TARGETS)[number];
/** Antigravity kapaliyken basilan istek, sonradan acilinca beklenmedik is baslatmasin. */
const STALE_MIN = 10;

export type BridgeStatus = {
  installed: boolean;
  enabled: boolean;
  request: { id: string; which: string; at: string } | null;
  result: { id: string; which: string; at: string; ok: boolean; state?: string; error?: string; conversationId?: string } | null;
};

function agyHome(): string {
  return process.env.ATOLYE_AGY_HOME || path.join(os.homedir(), ".gemini");
}
const bridgeDir = () => path.join(agyHome(), "config", "sidecars", BRIDGE_ID);
const reqFile = (repo: string) => path.join(repo, ".atolye", "agy-now.json");
const resFile = (repo: string) => path.join(repo, ".atolye", "agy-now-result.json");

async function readJson<T>(file: string): Promise<T | null> {
  try {
    return JSON.parse(await fs.readFile(file, "utf8")) as T;
  } catch {
    return null;
  }
}

/** Antigravity'nin zamanlayicisinin dakikada bir calistirdigi betik (CommonJS, bagimlilik yok). */
export const BRIDGE_SCRIPT = `// Atolye -> Antigravity koprusu. Antigravity'nin zamanlayicisi dakikada bir calistirir.
// Istek yoksa hicbir sey yapmaz (model kullanmaz). Yalniz bilinen 4 otomasyonu, KENDI istemi ve modeliyle baslatir.
"use strict";
const fs = require("fs");
const path = require("path");
const os = require("os");
const { spawnSync } = require("child_process");
const REPO = process.argv[2];
const ALLOWED = ${JSON.stringify(BRIDGE_TARGETS)};
const STALE_MS = ${STALE_MIN} * 60 * 1000;
const read = (f) => { try { return JSON.parse(fs.readFileSync(f, "utf8")); } catch { return null; } };
const reqF = path.join(REPO, ".atolye", "agy-now.json");
const resF = path.join(REPO, ".atolye", "agy-now-result.json");
const r = read(reqF);
if (!r || !r.id) process.exit(0);
const prev = read(resF);
if (prev && prev.id === r.id) process.exit(0);
const write = (o) => fs.writeFileSync(resF, JSON.stringify(Object.assign({ id: r.id, which: r.which, at: new Date().toISOString() }, o)));
if (!ALLOWED.includes(r.which)) { write({ ok: false, error: "Bilinmeyen otomasyon" }); process.exit(0); }
if (!(Date.now() - new Date(r.at).getTime() < STALE_MS)) { write({ ok: false, error: "İstek eskidi (Antigravity kapalıydı); yeniden bas" }); process.exit(0); }
const home = process.env.ATOLYE_AGY_HOME || path.join(os.homedir(), ".gemini");
const sc = read(path.join(home, "config", "sidecars", r.which, "sidecar.json"));
const args = (sc && sc.args) || [];
const i = args.indexOf("new-conversation");
if (i < 0) { write({ ok: false, error: "Otomasyon ayarı okunamadı" }); process.exit(0); }
write({ ok: true, state: "starting" }); // ayni istek ikinci kez baslamasin
const exe = process.env.ATOLYE_AGENTAPI_EXE || path.join(process.env.LOCALAPPDATA || "", "Programs", "Antigravity", "resources", "bin", "language_server.exe");
const out = spawnSync(exe, ["agentapi"].concat(args.slice(i)), { encoding: "utf8", timeout: 120000, windowsHide: true });
const m = /"conversationId":\\s*"([0-9a-f-]{36})"/.exec(String(out.stdout || ""));
if (m) write({ ok: true, state: "started", conversationId: m[1] });
else write({ ok: false, error: ("Antigravity işi başlatamadı: " + String(out.stderr || out.stdout || (out.error && out.error.message) || "")).slice(0, 300) });
`;

const fwd = (p: string) => p.replace(/\\/g, "/").replace(/^([A-Za-z]):/, (_m, d: string) => `${d.toLowerCase()}:`);

/** sidecar.json: belgelenmis "schedule" otomasyonu; Automations sekmesinde "Paused" olarak gorunur, sahip acar. */
export function bridgeSidecar(repo: string, nodeExe: string): unknown {
  return {
    builtin: "schedule",
    args: ["CRON_TZ=Europe/Istanbul * * * * *", nodeExe, path.join(bridgeDir(), "atolye-now.cjs"), repo],
    restart_policy: "always",
    display_name: "Atölye: şimdi çalıştır",
    description: "Dakikada bir Atölye'nin isteğine bakar. İstek yoksa hiçbir şey yapmaz ve model kullanmaz. İstek varsa seçilen otomasyonu (görev alıcı, eleştirmen, medya, haberler) kendi istemi ve modeliyle hemen başlatır.",
    agent_permissions: {
      workspace_uris: [`file:///${repo.replace(/\\/g, "/").replace(/^\/+/, "").split("/").map(encodeURIComponent).join("/").replace(/^([A-Za-z])%3A/, (_m, d: string) => `${d.toLowerCase()}:`)}`],
      // diger otomasyonlarla ayni bicim: kucuk surucu harfi, egik cizgi
      access_grants: [`read_file(${fwd(repo)})`, `write_file(${fwd(repo)})`],
    },
  };
}

/** node.exe yolu (Antigravity'nin zamanlayicisi PATH'e guvenmesin diye tam yol). */
function nodeExe(): string {
  const candidates = [path.join(process.env.ProgramFiles || "C:\\Program Files", "nodejs", "node.exe"), path.join(process.env.LOCALAPPDATA || "", "Programs", "nodejs", "node.exe")];
  return candidates.find((c) => existsSync(c)) ?? "node";
}

/** Kopruyu kurar ya da gunceller (Antigravity'de AcIK hale getirmez; bunu sahip yapar). */
export async function installBridge(repo: string): Promise<void> {
  await fs.mkdir(bridgeDir(), { recursive: true });
  await fs.writeFile(path.join(bridgeDir(), "atolye-now.cjs"), BRIDGE_SCRIPT, "utf8");
  await fs.writeFile(path.join(bridgeDir(), "sidecar.json"), JSON.stringify(bridgeSidecar(repo, nodeExe()), null, 2) + "\n", "utf8");
  await fs.mkdir(path.join(repo, ".atolye"), { recursive: true });
}

export async function bridgeStatus(repo: string): Promise<BridgeStatus> {
  const cfg = await readJson<{ sidecars?: Record<string, { enabled?: boolean }> }>(path.join(agyHome(), "config", "config.json"));
  return {
    installed: existsSync(path.join(bridgeDir(), "sidecar.json")) && existsSync(path.join(bridgeDir(), "atolye-now.cjs")),
    enabled: !!cfg?.sidecars?.[BRIDGE_ID]?.enabled,
    request: await readJson(reqFile(repo)),
    result: await readJson(resFile(repo)),
  };
}

/** Sahibin "simdi calistir" istegi: yalniz istek dosyasi yazilir; isi Antigravity'nin kendisi baslatir. */
export async function requestRun(repo: string, which: string): Promise<BridgeStatus> {
  if (!(BRIDGE_TARGETS as readonly string[]).includes(which)) throw new Error("Bilinmeyen Antigravity otomasyonu");
  const st = await bridgeStatus(repo);
  if (!st.installed) throw new Error("Antigravity köprüsü kurulu değil (Merkez → Robotlar → Köprüyü kur).");
  if (!st.enabled) throw new Error("Antigravity'de 'Atölye: şimdi çalıştır' otomasyonu kapalı: Antigravity → Automations → Paused → aç.");
  if (st.request && (!st.result || st.result.id !== st.request.id) && Date.now() - new Date(st.request.at).getTime() < STALE_MIN * 60_000) {
    throw new Error("Önceki istek henüz Antigravity'ye ulaşmadı; bir dakika bekle (Antigravity açık mı?).");
  }
  const runs = await agyRuns();
  if (runs[which]?.state === "running") throw new Error("Bu Antigravity işi zaten çalışıyor.");
  await fs.mkdir(path.join(repo, ".atolye"), { recursive: true });
  const request = { id: `q${Date.now().toString(36)}`, which, at: new Date().toISOString() };
  await fs.writeFile(reqFile(repo), JSON.stringify(request), "utf8");
  return { ...st, request };
}
