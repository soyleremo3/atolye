/**
 * Gomulu terminal (VS Code gibi): her sekme bir pty. Profiller sabit bir listeden gelir;
 * renderer yalniz profil adini, klasoru ve kullanicinin yazdiklarini gonderir.
 * Claude Code / Antigravity / Codex: PowerShell icinde o komutla acilir (kapaninca kabuk kalir).
 */
import { existsSync, readdirSync } from "node:fs";
import path from "node:path";
import type { IPty } from "@lydell/node-pty";

export type TermProfile = { id: string; name: string; available: boolean };

type Spec = { file: string; args: string[] };

function which(cands: string[]): string | null {
  for (const c of cands) if (c && existsSync(c)) return c;
  return null;
}

function specs(): Record<string, { name: string; spec: Spec | null }> {
  const home = process.env.USERPROFILE || "";
  const sys = process.env.SystemRoot || "C:\\Windows";
  const ps = which([path.join(process.env.ProgramFiles || "C:\\Program Files", "PowerShell", "7", "pwsh.exe")]) ?? path.join(sys, "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
  const inPs = (cmd: string): Spec => ({ file: ps, args: ["-NoLogo", "-NoExit", "-Command", cmd] });
  const bash = which([path.join(process.env.ProgramFiles || "C:\\Program Files", "Git", "bin", "bash.exe")]);
  const claude = which([path.join(home, ".local", "bin", "claude.exe")]);
  const agy = which([path.join(process.env.LOCALAPPDATA || "", "agy", "bin", "agy.exe")]);
  const codex = which([path.join(process.env.APPDATA || "", "npm", "codex.cmd")]);
  return {
    powershell: { name: "PowerShell", spec: { file: ps, args: ["-NoLogo"] } },
    claude: { name: "Claude Code", spec: claude ? inPs("& '" + claude + "'") : null },
    agy: { name: "Antigravity (agy)", spec: agy ? inPs("& '" + agy + "'") : null },
    codex: { name: "Codex", spec: codex ? inPs("codex") : null },
    bash: { name: "Git Bash", spec: bash ? { file: bash, args: ["--login", "-i"] } : null },
    cmd: { name: "Komut İstemi", spec: { file: path.join(sys, "System32", "cmd.exe"), args: [] } },
  };
}

/** Masaustunde (2 seviye derinlige kadar) .git iceren klasorler: hizli proje secimi icin. */
export function findProjects(home: string, limit = 30): string[] {
  const out: string[] = [];
  const desk = path.join(home, "Desktop");
  const kids = (dir: string): string[] => {
    try {
      return readdirSync(dir, { withFileTypes: true })
        .filter((d) => d.isDirectory() && !d.name.startsWith(".") && d.name !== "node_modules")
        .map((d) => path.join(dir, d.name));
    } catch {
      return [];
    }
  };
  for (const a of kids(desk)) {
    if (out.length >= limit) break;
    if (existsSync(path.join(a, ".git"))) {
      out.push(a);
      continue;
    }
    for (const b of kids(a)) if (out.length < limit && existsSync(path.join(b, ".git"))) out.push(b);
  }
  return out;
}

export function profiles(): TermProfile[] {
  return Object.entries(specs()).map(([id, p]) => ({ id, name: p.name, available: !!p.spec }));
}

const terms = new Map<number, IPty>();
let seq = 0;

export function create(
  profile: string,
  cwd: string,
  cols: number,
  rows: number,
  onData: (id: number, data: string) => void,
  onExit: (id: number, code: number) => void,
): number {
  const p = specs()[profile];
  if (!p?.spec) throw new Error(`Bu terminal bu bilgisayarda bulunamadı: ${profile}`);
  const dir = cwd && existsSync(cwd) ? cwd : process.env.USERPROFILE || process.cwd();
  // pty yerel modulu yalniz gerektiginde yuklenir (uygulama acilisini yavaslatmasin)
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const pty = require("@lydell/node-pty") as typeof import("@lydell/node-pty");
  const term = pty.spawn(p.spec.file, p.spec.args, {
    name: "xterm-256color",
    cols: Math.max(20, Math.min(500, cols | 0)),
    rows: Math.max(5, Math.min(200, rows | 0)),
    cwd: dir,
    env: { ...process.env, TERM_PROGRAM: "Atolye" } as Record<string, string>,
  });
  const id = ++seq;
  terms.set(id, term);
  term.onData((d) => onData(id, d));
  term.onExit(({ exitCode }) => {
    terms.delete(id);
    onExit(id, exitCode);
  });
  return id;
}

export function write(id: number, data: string): void {
  if (typeof data === "string" && data.length < 1_000_000) terms.get(id)?.write(data);
}

export function resize(id: number, cols: number, rows: number): void {
  try {
    terms.get(id)?.resize(Math.max(20, Math.min(500, cols | 0)), Math.max(5, Math.min(200, rows | 0)));
  } catch {
    /* kapanmis olabilir */
  }
}

export function kill(id: number): void {
  terms.get(id)?.kill();
  terms.delete(id);
}

export function killAll(): void {
  for (const t of terms.values()) t.kill();
  terms.clear();
}
