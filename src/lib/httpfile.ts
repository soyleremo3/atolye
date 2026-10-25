/**
 * .http dosyalari (VS Code REST Client / JetBrains HTTP Client ile uyumlu sade alt kume).
 *
 *   @baseUrl = https://api.example.com
 *
 *   ### Kullanicilari getir
 *   GET {{baseUrl}}/users?page=1
 *   Accept: application/json
 *
 *   {"govde": "bos satirdan sonra"}
 */
export type HttpReq = { id: string; name: string; method: string; url: string; headers: [string, string][]; body: string };
export type HttpFile = { vars: [string, string][]; requests: HttpReq[] };

export const METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"];
let seq = 0;
export const newId = () => `r${++seq}`;

export function parseHttp(src: string): HttpFile {
  const vars: [string, string][] = [];
  const requests: HttpReq[] = [];
  const blocks: { name: string; lines: string[] }[] = [];
  let cur: { name: string; lines: string[] } | null = null;
  for (const line of src.replace(/\r\n/g, "\n").split("\n")) {
    const sep = line.match(/^###\s*(.*)$/);
    if (sep) {
      cur = { name: sep[1].trim(), lines: [] };
      blocks.push(cur);
      continue;
    }
    const v = line.match(/^@([\w.-]+)\s*=\s*(.*)$/);
    if (v && (!cur || cur.lines.every((l) => !l.trim() || isComment(l)))) {
      vars.push([v[1], v[2].trim()]);
      continue;
    }
    if (!cur) {
      if (!line.trim() || isComment(line)) continue;
      cur = { name: "", lines: [] };
      blocks.push(cur);
    }
    cur.lines.push(line);
  }
  for (const b of blocks) {
    const lines = [...b.lines];
    while (lines.length && (!lines[0].trim() || isComment(lines[0]))) lines.shift();
    if (!lines.length) continue;
    const first = lines.shift()!.trim();
    const m = first.match(/^([A-Za-z]+)\s+(\S+)(?:\s+HTTP\/[\d.]+)?$/);
    const method = m && METHODS.includes(m[1].toUpperCase()) ? m[1].toUpperCase() : "GET";
    const url = m && METHODS.includes(m[1].toUpperCase()) ? m[2] : first.split(/\s+/)[0];
    const headers: [string, string][] = [];
    while (lines.length && lines[0].trim()) {
      const l = lines.shift()!;
      if (isComment(l)) continue;
      const i = l.indexOf(":");
      if (i > 0) headers.push([l.slice(0, i).trim(), l.slice(i + 1).trim()]);
    }
    const body = lines.join("\n").replace(/^\n+/, "").replace(/\s+$/, "");
    requests.push({ id: newId(), name: b.name || `${method} ${url}`, method, url, headers, body });
  }
  return { vars, requests };
}

const isComment = (l: string) => /^\s*(#(?!##)|\/\/)/.test(l);

export function serializeHttp(f: HttpFile): string {
  const out: string[] = [];
  if (f.vars.length) out.push(f.vars.map(([k, v]) => `@${k} = ${v}`).join("\n"), "");
  for (const r of f.requests) {
    out.push(`### ${r.name}`);
    out.push(`${r.method} ${r.url}`);
    for (const [k, v] of r.headers) if (k.trim()) out.push(`${k}: ${v}`);
    if (r.body.trim()) out.push("", r.body);
    out.push("");
  }
  return out.join("\n").replace(/\n{3,}/g, "\n\n").trimEnd() + "\n";
}

/** {{degisken}} yerlestirme (bilinmeyenler oldugu gibi kalir). */
export function applyVars(text: string, vars: [string, string][]): string {
  const map = new Map(vars);
  for (let i = 0; i < 5; i++) {
    const next = text.replace(/\{\{\s*([\w.-]+)\s*\}\}/g, (all, k: string) => map.get(k) ?? all);
    if (next === text) break;
    text = next;
  }
  return text;
}

export function toCurl(r: HttpReq, vars: [string, string][]): string {
  const q = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`;
  const parts = [`curl -X ${r.method} ${q(applyVars(r.url, vars))}`];
  for (const [k, v] of r.headers) if (k.trim()) parts.push(`-H ${q(`${k}: ${applyVars(v, vars)}`)}`);
  if (r.body.trim()) parts.push(`--data-raw ${q(applyVars(r.body, vars))}`);
  return parts.join(" \\\n  ");
}
