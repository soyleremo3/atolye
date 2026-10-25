/** Cevrimdisi gelistirici araclari: hepsi tarayici icinde, veri hicbir yere gonderilmez. */
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { diffLines, diffWordsWithSpace } from "diff";
import { Copy } from "lucide-react";
import { toast } from "../store";
import { CodeEditor } from "./CodeEditor";

type ToolId = "json" | "base64" | "url" | "jwt" | "uuid" | "hash" | "time" | "regex" | "diff" | "color" | "base" | "text";
const TOOLS: { id: ToolId; name: string; hint: string }[] = [
  { id: "json", name: "JSON", hint: "biçimlendir · sıkıştır · doğrula" },
  { id: "diff", name: "Karşılaştır", hint: "iki metin arasındaki fark" },
  { id: "regex", name: "Regex", hint: "desen dene, eşleşmeleri gör" },
  { id: "jwt", name: "JWT", hint: "token çöz" },
  { id: "base64", name: "Base64", hint: "kodla · çöz" },
  { id: "url", name: "URL", hint: "kodla · çöz · parçala" },
  { id: "time", name: "Zaman damgası", hint: "Unix ↔ tarih" },
  { id: "uuid", name: "UUID", hint: "rastgele kimlik üret" },
  { id: "hash", name: "Hash", hint: "SHA-1 / 256 / 384 / 512" },
  { id: "base", name: "Sayı tabanı", hint: "onluk · onaltılık · ikilik" },
  { id: "color", name: "Renk", hint: "HEX · RGB · HSL" },
  { id: "text", name: "Metin", hint: "camelCase, snake_case, sırala…" },
];

const copy = (t: string) => void navigator.clipboard.writeText(t).then(() => toast("Kopyalandı"));
const CopyBtn = ({ text }: { text: string }) => (
  <button className="icon-btn" title="Kopyala" onClick={() => copy(text)} disabled={!text}><Copy size={14} /></button>
);
const Out = ({ label, value }: { label: string; value: string }) => (
  <div className="out-row">
    <span className="out-label">{label}</span>
    <code className="out-value">{value || "—"}</code>
    <CopyBtn text={value} />
  </div>
);

function utf8ToB64(s: string): string {
  const bytes = new TextEncoder().encode(s);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}
function b64ToUtf8(s: string): string {
  const clean = s.trim().replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(clean + "===".slice((clean.length + 3) % 4));
  return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
}

// ---------------------------------------------------------------- araclar
function JsonTool() {
  const [src, setSrc] = useState('{"ad":"Atölye","sürüm":1,"özellikler":["notlar","parçalar","http"]}');
  const [out, setOut] = useState("");
  const [err, setErr] = useState("");
  const run = (fn: (v: unknown) => string) => {
    try {
      setOut(fn(JSON.parse(src)));
      setErr("");
    } catch (e) {
      setErr(String((e as Error).message));
    }
  };
  const sortKeys = (v: unknown): unknown =>
    Array.isArray(v) ? v.map(sortKeys) : v && typeof v === "object" ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, sortKeys((v as Record<string, unknown>)[k])])) : v;
  return (
    <div className="tool two-col">
      <div className="tool-col">
        <div className="tool-actions">
          <button className="btn primary" onClick={() => run((v) => JSON.stringify(v, null, 2))}>Biçimlendir</button>
          <button className="btn" onClick={() => run((v) => JSON.stringify(v))}>Sıkıştır</button>
          <button className="btn" onClick={() => run((v) => JSON.stringify(sortKeys(v), null, 2))}>Anahtarları sırala</button>
          <button className="btn" onClick={() => run(() => "✓ Geçerli JSON")}>Doğrula</button>
        </div>
        <CodeEditor className="tool-editor" value={src} onChange={setSrc} language="json" />
      </div>
      <div className="tool-col">
        <div className="tool-actions"><span className="faint">Sonuç</span><CopyBtn text={out} /></div>
        {err ? <div className="tool-error">{err}</div> : <CodeEditor className="tool-editor" value={out} language="json" readOnly />}
      </div>
    </div>
  );
}

function DiffTool() {
  const [a, setA] = useState("satır bir\nsatır iki\nsatır üç");
  const [b, setB] = useState("satır bir\nsatır 2\nsatır üç\nyeni satır");
  const [words, setWords] = useState(false);
  const parts = useMemo(() => (words ? diffWordsWithSpace(a, b) : diffLines(a, b)), [a, b, words]);
  const added = parts.filter((p) => p.added).reduce((n, p) => n + (p.count ?? 0), 0);
  const removed = parts.filter((p) => p.removed).reduce((n, p) => n + (p.count ?? 0), 0);
  return (
    <div className="tool">
      <div className="tool-actions">
        <label className="chip"><input type="checkbox" checked={words} onChange={(e) => setWords(e.target.checked)} /> Kelime bazında</label>
        <span className="diff-stat add">+{added}</span>
        <span className="diff-stat del">−{removed}</span>
      </div>
      <div className="two-col">
        <textarea className="mono-area" value={a} onChange={(e) => setA(e.target.value)} placeholder="Eski metin" spellCheck={false} />
        <textarea className="mono-area" value={b} onChange={(e) => setB(e.target.value)} placeholder="Yeni metin" spellCheck={false} />
      </div>
      <pre className="diff-out">
        {parts.map((p, i) => (
          <span key={i} className={p.added ? "d-add" : p.removed ? "d-del" : ""}>{p.value}</span>
        ))}
      </pre>
    </div>
  );
}

function RegexTool() {
  const [pattern, setPattern] = useState("(\\w+)@(\\w+)\\.com");
  const [flags, setFlags] = useState("g");
  const [text, setText] = useState("ali@ornek.com, veli@test.com ve ayse@site.org");
  const [replace, setReplace] = useState("$1 [$2]");
  const res = useMemo(() => {
    try {
      const re = new RegExp(pattern, flags.includes("g") ? flags : `${flags}g`);
      const matches = [...text.matchAll(re)].slice(0, 500);
      const nodes: ReactNode[] = [];
      let last = 0;
      matches.forEach((m, i) => {
        nodes.push(text.slice(last, m.index));
        nodes.push(<mark key={i}>{m[0] || "∅"}</mark>);
        last = (m.index ?? 0) + m[0].length;
      });
      nodes.push(text.slice(last));
      let replaced = "";
      try {
        replaced = text.replace(new RegExp(pattern, flags), replace);
      } catch {
        replaced = "";
      }
      return { matches, nodes, replaced, error: "" };
    } catch (e) {
      return { matches: [], nodes: [text], replaced: "", error: String((e as Error).message) };
    }
  }, [pattern, flags, text, replace]);
  return (
    <div className="tool">
      <div className="regex-row">
        <span className="faint">/</span>
        <input className="plain-input mono" value={pattern} onChange={(e) => setPattern(e.target.value)} spellCheck={false} />
        <span className="faint">/</span>
        <input className="plain-input mono flags" value={flags} onChange={(e) => setFlags(e.target.value.replace(/[^dgimsuy]/g, ""))} title="Bayraklar: g i m s u y" />
      </div>
      {res.error && <div className="tool-error">{res.error}</div>}
      <textarea className="mono-area short" value={text} onChange={(e) => setText(e.target.value)} spellCheck={false} />
      <div className="regex-preview">{res.nodes}</div>
      <div className="faint">{res.matches.length} eşleşme</div>
      <div className="match-list">
        {res.matches.slice(0, 50).map((m, i) => (
          <div key={i} className="match-row">
            <code>{m[0]}</code>
            {m.slice(1).map((g, j) => <span key={j} className="group">${j + 1}: {g ?? "—"}</span>)}
          </div>
        ))}
      </div>
      <div className="regex-row">
        <span className="faint">Değiştir:</span>
        <input className="plain-input mono" value={replace} onChange={(e) => setReplace(e.target.value)} spellCheck={false} />
      </div>
      <Out label="Sonuç" value={res.replaced} />
    </div>
  );
}

function JwtTool() {
  const [token, setToken] = useState(
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0IiwiYWQiOiJBdMO2bHllIiwiaWF0IjoxNzYxMzg2NDAwLCJleHAiOjE5MDAwMDAwMDB9.imza",
  );
  const parts = token.trim().split(".");
  let header = "", payload = "", error = "", info: string[] = [];
  try {
    header = JSON.stringify(JSON.parse(b64ToUtf8(parts[0])), null, 2);
    const p = JSON.parse(b64ToUtf8(parts[1] ?? ""));
    payload = JSON.stringify(p, null, 2);
    const fmt = (s: number) => new Date(s * 1000).toLocaleString("tr");
    if (p.iat) info.push(`Oluşturma: ${fmt(p.iat)}`);
    if (p.nbf) info.push(`Geçerlilik başlangıcı: ${fmt(p.nbf)}`);
    if (p.exp) info.push(`Bitiş: ${fmt(p.exp)} — ${p.exp * 1000 < Date.now() ? "SÜRESİ DOLMUŞ" : "geçerli"}`);
  } catch {
    error = "Geçerli bir JWT değil (üç parça: başlık.yük.imza).";
    info = [];
  }
  return (
    <div className="tool">
      <textarea className="mono-area short" value={token} onChange={(e) => setToken(e.target.value)} spellCheck={false} />
      {error ? <div className="tool-error">{error}</div> : (
        <>
          {info.map((t) => <div key={t} className={t.includes("DOLMUŞ") ? "tool-error" : "faint"}>{t}</div>)}
          <div className="two-col">
            <div className="tool-col"><div className="faint">Başlık</div><CodeEditor className="tool-editor small" value={header} language="json" readOnly /></div>
            <div className="tool-col"><div className="faint">Yük (payload)</div><CodeEditor className="tool-editor small" value={payload} language="json" readOnly /></div>
          </div>
          <div className="faint">Not: imza doğrulanmaz; sadece içerik çözülür. Token hiçbir yere gönderilmez.</div>
        </>
      )}
    </div>
  );
}

function Base64Tool() {
  const [text, setText] = useState("Merhaba Atölye! ğüşiöç");
  const [b64, setB64] = useState(() => utf8ToB64("Merhaba Atölye! ğüşiöç"));
  const [err, setErr] = useState("");
  return (
    <div className="tool two-col">
      <div className="tool-col">
        <div className="faint">Metin</div>
        <textarea className="mono-area" value={text} spellCheck={false} onChange={(e) => { setText(e.target.value); setB64(utf8ToB64(e.target.value)); setErr(""); }} />
      </div>
      <div className="tool-col">
        <div className="tool-actions"><span className="faint">Base64</span><CopyBtn text={b64} /></div>
        <textarea
          className="mono-area"
          value={b64}
          spellCheck={false}
          onChange={(e) => {
            setB64(e.target.value);
            try {
              setText(b64ToUtf8(e.target.value));
              setErr("");
            } catch {
              setErr("Geçersiz Base64");
            }
          }}
        />
        {err && <div className="tool-error">{err}</div>}
      </div>
    </div>
  );
}

function UrlTool() {
  const [raw, setRaw] = useState("https://ornek.com/ara?q=atölye çalışma&sayfa=2#sonuçlar");
  let parsed: URL | null = null;
  try {
    parsed = new URL(raw);
  } catch {
    parsed = null;
  }
  let decoded = "";
  try {
    decoded = decodeURIComponent(raw);
  } catch {
    decoded = "(çözülemedi)";
  }
  return (
    <div className="tool">
      <textarea className="mono-area short" value={raw} onChange={(e) => setRaw(e.target.value)} spellCheck={false} />
      <Out label="encodeURIComponent" value={encodeURIComponent(raw)} />
      <Out label="encodeURI" value={encodeURI(raw)} />
      <Out label="Çözülmüş" value={decoded} />
      {parsed && (
        <div className="url-parts">
          <Out label="Protokol" value={parsed.protocol} />
          <Out label="Sunucu" value={parsed.host} />
          <Out label="Yol" value={decodeURIComponent(parsed.pathname)} />
          <Out label="Parça (#)" value={decodeURIComponent(parsed.hash)} />
          {[...parsed.searchParams.entries()].map(([k, v], i) => <Out key={i} label={`?${k}`} value={v} />)}
        </div>
      )}
    </div>
  );
}

function TimeTool() {
  const [input, setInput] = useState(() => String(Math.floor(Date.now() / 1000)));
  const n = Number(input.trim());
  const date = !input.trim() ? null : Number.isFinite(n) ? new Date(n > 1e11 ? n : n * 1000) : new Date(input);
  const valid = date && !Number.isNaN(date.getTime());
  return (
    <div className="tool">
      <div className="tool-actions">
        <input className="plain-input mono" value={input} onChange={(e) => setInput(e.target.value)} placeholder="1761386400 · 1761386400000 · 2026-10-25T12:00:00Z" />
        <button className="btn" onClick={() => setInput(String(Math.floor(Date.now() / 1000)))}>Şimdi</button>
      </div>
      {valid ? (
        <>
          <Out label="Yerel" value={date!.toLocaleString("tr", { dateStyle: "full", timeStyle: "medium" })} />
          <Out label="ISO 8601 (UTC)" value={date!.toISOString()} />
          <Out label="Unix (saniye)" value={String(Math.floor(date!.getTime() / 1000))} />
          <Out label="Unix (milisaniye)" value={String(date!.getTime())} />
          <Out label="Göreli" value={relative(date!)} />
        </>
      ) : input.trim() ? <div className="tool-error">Tanınmayan tarih</div> : null}
    </div>
  );
}

function relative(d: Date): string {
  const s = Math.round((d.getTime() - Date.now()) / 1000);
  const rtf = new Intl.RelativeTimeFormat("tr", { numeric: "auto" });
  const a = Math.abs(s);
  if (a < 60) return rtf.format(s, "second");
  if (a < 3600) return rtf.format(Math.round(s / 60), "minute");
  if (a < 86400) return rtf.format(Math.round(s / 3600), "hour");
  if (a < 2592000) return rtf.format(Math.round(s / 86400), "day");
  if (a < 31536000) return rtf.format(Math.round(s / 2592000), "month");
  return rtf.format(Math.round(s / 31536000), "year");
}

function UuidTool() {
  const [count, setCount] = useState(5);
  const [upper, setUpper] = useState(false);
  const [dashes, setDashes] = useState(true);
  const [seed, setSeed] = useState(0);
  const list = useMemo(
    () => Array.from({ length: count }, () => {
      let u: string = crypto.randomUUID();
      if (!dashes) u = u.replace(/-/g, "");
      return upper ? u.toUpperCase() : u;
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [count, upper, dashes, seed],
  );
  return (
    <div className="tool">
      <div className="tool-actions">
        <input type="number" className="plain-input num" min={1} max={500} value={count} onChange={(e) => setCount(Math.max(1, Math.min(500, Number(e.target.value) || 1)))} />
        <label className="chip"><input type="checkbox" checked={upper} onChange={(e) => setUpper(e.target.checked)} /> Büyük harf</label>
        <label className="chip"><input type="checkbox" checked={dashes} onChange={(e) => setDashes(e.target.checked)} /> Tire</label>
        <button className="btn primary" onClick={() => setSeed(seed + 1)}>Yeniden üret</button>
        <CopyBtn text={list.join("\n")} />
      </div>
      <pre className="diff-out">{list.join("\n")}</pre>
    </div>
  );
}

function HashTool() {
  const [text, setText] = useState("Atölye");
  const [hashes, setHashes] = useState<[string, string][]>([]);
  useEffect(() => {
    let alive = true;
    const data = new TextEncoder().encode(text);
    void Promise.all(
      ["SHA-1", "SHA-256", "SHA-384", "SHA-512"].map(async (alg) => {
        const buf = await crypto.subtle.digest(alg, data);
        return [alg, [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("")] as [string, string];
      }),
    ).then((h) => alive && setHashes(h));
    return () => {
      alive = false;
    };
  }, [text]);
  return (
    <div className="tool">
      <textarea className="mono-area short" value={text} onChange={(e) => setText(e.target.value)} spellCheck={false} />
      {hashes.map(([alg, h]) => <Out key={alg} label={alg} value={h} />)}
    </div>
  );
}

function BaseTool() {
  const [value, setValue] = useState("255");
  const [from, setFrom] = useState(10);
  let n: bigint | null = null;
  try {
    const clean = value.trim().replace(/[_\s]/g, "").replace(/^0[xbo]/i, "");
    if (clean) n = [...clean.toLowerCase()].reduce((acc, ch) => {
      const d = parseInt(ch, 36);
      if (Number.isNaN(d) || d >= from) throw new Error("bad");
      return acc * BigInt(from) + BigInt(d);
    }, 0n);
  } catch {
    n = null;
  }
  return (
    <div className="tool">
      <div className="tool-actions">
        <input className="plain-input mono" value={value} onChange={(e) => setValue(e.target.value)} />
        <select className="plain-input" value={from} onChange={(e) => setFrom(Number(e.target.value))}>
          <option value={10}>Onluk</option><option value={16}>Onaltılık</option><option value={2}>İkilik</option><option value={8}>Sekizlik</option>
        </select>
      </div>
      {n === null ? (value.trim() ? <div className="tool-error">Bu tabanda geçersiz sayı</div> : null) : (
        <>
          <Out label="Onluk" value={n.toString(10)} />
          <Out label="Onaltılık" value={`0x${n.toString(16).toUpperCase()}`} />
          <Out label="İkilik" value={`0b${n.toString(2)}`} />
          <Out label="Sekizlik" value={`0o${n.toString(8)}`} />
        </>
      )}
    </div>
  );
}

function ColorTool() {
  const [input, setInput] = useState("#14B8A6");
  const rgb = useMemo(() => {
    const ctx = document.createElement("canvas").getContext("2d")!;
    ctx.fillStyle = "#000001";
    ctx.fillStyle = input.trim();
    const v = ctx.fillStyle;
    if (v === "#000001" && input.trim().toLowerCase() !== "#000001") return null;
    if (v.startsWith("#")) return [parseInt(v.slice(1, 3), 16), parseInt(v.slice(3, 5), 16), parseInt(v.slice(5, 7), 16)];
    const m = v.match(/\d+(\.\d+)?/g);
    return m ? m.slice(0, 3).map(Number) : null;
  }, [input]);
  if (!rgb) return <div className="tool"><input className="plain-input mono" value={input} onChange={(e) => setInput(e.target.value)} /><div className="tool-error">Tanınmayan renk</div></div>;
  const [r, g, b] = rgb;
  const hex = `#${[r, g, b].map((x) => Math.round(x).toString(16).padStart(2, "0")).join("").toUpperCase()}`;
  const [h, s, l] = toHsl(r, g, b);
  const lum = (c: number) => {
    const x = c / 255;
    return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
  };
  const L = 0.2126 * lum(r) + 0.7152 * lum(g) + 0.0722 * lum(b);
  const contrast = (a: number, c: number) => ((Math.max(a, c) + 0.05) / (Math.min(a, c) + 0.05)).toFixed(2);
  return (
    <div className="tool">
      <div className="tool-actions">
        <input className="plain-input mono" value={input} onChange={(e) => setInput(e.target.value)} placeholder="#14B8A6 · rgb(20,184,166) · hsl(…) · teal" />
        <input type="color" value={hex.toLowerCase()} onChange={(e) => setInput(e.target.value.toUpperCase())} />
      </div>
      <div className="color-preview" style={{ background: hex }}><span style={{ color: "#fff" }}>Aa beyaz {contrast(L, 1)}:1</span><span style={{ color: "#000" }}>Aa siyah {contrast(L, 0)}:1</span></div>
      <Out label="HEX" value={hex} />
      <Out label="RGB" value={`rgb(${r}, ${g}, ${b})`} />
      <Out label="HSL" value={`hsl(${h}, ${s}%, ${l}%)`} />
    </div>
  );
}

function toHsl(r: number, g: number, b: number): [number, number, number] {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  let h = 0, s = 0;
  const l = (max + min) / 2;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
    h *= 60;
  }
  return [Math.round(h), Math.round(s * 100), Math.round(l * 100)];
}

function TextTool() {
  const [text, setText] = useState("kullanıcı adı listesi\nÖrnek Satır\nörnek satır\nson satır");
  const words = (s: string) => s.trim().split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  const lower = (s: string) => s.toLocaleLowerCase("tr");
  const cap = (s: string) => s.charAt(0).toLocaleUpperCase("tr") + lower(s.slice(1));
  const ascii = (s: string) => s.replace(/ı/g, "i").replace(/İ/g, "I").normalize("NFD").replace(/[̀-ͯ]/g, "");
  const lines = text.split("\n");
  const ops: [string, string][] = [
    ["camelCase", words(ascii(text)).map((w, i) => (i ? cap(w) : lower(w))).join("")],
    ["PascalCase", words(ascii(text)).map(cap).join("")],
    ["snake_case", words(ascii(text)).map(lower).join("_")],
    ["kebab-case", words(ascii(text)).map(lower).join("-")],
    ["CONSTANT_CASE", words(ascii(text)).map((w) => w.toUpperCase()).join("_")],
    ["BÜYÜK HARF", text.toLocaleUpperCase("tr")],
    ["küçük harf", lower(text)],
    ["Satırları sırala", [...lines].sort((a, b) => a.localeCompare(b, "tr")).join("\n")],
    ["Tekrarları kaldır", [...new Set(lines)].join("\n")],
    ["Satırları ters çevir", [...lines].reverse().join("\n")],
    ["Boşlukları kırp", lines.map((l) => l.trim()).filter(Boolean).join("\n")],
  ];
  return (
    <div className="tool">
      <textarea className="mono-area short" value={text} onChange={(e) => setText(e.target.value)} spellCheck={false} />
      <div className="faint">{text.length} karakter · {words(text).length} kelime · {lines.length} satır</div>
      {ops.map(([k, v]) => <Out key={k} label={k} value={v} />)}
    </div>
  );
}

const VIEWS: Record<ToolId, () => ReactNode> = {
  json: () => <JsonTool />, diff: () => <DiffTool />, regex: () => <RegexTool />, jwt: () => <JwtTool />, base64: () => <Base64Tool />,
  url: () => <UrlTool />, time: () => <TimeTool />, uuid: () => <UuidTool />, hash: () => <HashTool />, base: () => <BaseTool />,
  color: () => <ColorTool />, text: () => <TextTool />,
};

export function ToolsView() {
  const [tool, setTool] = useState<ToolId>("json");
  return (
    <div className="tools">
      <aside className="tool-list">
        {TOOLS.map((t) => (
          <button key={t.id} className={`tool-item${tool === t.id ? " on" : ""}`} onClick={() => setTool(t.id)}>
            <span className="tool-name">{t.name}</span>
            <span className="tool-hint">{t.hint}</span>
          </button>
        ))}
      </aside>
      <section className="tool-body" key={tool}>
        <h2 className="tool-title">{TOOLS.find((t) => t.id === tool)!.name}</h2>
        {VIEWS[tool]()}
      </section>
    </div>
  );
}
