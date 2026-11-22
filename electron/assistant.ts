/**
 * Not asistani: sahibin notlarini bir Claude modeli SADECE OKUYARAK yanitlar (claude -p, Pro abonelik).
 * Araclar yalniz Read/Glob/Grep; dosya degistiremez, komut calistiramaz. Istem stdin'den gider.
 */
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { existsSync } from "node:fs";
import { claudeBinary } from "./agents";

export type AskEvent = { askId: string; kind: "step" | "answer" | "end" | "error"; text: string };

let current: { id: string; child: ChildProcessWithoutNullStreams } | null = null;
const MODELS = new Set(["haiku", "sonnet", "opus"]);

function promptFor(question: string, scopeLabel: string): string {
  return [
    `You are the owner's notes assistant inside the Atölye app. The folder you can read holds the owner's notes (${scopeLabel}).`,
    "Use only Read, Glob and Grep to look at Markdown notes there. Never invent facts: if the notes do not say it, say so.",
    "Answer in Turkish, short and clear, with bullet points where useful. After the answer add a line 'Kaynak notlar:' with the note file names you used.",
    `Owner's request: ${question.trim()}`,
  ].join("\n");
}

export function ask(question: string, dir: string, scopeLabel: string, model: string, send: (e: AskEvent) => void): string {
  if (current) throw new Error("Asistan şu an başka bir soruyu yanıtlıyor.");
  if (!question.trim()) throw new Error("Soru boş olamaz");
  if (!dir || !existsSync(dir)) throw new Error("Not klasörü bulunamadı");
  const id = `a${Date.now().toString(36)}`;
  const args = ["-p", "--output-format", "stream-json", "--verbose", "--allowedTools", "Read,Glob,Grep", "--add-dir", dir];
  if (MODELS.has(model)) args.push("--model", model);
  const child = spawn(claudeBinary(), args, { cwd: dir, windowsHide: true });
  current = { id, child };
  const emit = (kind: AskEvent["kind"], text: string) => send({ askId: id, kind, text });
  let buf = "";
  let answered = false;
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
            if (c.type === "tool_use") emit("step", `${c.name} ${String(c.input?.pattern ?? c.input?.file_path ?? "").split(/[\\/]/).pop()}`);
          }
        } else if (ev.type === "result") {
          answered = true;
          emit(ev.is_error ? "error" : "answer", String(ev.result ?? ""));
        }
      } catch {
        /* stream-json disi satir */
      }
    }
  });
  child.stderr.on("data", (d: Buffer) => emit("step", d.toString().slice(0, 300)));
  child.stdin.end(promptFor(question, scopeLabel));
  child.on("error", (e) => emit("error", `Claude Code başlatılamadı: ${e.message}`));
  child.on("close", (code) => {
    if (!answered) emit("error", `Yanıt alınamadı (çıkış ${code}). İnternet ya da Claude Pro limiti olabilir.`);
    emit("end", "");
    current = null;
  });
  return id;
}

export function stop(): boolean {
  if (!current) return false;
  current.child.kill();
  return true;
}
