/**
 * Otomatik duman testi (sadece ATOLYE_SMOKE=<klasor> ortam degiskeni verilirse calisir).
 * Uygulamayi gercek pencerede gezer, her adimin ekran goruntusunu kaydeder, sonuclari log.txt'ye yazar ve kapanir.
 */
import { app, clipboard, type BrowserWindow } from "electron";
import { promises as fs, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
/** Kosul dogru olana kadar (en fazla ms) bekler: diske yazma gecikmesine karsi sabit beklemeden saglam. */
async function waitFor(cond: () => boolean, ms = 5000): Promise<boolean> {
  for (let t = 0; t < ms; t += 200) {
    if (cond()) return true;
    await wait(200);
  }
  return cond();
}

export async function runSmoke(win: BrowserWindow, outDir: string): Promise<void> {
  await fs.mkdir(outDir, { recursive: true });
  const wc = win.webContents;
  const log: string[] = [];
  wc.on("console-message", (e) => {
    if (e.level === "error" && !/esm\.sh|subsetting|document is not defined|window is not defined/.test(e.message)) log.push(`[konsol hatası] ${e.message.slice(0, 300)}`);
  });
  const shot = async (name: string) => {
    const img = await wc.capturePage();
    await fs.writeFile(path.join(outDir, `${name}.png`), img.toPNG());
  };
  const key = async (keyCode: string, modifiers: ("control" | "shift" | "alt")[] = []) => {
    wc.sendInputEvent({ type: "keyDown", keyCode, modifiers });
    wc.sendInputEvent({ type: "keyUp", keyCode, modifiers });
    await wait(400);
  };
  const type = async (text: string) => {
    for (const ch of text) wc.sendInputEvent({ type: "char", keyCode: ch });
    await wait(300);
  };
  const js = (code: string) => wc.executeJavaScript(code, true);
  const vault = process.env.ATOLYE_VAULT || "";
  const read = (rel: string) => {
    try {
      return readFileSync(path.join(vault, rel), "utf8");
    } catch (e) {
      return `OKUNAMADI: ${String(e)}`;
    }
  };
  const openQuick = async (name: string) => {
    await key("O", ["control"]);
    await type(name);
    await key("Return");
    await wait(800);
  };
  const check = (name: string, ok: boolean, detail = "") => log.push(`${ok ? "GEÇTİ" : "KALDI"}  ${name}${detail ? `  — ${detail}` : ""}`);
  /** Her bolmedeki sekme basliklari, soldan saga. */
  const groupTabs = (): Promise<string[][]> =>
    js(`[...document.querySelectorAll('.group-bar')].map(b => [...b.querySelectorAll('.tab')].map(t => t.querySelector('.tab-title').textContent.trim()))`);

  // Oturum geri yukleme asamalari: eski bicimli oturum (tek sekme listesi) ve kaydedilmis bolmeler
  const phase = process.env.ATOLYE_SMOKE_PHASE || "full";
  const draftsDir = path.join(app.getPath("userData"), "drafts");
  const draftTexts = () => {
    try {
      return readdirSync(draftsDir)
        .filter((n) => n.endsWith(".json"))
        .map((n) => String(JSON.parse(readFileSync(path.join(draftsDir, n), "utf8")).content));
    } catch {
      return [] as string[];
    }
  };
  const statusText = (): Promise<string> => js(`document.querySelector('.statusbar')?.textContent || ''`);

  // Kasaya yazilamazsa (Denetimli klasor erisimi gibi): yedekle, uyar, izin gelince kendiliginden kaydet.
  // Harness "Kilitli.md" dosyasini salt okunur yapar; yeniden adlandirma EPERM verir.
  // Ajanlar bolumu: ATOLYE_AGENTS=<gecici ajan reposu> ile (gercek repoya dokunmaz)
  if (phase === "agents") {
    const repo = process.env.ATOLYE_AGENTS || "";
    const rd = (rel: string) => { try { return readFileSync(path.join(repo, rel), "utf8"); } catch { return ""; } };
    try {
      await wait(2500);
      await key("J", ["control", "alt"]);
      await wait(2500);
      const roles = JSON.parse(rd("roster.json")).roles.length;
      // Merkez: varsayilan sekme; robotlar (schedule.json + otomatik esitleme satiri), raporlar, araclar
      const robotsN = JSON.parse(rd("schedule.json") || '{"robots":[]}').robots.length;
      await wait(1500);
      const hub = await js(`(() => ({ on: !!document.querySelector('.hub'), robots: document.querySelectorAll('.hub-robots tbody tr').length, reports: document.querySelectorAll('.hub-reports .hub-list li button').length, launch: [...document.querySelectorAll('.hub-launch button')].map(b => b.textContent).join('|') }))()`);
      check("merkez: varsayılan sekme, robotlar + eşitleme satırı", hub.on && hub.robots === robotsN + 1, `${hub.robots} satır / ${robotsN} robot`);
      check("merkez: raporlar listede (bulut + bu PC)", hub.reports > 0, `${hub.reports} rapor`);
      check("merkez: Claude Code, Codex, Antigravity düğmeleri", /Claude Code/.test(hub.launch) && /Codex/.test(hub.launch) && /Antigravity/.test(hub.launch), hub.launch);
      await shot("ag-hub");
      await js(`[...document.querySelectorAll('.ag-tab')].find(b => b.textContent.includes('Ofis')).click()`);
      await wait(1500);
      const canvas = await js(`(() => { const c = document.querySelector('.office-stage canvas'); return c ? c.width * c.height : 0; })()`);
      check("ajanlar: 3B köpek ofisi çizildi", canvas > 0, `canvas ${canvas}`);
      const visibleCards = `[...document.querySelectorAll('.office-card')].filter(c => c.isConnected && c.style.display !== 'none').length`;
      const quiet = await js(visibleCards);
      check("ajanlar: başta her ajanın kartı görünür", quiet === roles, `${quiet}/${roles}`);
      await shot("ag-00-3b-ofis");
      await js(`document.querySelector('.office-tool[title="Uyuyanların etiketlerini gizle"]')?.click()`);
      await wait(800);
      const officeCards = await js(visibleCards);
      check("ajanlar: düğmeyle uyuyanların etiketi gizlenir", officeCards > 0 && officeCards < roles, `${officeCards}/${roles}`);
      await js(`document.querySelector('.office-tool[title="Tüm etiketleri göster"]')?.click()`);
      await wait(600);
      // karta tiklayinca ayrinti paneli
      await js(`[...document.querySelectorAll('.office-card')].find(c => c.textContent.includes('Shoot'))?.click()`);
      await wait(600);
      check("ajanlar: karta tıklayınca ayrıntı paneli", await js(`!!document.querySelector('.office-detail')`));
      await shot("ag-00b-kopek-secili");
      // CANLI VERI: durum.json degisince kopek, kart ve sayac degismeli
      const durum = path.join(repo, "roller", "shoot", "durum.json");
      const orig = readFileSync(durum, "utf8");
      const j = JSON.parse(orig);
      writeFileSync(durum, JSON.stringify({ ...j, state: "working", lastRun: new Date().toISOString(), did: "motor testini yaziyor" }, null, 2));
      await js(`[...document.querySelectorAll('button')].find(b => b.textContent.includes('Eşitle'))?.click()`);
      await wait(3500);
      const st = await js(`window.__office?.stateOf('shoot')`);
      const cardLive = await js(`[...document.querySelectorAll('.office-card')].some(c => c.classList.contains('st-working') && c.textContent.includes('motor testini'))`);
      const pill = await js(`document.querySelector('.office-pill')?.textContent || ''`);
      check("ajanlar: canlı veri (durum.json → köpek çalışıyor)", st === "working" && cardLive && /1 ajan/.test(pill), `${st} · kart ${cardLive} · ${pill.trim()}`);
      await wait(2500);
      await shot("ag-00c-canli-calisiyor");
      await js(`window.__office?.focus("shoot", 3)`);
      await wait(2500);
      await shot("ag-00d-yakin-calisiyor");
      await js(`window.__office?.focus(null)`);
      await wait(1500);
      writeFileSync(durum, JSON.stringify({ ...j, state: "done", lastRun: new Date().toISOString(), did: "motor testi bitti" }, null, 2));
      await js(`[...document.querySelectorAll('button')].find(b => b.textContent.includes('Eşitle'))?.click()`);
      await wait(3500);
      check("ajanlar: canlı veri (bitti)", (await js(`window.__office?.stateOf('shoot')`)) === "done");
      writeFileSync(durum, orig);
      await js(`[...document.querySelectorAll('.ag-viewswitch .ag-tab')].find(b => b.textContent.includes('Kartlar')).click()`);
      await wait(600);
      const cards = await js(`document.querySelectorAll('.ag-card').length`);
      check("ajanlar: ofis kartları", cards === roles, `${cards}/${roles}`);
      await shot("ag-01-ofis");
      const pending = readdirSync(path.join(repo, "approvals", "pending")).filter((n) => n.endsWith(".md"));
      const badge = await js(`document.querySelector('.ribbon-badge')?.textContent || '0'`);
      check("ajanlar: onay rozeti", Number(badge) === pending.length, `${badge}/${pending.length}`);
      await js(`[...document.querySelectorAll('.ag-tab')].find(b => b.textContent.includes('Onaylar')).click()`);
      await wait(600);
      check("ajanlar: bekleyen onaylar", (await js(`document.querySelectorAll('.ag-approval').length`)) === pending.length);
      await shot("ag-02-onaylar");
      await js(`[...document.querySelectorAll('.ag-approval .btn.primary')][0]?.click()`);
      await wait(3500);
      const moved = rd(`approvals/decided/${pending[0]}`);
      check("ajanlar: onay kaydedildi", /decision: approved/.test(moved) && !rd(`approvals/pending/${pending[0]}`), moved.split(/\r?\n/).slice(0, 3).join(" | "));
      await js(`[...document.querySelectorAll('.ag-tab')].find(b => b.textContent.includes('Pano')).click()`);
      await wait(600);
      await js(`document.querySelector('.ag-new input').focus()`);
      await type("Duman testi gorevi");
      await js(`document.querySelector('.ag-new button[type=submit]').click()`);
      await wait(3500);
      const inbox = readdirSync(path.join(repo, "board", "inbox")).filter((n) => n.includes("duman-testi-gorevi"));
      check("ajanlar: panoya görev eklendi", inbox.length === 1, inbox.join(","));
      await shot("ag-03-pano");
      for (const t of ["Raporlar", "Notlar", "Çalıştır"]) {
        await js(`[...document.querySelectorAll('.ag-tab')].find(b => b.textContent.includes('${t}')).click()`);
        await wait(500);
      }
      await shot("ag-04-calistir");
      // Gercek "Hemen calistir" (Claude kotasi kullanir): yalniz ATOLYE_SMOKE_RUN=1 ile
      if (process.env.ATOLYE_SMOKE_RUN === "1") {
        await js(`(() => { const s = document.querySelector('.ag-new select'); const set = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set; set.call(s, 'github'); s.dispatchEvent(new Event('change', { bubbles: true })); })()`);
        await js(`document.querySelector('.ag-new textarea').focus()`);
        await type("Reply with the single word TAMAM. Do not read or change any file.");
        await js(`[...document.querySelectorAll('.ag-new .btn.primary')].find(b => b.textContent.includes('Hemen'))?.click()`);
        let ended = "";
        for (let i = 0; i < 90 && !ended; i++) {
          await wait(2000);
          ended = await js(`[...document.querySelectorAll('.ag-log-line.k-end')].map(e => e.textContent).join(' ')`);
        }
        const logText: string = await js(`[...document.querySelectorAll('.ag-log-line')].map(e => e.textContent).join(' | ')`);
        check("ajanlar: hemen çalıştır (gerçek claude -p)", /bitti/.test(ended) && /TAMAM/i.test(logText), logText.slice(-300));
        await shot("ag-05-calisti");
      }
      log.push(`yakalanmamış hatalar: ${JSON.stringify(await js("window.__errors || []"))}`);
    } catch (e) {
      log.push(`SMOKE HATA: ${String(e)}`);
    }
    await fs.writeFile(path.join(outDir, "log.txt"), log.join("\n"), "utf8");
    app.quit();
    return;
  }

  // Obsidian benzeri ozellikler: yer imi, dosya gecmisi, ozellikler, baglantisiz anmalar, baglanti onizlemesi
  if (phase === "features") {
    try {
      // KaTeX ve highlight.js acilista yuklenmez: arka plan yuklemesinden ONCE acilan notta yer tutucu cizilip
      // parca gelince gercek formule / renkli koda donusmeli
      await wait(900);
      await fs.writeFile(path.join(vault, "Formul testi.md"), "# Formul testi\n\nSatir ici $E=mc^2$ formul.\n\n$$\n\\int_0^1 x\\,dx\n$$\n\n```js\nconst x = 42;\nfunction f() { return x; }\n```\n", "utf8");
      await wait(700);
      await openQuick("Formul testi");
      if (await js(`!!document.querySelector('.editor .cm-content')`)) await key("E", ["control"]);
      await wait(2500);
      const mathState = await js(`(() => { const p = document.querySelector('.preview-scroll .markdown'); return p ? { katex: p.querySelectorAll('.katex').length, pending: p.querySelectorAll('.math-pending, .hl-pending').length, kw: p.querySelectorAll('.hljs-keyword').length } : null; })()`);
      check("özellik: formül (KaTeX) ve renkli kod sonradan yüklenip çizildi", !!mathState && mathState.katex >= 2 && mathState.pending === 0 && mathState.kw >= 1, JSON.stringify(mathState));
      await shot("ft-00-formul-kod");
      await fs.writeFile(path.join(vault, "Ozellik testi.md"), "---\ndurum: taslak\netiketler: [fikir, is]\n---\n# Ozellik testi\n\nSistem mimarisi burada geciyor.\n", "utf8");
      await wait(1500);
      // yer imi
      await openQuick("Sistem mimarisi");
      await key("M", ["control", "alt"]);
      await wait(800);
      check("özellik: yer imi kenar çubuğunda", await js(`[...document.querySelectorAll('.bookmark-row')].some(r => r.textContent.includes('Sistem mimarisi'))`));
      await shot("ft-01-yer-imi");
      // dosya gecmisi: degistir, kaydedilsin, gecmisi ac
      await key("End", ["control"]);
      await type(" GECMIS1");
      await wait(2500);
      await key("Y", ["control", "alt"]);
      await wait(1200);
      const rows = await js(`document.querySelectorAll('.history-row').length`);
      check("özellik: dosya geçmişinde eski sürüm", rows >= 1, `${rows} sürüm`);
      await shot("ft-02-gecmis");
      await js(`[...document.querySelectorAll('.dialog .btn')].find(b => b.textContent.includes('Kapat'))?.click()`);
      await wait(400);
      // baglantisiz anmalar (Sistem mimarisi acik): sag panel baglantilar
      if (!(await js(`!!document.querySelector('.sidebar.right')`))) await key("R", ["control", "shift"]);
      await wait(400);
      await js(`[...document.querySelectorAll('.sidebar.right .seg button')].find(b => b.textContent.includes('Bağlantılar'))?.click()`);
      await wait(600);
      check("özellik: bağlantısız anmalar", await js(`[...document.querySelectorAll('.sidebar.right .backlink-title')].some(b => b.textContent.includes('Ozellik testi'))`));
      await shot("ft-03-anmalar");
      // ozellikler
      await openQuick("Ozellik testi");
      await js(`[...document.querySelectorAll('.sidebar.right .seg button')].find(b => b.textContent.includes('Özellikler'))?.click()`);
      await wait(600);
      const props = await js(`document.querySelectorAll('.prop-row').length`);
      check("özellik: özellikler paneli", props === 2, `${props} satır`);
      await shot("ft-04-ozellikler");
      // baglanti onizlemesi: hos geldin notunu okuma modunda ac, baglantinin ustune gel
      await openQuick("hoş geldin");
      await key("E", ["control"]);
      await wait(900);
      await js(`(() => { const a = document.querySelector('.preview-scroll a.wikilink'); a && a.dispatchEvent(new MouseEvent('mouseover', { bubbles: true })); })()`);
      await wait(900);
      check("özellik: bağlantı önizlemesi", await js(`!!document.querySelector('.hover-preview .markdown')`));
      await shot("ft-05-onizleme");
      log.push(`yakalanmamış hatalar: ${JSON.stringify(await js("window.__errors || []"))}`);
    } catch (e) {
      log.push(`SMOKE HATA: ${String(e)}`);
    }
    await fs.writeFile(path.join(outDir, "log.txt"), log.join("\n"), "utf8");
    app.quit();
    return;
  }

  // Kapanip acilinca duzen ayni gelmeli: acik klasorler, sag/sol panel bolumu, renk temasi
  if (phase === "session1" || phase === "session2") {
    try {
      await wait(2500);
      if (phase === "session1") {
        await openQuick("Sistem mimarisi");
        if (!(await js(`!!document.querySelector('.sidebar.right')`))) await key("R", ["control", "shift"]);
        await wait(400);
        await js(`[...document.querySelectorAll('.sidebar.right .seg button')].find(b => b.textContent.includes('Özellikler'))?.click()`);
        await wait(300);
        await js(`document.querySelector('.ribbon button[title^="Ayarlar"]')?.click()`);
        await wait(600);
        await js(`[...document.querySelectorAll('.palette-card')].find(b => b.textContent.includes('Orman'))?.click()`);
        await wait(600);
        check("oturum: tema değişti", (await js(`document.documentElement.dataset.palette`)) === "orman");
        await shot("ss-01-orman-ayarlar");
        await key("Escape");
        await wait(1500);
      } else {
        check("oturum: renk teması hatırlandı", (await js(`document.documentElement.dataset.palette`)) === "orman");
        check("oturum: açık klasör hatırlandı", await js(`[...document.querySelectorAll('.tree-row')].some(r => r.textContent.trim() === 'Sistem mimarisi')`));
        check("oturum: sağ panel bölümü hatırlandı", await js(`[...document.querySelectorAll('.sidebar.right .seg button.on')].some(b => b.textContent.includes('Özellikler'))`));
        await shot("ss-02-yeniden-acildi");
      }
      log.push(`yakalanmamış hatalar: ${JSON.stringify(await js("window.__errors || []"))}`);
    } catch (e) {
      log.push(`SMOKE HATA: ${String(e)}`);
    }
    await fs.writeFile(path.join(outDir, `log-${phase}.txt`), log.join("\n"), "utf8");
    app.quit();
    return;
  }

  // Performans olcumu: acilis, bellek, bosta CPU, uzun gorevler (>50 ms), yazma gecikmesi. perf.json'a yazar.
  if (phase === "perf") {
    const procStart = Date.now() - process.uptime() * 1000;
    const loadedAt = Date.now() - procStart;
    const res: Record<string, unknown> = { didFinishLoadMs: Math.round(loadedAt) };
    try {
      let ready = 0;
      for (let i = 0; i < 400 && !ready; i++) {
        if (await js(`document.querySelectorAll('.tree-row').length > 0 && !!document.querySelector('.editor, .markdown')`)) ready = Date.now() - procStart;
        else await wait(25);
      }
      res.firstContentMs = Math.round(ready);
      if (process.env.ATOLYE_PERF_PROFILE === "start") {
        await wait(500);
        const { profile } = (await wc.debugger.sendCommand("Profiler.stop")) as { profile: unknown };
        await fs.writeFile(path.join(outDir, "startup.cpuprofile"), JSON.stringify(profile), "utf8");
        wc.debugger.detach();
      }
      res.nav = await js(`(() => { const n = performance.getEntriesByType('navigation')[0]; return { domContentLoaded: Math.round(n.domContentLoadedEventEnd), load: Math.round(n.loadEventEnd) }; })()`);
      res.scripts = await js(`performance.getEntriesByType('resource').filter(r => /\\.js$/.test(r.name)).map(r => r.name.split('/').pop() + ' ' + Math.round(r.encodedBodySize / 1024) + 'KB').join(', ')`);
      await js(`window.__lt = 0; window.__ltN = 0; new PerformanceObserver(l => { for (const e of l.getEntries()) { window.__lt += e.duration; window.__ltN++; } }).observe({ type: 'longtask', buffered: true });`);
      await wait(300);
      res.startupLongTasks = await js(`({ ms: Math.round(window.__lt), n: window.__ltN })`);
      const measure = async (name: string, ms = 5000) => {
        await js(`window.__lt = 0; window.__ltN = 0;`);
        app.getAppMetrics();
        await wait(ms);
        const m = app.getAppMetrics();
        const cpu = m.reduce((s, p) => s + p.cpu.percentCPUUsage, 0);
        const mem = m.reduce((s, p) => s + p.memory.workingSetSize, 0) / 1024;
        const byType = Object.fromEntries(m.map((p) => [`${p.type}${p.name ? ":" + p.name : ""}#${p.pid}`, `${p.cpu.percentCPUUsage.toFixed(1)}% ${Math.round(p.memory.workingSetSize / 1024)}MB`]));
        const heap = await js(`Math.round((performance.memory?.usedJSHeapSize || 0) / 1048576)`);
        const lt = await js(`({ ms: Math.round(window.__lt), n: window.__ltN })`);
        res[name] = { cpuPct: +cpu.toFixed(1), memMB: Math.round(mem), heapMB: heap, longTasks: lt, procs: byType };
      };
      await wait(1500);
      await measure("idleNote");
      // yazma: 300 karakter, her tus ayri olay; toplam sure ve uzun gorevler
      if (!(await js(`!!document.querySelector('.editor .cm-content')`))) {
        await key("E", ["control"]);
        await wait(600);
      }
      res.editorFound = await js(`!!document.querySelector('.editor .cm-content')`);
      await js(`document.querySelector('.editor .cm-content')?.focus()`);
      await js(`window.__lt = 0; window.__ltN = 0;`);
      const prof = process.env.ATOLYE_PERF_PROFILE === "1";
      if (prof) {
        wc.debugger.attach("1.3");
        await wc.debugger.sendCommand("Profiler.enable");
        await wc.debugger.sendCommand("Profiler.setSamplingInterval", { interval: 200 });
        await wc.debugger.sendCommand("Profiler.start");
      }
      const t0 = Date.now();
      const text = "Performans testi satiri, hizli yazma denemesi. ".repeat(6).slice(0, 300);
      for (const ch of text) wc.sendInputEvent({ type: "char", keyCode: ch });
      for (let i = 0; i < 200; i++) {
        if (await js(`(document.querySelector('.cm-content')?.textContent || '').includes(${JSON.stringify(text.slice(-20))})`)) break;
        await wait(20);
      }
      res.typing300 = { ms: Date.now() - t0, longTasks: await js(`({ ms: Math.round(window.__lt), n: window.__ltN })`) };
      // yazma durunca (300 ms sonra) indeks yenilenir: o anki donma
      await js(`window.__lt = 0; window.__ltN = 0;`);
      await wait(1500);
      res.afterTypingLongTasks = await js(`({ ms: Math.round(window.__lt), n: window.__ltN })`);
      if (prof) {
        const { profile } = (await wc.debugger.sendCommand("Profiler.stop")) as { profile: unknown };
        await fs.writeFile(path.join(outDir, "typing.cpuprofile"), JSON.stringify(profile), "utf8");
        wc.debugger.detach();
      }
      // karsilastirma: ayni yazma duz bir textarea'ya (olay gonderme hizinin tabani)
      await js(`(() => { const t = document.createElement('textarea'); t.id = '__perfta'; t.style.cssText = 'position:fixed;left:0;top:0;width:200px;height:50px;z-index:9999'; document.body.appendChild(t); t.focus(); })()`);
      const t1 = Date.now();
      for (const ch of text) wc.sendInputEvent({ type: "char", keyCode: ch });
      for (let i = 0; i < 200; i++) {
        if (await js(`(document.getElementById('__perfta')?.value || '').length >= ${text.length}`)) break;
        await wait(20);
      }
      res.typing300textarea = { ms: Date.now() - t1 };
      await js(`document.getElementById('__perfta')?.remove()`);
      await key("Z", ["control"]);
      // 3B ofis acik
      await key("J", ["control", "alt"]);
      const tOff = Date.now();
      for (let i = 0; i < 200; i++) {
        // Merkez varsayilan sekme: Ofis'e gec
        await js(`[...document.querySelectorAll('.ag-tab')].find(b => b.textContent.includes('Ofis') && !b.classList.contains('on'))?.click()`);
        if (await js(`(() => { const c = document.querySelector('.office-stage canvas'); return !!c && c.width > 0; })()`)) break;
        await wait(25);
      }
      res.officeOpenMs = Date.now() - tOff;
      await wait(2000);
      await measure("officeVisible");
      // ofis sekmesi arkada, not onde
      await key("Tab", ["control"]);
      await wait(1000);
      await measure("officeInBackground");
      // 30 sn gizli kalan ofis 3B sahneyi kapatir; bellek geri gelmeli
      await wait(28000);
      await measure("officeReleased", 4000);
      res.officeCanvasAfterRelease = await js(`document.querySelectorAll('.office-stage canvas').length`);
      // pencere simge durumunda
      win.minimize();
      await wait(800);
      await measure("minimized");
      win.restore();
      await wait(800);
      // terminal acik, bosta
      await key("J", ["control"]);
      await wait(3500);
      await measure("terminalIdle");
      await key("J", ["control"]);
      // grafik gorunumu
      await key("G", ["control", "shift"]);
      await wait(2500);
      await measure("graphOpen");
    } catch (e) {
      res.error = String(e);
    }
    await fs.writeFile(path.join(outDir, "perf.json"), JSON.stringify(res, null, 2), "utf8");
    await fs.writeFile(path.join(outDir, "log.txt"), `PERF ${JSON.stringify(res)}\nyakalanmamış hatalar: ${JSON.stringify(await js("window.__errors || []"))}`, "utf8");
    app.quit();
    return;
  }

  // Merkez gercek verilerle (salt okunur goruntu; ATOLYE_AGENTS ve ATOLYE_APP gercek repolar)
  if (phase === "hub") {
    try {
      await wait(2500);
      await key("J", ["control", "alt"]);
      for (let i = 0; i < 40 && !(await js(`document.querySelectorAll('.hub-gh .hub-list li').length > 0 || !!document.querySelector('.hub-gh .ag-error')`)); i++) await wait(500);
      check("merkez (gerçek): robotlar", (await js(`document.querySelectorAll('.hub-robots tbody tr').length`)) >= 5);
      check("merkez (gerçek): GitHub issue ve CI", await js(`document.querySelectorAll('.hub-gh .hub-list li').length > 0`));
      check("merkez (gerçek): eşitleme durumu", !/bekleniyor/.test(await js(`document.querySelector('.hub-strip')?.textContent || ''`)), await js(`document.querySelector('.hub-sync')?.textContent || ''`));
      // sahte Antigravity kaydi (ATOLYE_AGY_HOME): eleştirmen + haberler calisiyor, gorev alici internetsiz kaldi
      if (process.env.ATOLYE_AGY_HOME && process.env.ATOLYE_AGY_EXPECT) {
        await wait(1500);
        const agy = await js(`(async () => { const s = await window.atolye.agents.snapshot(); return { live: [...document.querySelectorAll('.hub-robots .hub-tag.live')].map(e => e.closest('tr').querySelector('b').textContent).join('|'), bad: [...document.querySelectorAll('.hub-robots .hub-tag.bad')].map(e => e.textContent).join('|'), pill: document.querySelector('.hub-strip')?.textContent || '', news: s.roles.find(r => r.id === 'news')?.live?.state }; })()`);
        check("antigravity: çalışan otomasyonlar Merkez'de", agy.live === process.env.ATOLYE_AGY_EXPECT, agy.live);
        check("antigravity: internetsiz kalan iş hata olarak", /İnternet/.test(agy.bad), agy.bad);
        check("antigravity: üst şeritte çalışan ajan sayısı", /2 ajan çalışıyor/.test(agy.pill), agy.pill);
        check("antigravity: haberler rolü ofiste çalışıyor", agy.news === "working", String(agy.news));
      }
      await shot("hub-1");
      await js(`document.querySelector('.hub')?.scrollTo(0, 99999)`);
      await wait(500);
      await shot("hub-2");
      log.push(`yakalanmamış hatalar: ${JSON.stringify(await js("window.__errors || []"))}`);
    } catch (e) {
      log.push(`SMOKE HATA: ${String(e)}`);
    }
    await fs.writeFile(path.join(outDir, "log.txt"), log.join("\n"), "utf8");
    app.quit();
    return;
  }

  // Terminal paneli ve Not Asistani
  if (phase === "tools") {
    try {
      await wait(2500);
      await key("J", ["control"]);
      await wait(4500);
      check("terminal: panel açıldı ve sekme var", await js(`!!document.querySelector('.term-panel') && document.querySelectorAll('.term-tab').length >= 1`));
      await js(`document.querySelector('.term-view:not([style*="none"]) .xterm-helper-textarea')?.focus()`);
      await type("echo ATOLYE-TERM-$((6*7))");
      await key("Return");
      await wait(2500);
      const rows: string = await js(`[...document.querySelectorAll('.term-view .xterm-rows')].map(r => r.textContent).join(' ')`);
      check("terminal: PowerShell komutu çalıştı", /ATOLYE-TERM-42/.test(rows), rows.slice(-160));
      const projBtn: string = await js(`document.querySelector('.term-proj-btn')?.textContent || ''`);
      check("terminal: varsayılan klasör uygulama projesi", /Uygulama/.test(projBtn) && /version6>/.test(rows.replace(/\s+/g, "")), projBtn);
      await js(`document.querySelector('.term-new button[title="Terminal türü seç"]')?.click()`);
      await wait(400);
      const menu: string = await js(`[...document.querySelectorAll('.term-menu button')].map(b => b.textContent + (b.disabled ? '(yok)' : '')).join(' | ')`);
      check("terminal: profil menüsü (Claude Code, Antigravity, Codex)", /Claude Code/.test(menu) && /Antigravity/.test(menu) && /Codex/.test(menu), menu);
      await shot("tl-01-terminal");
      await js(`document.querySelector('.term-new button[title="Terminal türü seç"]')?.click()`);
      // hizli proje secimi: menu gruplari + "Kasa" satirindan dogrudan PowerShell
      await js(`document.querySelector('.term-proj-btn')?.click()`);
      await wait(400);
      const heads: string = await js(`[...document.querySelectorAll('.term-proj-head')].map(h => h.textContent).join(' | ')`);
      const rowsN: number = await js(`document.querySelectorAll('.term-proj-row').length`);
      check("terminal: proje menüsü (projelerim + masaüstü repoları)", /Projelerim/.test(heads) && /Masaüstündeki repolar/.test(heads) && rowsN >= 4, `${heads} (${rowsN} klasör)`);
      await shot("tl-01b-proje-menu");
      await js(`[...document.querySelectorAll('.term-proj-row')].find(r => /Kasa/.test(r.textContent))?.querySelector('button[title="Burada PowerShell aç"]')?.click()`);
      await wait(4000);
      const tabTitles: string = await js(`[...document.querySelectorAll('.term-tab')].map(t => t.textContent).join(' | ')`);
      check("terminal: menüden başka klasörde terminal açıldı", /PowerShell · Kasa/.test(tabTitles) && /Kasa/.test(await js(`document.querySelector('.term-proj-btn')?.textContent || ''`)), tabTitles);
      // not asistani
      await key("K", ["control", "alt"]);
      await wait(1200);
      await js(`document.querySelector('.asst-quick')?.focus()`);
      await type("Kadikoy sahasinda cekim planlandi");
      await js(`[...document.querySelectorAll('.asst .btn.primary')].find(b => b.textContent.includes('Kaydet'))?.click()`);
      await wait(1500);
      const d = new Date();
      const p2 = (n: number) => String(n).padStart(2, "0");
      const noteRel = `Notlarım/${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}.md`;
      check("asistan: hızlı not kaydedildi", read(noteRel).includes("Kadikoy sahasinda cekim planlandi"), noteRel);
      check("asistan: not listede görünüyor", await js(`document.querySelectorAll('.asst-note').length >= 1`));
      await shot("tl-02-asistan");
      if (process.env.ATOLYE_SMOKE_RUN === "1") {
        await js(`(() => { const s = [...document.querySelectorAll('.asst select')][1]; const set = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set; set.call(s, 'haiku'); s.dispatchEvent(new Event('change', { bubbles: true })); })()`);
        await js(`document.querySelector('.asst-ai textarea')?.focus()`);
        await type("Hangi sahada cekim planlandi? Tek kelimeyle yaz.");
        await js(`[...document.querySelectorAll('.asst-ai .btn.primary')].find(b => b.textContent.includes('Sor'))?.click()`);
        let ans = "";
        for (let i = 0; i < 60 && !ans; i++) {
          await wait(2000);
          ans = await js(`document.querySelector('.asst-answer .markdown')?.textContent || document.querySelector('.asst-ai .ag-error')?.textContent || ''`);
        }
        check("asistan: model notu okuyup yanıtladı (Haiku)", /kad[ıi]k[öo]y/i.test(ans), ans.slice(0, 160));
        await shot("tl-03-asistan-yanit");
      }
      log.push(`yakalanmamış hatalar: ${JSON.stringify(await js("window.__errors || []"))}`);
    } catch (e) {
      log.push(`SMOKE HATA: ${String(e)}`);
    }
    await fs.writeFile(path.join(outDir, "log.txt"), log.join("\n"), "utf8");
    app.quit();
    return;
  }

  if (phase === "savefail") {
    try {
      await wait(2500);
      await openQuick("Kilitli");
      await key("End", ["control"]);
      await type(" ENGELLI-YAZI");
      await wait(2000);
      const status = await statusText();
      check("yazılamayınca uyarı gösterilir", /Kaydedilemedi/.test(status), status);
      check("yazılamayınca taslak yedeklenir", draftTexts().some((t) => t.includes("ENGELLI-YAZI")), JSON.stringify(draftTexts()));
      check("dosya değişmedi (gerçekten engellendi)", !read("Kilitli.md").includes("ENGELLI-YAZI"));
      await shot("savefail-uyari");
      // Engeli kaldir: yeniden deneme kendiliginden kaydetmeli
      await fs.chmod(path.join(vault, "Kilitli.md"), 0o666);
      await wait(7000);
      check("engel kalkınca kendiliğinden kaydedilir", read("Kilitli.md").includes("ENGELLI-YAZI"), read("Kilitli.md").slice(-60));
      check("kayıttan sonra taslak silinir", draftTexts().length === 0, JSON.stringify(draftTexts()));
      check("durum çubuğu Kaydedildi gösterir", /Kaydedildi/.test(await statusText()), await statusText());
      // Tekrar kilitle, yaz ve hemen kapat: yedek diskte kalmali (restore asamasi bunu acar)
      await fs.chmod(path.join(vault, "Kilitli.md"), 0o444);
      await key("End", ["control"]);
      await type(" KAPANIRKEN-ENGELLI");
      log.push(`yakalanmamış hatalar: ${JSON.stringify(await js("window.__errors || []"))}`);
    } catch (e) {
      log.push(`SMOKE HATA: ${String(e)}`);
    }
    win.on("closed", () => {
      check("kapanırken yazılamayan not yedekte kalır", draftTexts().some((t) => t.includes("KAPANIRKEN-ENGELLI")), JSON.stringify(draftTexts()));
      writeFileSync(path.join(outDir, `log-${phase}.txt`), log.join("\n"), "utf8");
    });
    win.close();
    return;
  }
  if (phase === "restore") {
    try {
      await wait(4000);
      check("açılışta yedek geri yüklenir ve kaydedilir", read("Kilitli.md").includes("KAPANIRKEN-ENGELLI"), read("Kilitli.md").slice(-60));
      check("geri yüklemeden sonra taslak silinir", draftTexts().length === 0, JSON.stringify(draftTexts()));
      log.push(`yakalanmamış hatalar: ${JSON.stringify(await js("window.__errors || []"))}`);
    } catch (e) {
      log.push(`SMOKE HATA: ${String(e)}`);
    }
    await fs.writeFile(path.join(outDir, `log-${phase}.txt`), log.join("\n"), "utf8");
    win.close();
    return;
  }
  if (phase !== "full") {
    try {
      await wait(2500);
      const groups = await groupTabs();
      const focused = await js(`[...document.querySelectorAll('.group-bar')].findIndex(b => b.classList.contains('focused'))`);
      if (phase === "legacy") {
        check("eski oturum biçimi tek bölmede açılır", groups.length === 1 && groups[0].length === 2, JSON.stringify(groups));
      } else {
        check("bölmeler yeniden açılınca geri gelir", groups.length === 2 && groups[1].includes("Görevler"), JSON.stringify(groups));
        check("odaktaki bölme hatırlanır", focused === 1, `odak: ${focused}`);
      }
      await shot(`${phase}-oturum`);
      log.push(`yakalanmamış hatalar: ${JSON.stringify(await js("window.__errors || []"))}`);
    } catch (e) {
      log.push(`SMOKE HATA: ${String(e)}`);
    }
    await fs.writeFile(path.join(outDir, `log-${phase}.txt`), log.join("\n"), "utf8");
    win.close();
    return;
  }

  try {
    win.focus();
    await wait(2500);
    await shot("01-hosgeldin");
    await key("E", ["control"]);
    await wait(2000);
    await shot("02-hosgeldin-okuma");

    // --- gorev panosu
    await key("B", ["control", "alt"]);
    await wait(1200);
    await shot("03-pano");
    const added = await js(`(() => { const b = document.querySelector('.board-col .board-add'); b?.click(); return !!b; })()`);
    await wait(300);
    await type("Smoke testi kartı #test");
    await key("Return");
    await key("Escape");
    await wait(1200);
    check("panoya kart ekleme", added && read("Görevler.md").includes("- [ ] Smoke testi kartı #test"));
    // ilk sutundaki ilk karti surukle-birak ile "Bitti" sutununa tasi
    const moved = await js(`(() => {
      const cols = [...document.querySelectorAll('.board-col')];
      const card = cols[0]?.querySelector('.card');
      const done = cols.find(c => /Bitti/.test(c.querySelector('.board-col-title')?.textContent || ''));
      if (!card || !done) return false;
      const dt = new DataTransfer();
      card.dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer: dt }));
      const r = done.getBoundingClientRect();
      const opts = { bubbles: true, cancelable: true, dataTransfer: dt, clientX: r.left + 20, clientY: r.bottom - 10 };
      done.dispatchEvent(new DragEvent('dragover', opts));
      done.dispatchEvent(new DragEvent('drop', opts));
      return true;
    })()`);
    await waitFor(() => /- \[x\] Giriş ekranı için/.test(read("Görevler.md").split("## Bitti")[1] ?? ""));
    const board = read("Görevler.md");
    const bitti = board.slice(board.indexOf("## Bitti"));
    check("kartı sürükleyip Bitti'ye taşıma", moved && /- \[x\] Giriş ekranı için/.test(bitti), "taşınan kart işaretlendi mi");
    await shot("04-pano-sonra");

    // satir ekle: pano sutun x satir izgarasina gecer, eski kartlar "Satirsiz" satirinda kalir
    await js(`document.querySelector('.board-head-actions .btn')?.click()`);
    await wait(400);
    await type("Marketing");
    await key("Return");
    await wait(1200);
    const lanes = await js(`[...document.querySelectorAll('.board-row-title')].map(r => r.textContent)`);
    check("panoya satır ekleme", /### Marketing/.test(read("Görevler.md")) && JSON.stringify(lanes) === '["Satırsız","Marketing"]', JSON.stringify(lanes));
    const addedRow = await js(`(() => { const b = document.querySelector('.board-cell[data-row="Marketing"] .board-add'); b?.click(); return !!b; })()`);
    await wait(300);
    await type("Satır kartı");
    await key("Return");
    await key("Escape");
    await wait(1200);
    const yapilacak = read("Görevler.md").split("## Yapılıyor")[0];
    check("satırdaki hücreye kart ekleme", addedRow && /### Marketing\n- \[ \] Satır kartı/.test(yapilacak), yapilacak.slice(-120));
    // satirsiz bir karti Bitti sutununun Marketing hucresine surukle
    const movedRow = await js(`(() => {
      const card = document.querySelector('.board-cell[data-row=""] .card');
      const cells = [...document.querySelectorAll('.board-cell[data-row="Marketing"]')];
      const target = cells[cells.length - 1];
      if (!card || !target) return false;
      const dt = new DataTransfer();
      card.dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer: dt }));
      const r = target.getBoundingClientRect();
      const opts = { bubbles: true, cancelable: true, dataTransfer: dt, clientX: r.left + 20, clientY: r.bottom - 10 };
      target.dispatchEvent(new DragEvent('dragover', opts));
      target.dispatchEvent(new DragEvent('drop', opts));
      return true;
    })()`);
    await waitFor(() => /### Marketing\n- \[x\] /.test(read("Görevler.md").split("## Bitti")[1] ?? ""));
    const bittiRow = read("Görevler.md").split("## Bitti")[1] ?? "";
    check("kartı başka satır + sütuna sürükleme", movedRow && /### Marketing\n- \[x\] /.test(bittiRow), bittiRow.slice(0, 200));
    await shot("04b-pano-satirlar");

    // --- kod parcalari
    await key("S", ["control", "alt"]);
    await wait(1500);
    await shot("05-parcalar");
    await clipboard.writeText("");
    await js(`document.querySelector('.snip-detail .btn.primary')?.click()`);
    await wait(500);
    const clip = await clipboard.readText();
    check("parçayı panoya kopyalama", clip.length > 20, `${clip.length} karakter`);

    // --- kod dosyasi duzenleme
    await openQuick("debounce");
    await key("End", ["control"]);
    await type("// smoke");
    await wait(1500);
    check("kod dosyası otomatik kaydetme", read("Parçalar/debounce.ts").includes("// smoke"));
    await shot("06-kod-dosyasi");

    // --- HTTP
    await key("H", ["control", "alt"]);
    await wait(1200);
    await js(`document.querySelector('.btn.send')?.click()`);
    let status = "";
    for (let i = 0; i < 30 && !status; i++) {
      await wait(500);
      status = await js(`document.querySelector('.response .status')?.textContent || document.querySelector('.response-error')?.textContent || ''`);
    }
    check("HTTP isteği gönderme (httpbin.org)", /^200/.test(status.trim()), status.trim() || "yanıt yok");
    await shot("07-http");

    // --- araclar
    await key("A", ["control", "alt"]);
    await wait(1000);
    await js(`document.querySelector('.tool .btn.primary')?.click()`);
    await wait(600);
    const json = await js(`document.querySelectorAll('.tool .cm-content')[1]?.textContent || ''`);
    check("JSON biçimlendirme", json.includes('"ad": "Atölye"'));
    await shot("08-araclar-json");
    await js(`[...document.querySelectorAll('.tool-item')].find(b => b.textContent.includes('Regex'))?.click()`);
    await wait(500);
    const regexCount = await js(`document.querySelectorAll('.regex-preview mark').length`);
    check("regex eşleşmeleri", regexCount === 2, `${regexCount} eşleşme`);
    await shot("09-araclar-regex");
    await js(`[...document.querySelectorAll('.tool-item')].find(b => b.textContent.includes('Karşılaştır'))?.click()`);
    await wait(500);
    const diffParts = await js(`document.querySelectorAll('.diff-out .d-add, .diff-out .d-del').length`);
    check("metin karşılaştırma", diffParts >= 2, `${diffParts} fark parçası`);
    await shot("10-araclar-diff");

    // --- grafik ve komut paleti
    await key("G", ["control", "shift"]);
    await wait(2500);
    await shot("11-grafik");
    await key("P", ["control"]);
    await type("http");
    await wait(400);
    await shot("12-komut-paleti");
    await key("Escape");

    // --- yan yana bolmeler
    const DRAWING = "Mimari taslak.excalidraw";
    await openQuick("Sistem mimarisi");
    await js(`document.querySelector('.group-actions .icon-btn')?.click()`);
    await wait(900);
    let groups = await groupTabs();
    check("sağa bölme: iki bölmede aynı not", groups.length === 2 && groups[1].includes("Sistem mimarisi"), JSON.stringify(groups));
    await key("End", ["control"]);
    await type(" BOLME");
    await wait(1500);
    const synced = await js(
      `[...document.querySelectorAll('.view')].filter(v => v.style.display !== 'none').filter(v => (v.querySelector('.cm-content')?.textContent || '').includes('BOLME')).length`,
    );
    check("bir bölmede yazılan diğerinde görünür ve kaydedilir", synced === 2 && read("Mimari/Sistem mimarisi.md").includes("BOLME"), `${synced} editör`);
    await shot("13-bolmeler");

    // cizimi sag bolmede yeni sekmede ac, sonra sekmesini sol bolmeye surukle: cizim yeniden yuklenmemeli
    await key("O", ["control"]);
    await type("Mimari taslak");
    await key("Return", ["control"]);
    await wait(3000);
    const marked = await js(`(() => {
      const v = [...document.querySelectorAll('.view')].find(v => v.style.display !== 'none' && v.querySelector('.excalidraw'));
      window.__drawingView = v;
      return !!v;
    })()`);
    await js(`(() => {
      const bars = document.querySelectorAll('.group-bar .tabbar');
      const tab = [...bars[1].querySelectorAll('.tab')].find(t => t.textContent.includes('Mimari taslak'));
      const dt = new DataTransfer();
      tab.dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer: dt }));
      const o = { bubbles: true, cancelable: true, dataTransfer: dt };
      bars[0].dispatchEvent(new DragEvent('dragover', o));
      bars[0].dispatchEvent(new DragEvent('drop', o));
      tab.dispatchEvent(new DragEvent('dragend', { bubbles: true, dataTransfer: dt }));
    })()`);
    await wait(1200);
    groups = await groupTabs();
    const sameDrawing = await js(`(() => {
      const v = window.__drawingView;
      return !!v && v.isConnected && v.style.display !== 'none' && !!v.querySelector('.excalidraw canvas')
        && v.style.gridColumn.startsWith('1');
    })()`);
    check(
      "sekmeyi sürükleyip diğer bölmeye taşıma (çizim yeniden yüklenmez)",
      marked && sameDrawing && groups.length === 2 && groups[0].includes(DRAWING) && !groups[1].includes(DRAWING),
      `${JSON.stringify(groups)} işaretli=${marked} aynı-görünüm=${sameDrawing}`,
    );
    await shot("14-cizim-tasindi");

    // ayiriciyi gercek fareyle sola surukle
    const sp = await js(`(() => { const r = document.querySelector('.group-splitter').getBoundingClientRect(); return { x: Math.round(r.left), y: Math.round(r.top + r.height / 2) }; })()`);
    const w0 = await js(`document.querySelectorAll('.group-bar')[0].getBoundingClientRect().width`);
    wc.sendInputEvent({ type: "mouseDown", x: sp.x, y: sp.y, button: "left", clickCount: 1 });
    for (let i = 1; i <= 10; i++) {
      wc.sendInputEvent({ type: "mouseMove", x: sp.x - i * 15, y: sp.y, modifiers: ["leftbuttondown"] });
      await wait(30);
    }
    wc.sendInputEvent({ type: "mouseUp", x: sp.x - 150, y: sp.y, button: "left", clickCount: 1 });
    await wait(600);
    const w1 = await js(`document.querySelectorAll('.group-bar')[0].getBoundingClientRect().width`);
    check("ayırıcıyla bölme genişliği değiştirme", Math.abs(w0 - 150 - w1) < 25, `${Math.round(w0)} → ${Math.round(w1)} px`);

    // klavye: Ctrl+1 sol bolmeye gec, Ctrl+Alt+Sag etkin sekmeyi saga tasi
    await key("1", ["control"]);
    const focus1 = await js(`[...document.querySelectorAll('.group-bar')].findIndex(b => b.classList.contains('focused'))`);
    await key("Right", ["control", "alt"]);
    await wait(800);
    groups = await groupTabs();
    check("Ctrl+1 ve Ctrl+Alt+Sağ", focus1 === 0 && groups[1].includes(DRAWING) && !groups[0].includes(DRAWING), `${JSON.stringify(groups)} odak=${focus1}`);

    // kenar cubugundan dosyayi en sagdaki bolmenin sag kenarina birak: yeni bolme
    await js(`(() => {
      const row = [...document.querySelectorAll('.tree-row')].find(r => r.title === 'Görevler.md');
      const dt = new DataTransfer();
      window.__fileDt = dt;
      window.__fileRow = row;
      row.dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer: dt }));
      document.body.dispatchEvent(new DragEvent('dragenter', { bubbles: true, dataTransfer: dt }));
    })()`);
    await wait(400);
    await js(`(() => {
      const zones = document.querySelectorAll('.drop-zone');
      const z = zones[zones.length - 1];
      const r = z.getBoundingClientRect();
      const o = { bubbles: true, cancelable: true, dataTransfer: window.__fileDt, clientX: r.right - 8, clientY: r.top + r.height / 2 };
      z.dispatchEvent(new DragEvent('dragover', o));
      z.dispatchEvent(new DragEvent('drop', o));
      window.__fileRow.dispatchEvent(new DragEvent('dragend', { bubbles: true, dataTransfer: window.__fileDt }));
    })()`);
    await wait(1200);
    groups = await groupTabs();
    const zonesLeft = await js(`document.querySelectorAll('.drop-zone').length`);
    check("dosyayı sürükleyip bölmenin sağına bırakma", groups.length === 3 && groups[2].includes("Görevler") && zonesLeft === 0, JSON.stringify(groups));
    await shot("15-uc-bolme");

    // ortadaki bolmeyi kapat: iki bolme kalir, odak komsuya gecer
    await js(`document.querySelectorAll('.group-bar')[1].querySelector('.group-actions .icon-btn:last-child').click()`);
    await wait(800);
    groups = await groupTabs();
    check("bölmeyi kapatma", groups.length === 2 && groups[1].includes("Görevler"), JSON.stringify(groups));
    // kapanan bolmenin yeri bos kalmamali: kalan bolmeler tum genisligi doldurur
    const [usedW, fullW] = await js(`(() => {
      const g = document.querySelector('.groups');
      const used = [...g.querySelectorAll(':scope > .group-bar, :scope > .group-splitter')].reduce((n, b) => n + b.getBoundingClientRect().width, 0);
      return [Math.round(used), Math.round(g.getBoundingClientRect().width)];
    })()`);
    check("bölme kapanınca kalanlar alanı doldurur", usedW >= fullW - 4, `${usedW} / ${fullW} px`);
    await js(`document.querySelectorAll('.group-bar')[1].querySelector('.tab').dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0 }))`);
    await wait(300);

    // uygulamadan yeni gorev panosu olustur
    await key("N", ["control", "alt"]);
    await wait(400);
    await type("Proje panosu");
    await key("Return");
    await wait(1500);
    // dosya odaktaki notun klasorune olusur
    const newBoardRel = (readdirSync(vault, { recursive: true }) as string[]).find((f) => path.basename(f) === "Proje panosu.md") ?? "Proje panosu.md";
    const newBoardFile = read(newBoardRel);
    const boardShown = await js(`[...document.querySelectorAll('.view')].some(v => v.style.display !== 'none' && v.querySelector('.board .board-col'))`);
    check("yeni görev panosu oluşturma", /atolye: board/.test(newBoardFile) && /## Yapılacak/.test(newBoardFile) && boardShown, newBoardFile.slice(0, 60));
    await shot("16-yeni-pano");
    await key("W", ["control"]);
    await wait(500);

    log.push(`yakalanmamış hatalar: ${JSON.stringify(await js("window.__errors || []"))}`);
  } catch (e) {
    log.push(`SMOKE HATA: ${String(e)}`);
  }
  await fs.writeFile(path.join(outDir, "log.txt"), log.join("\n"), "utf8");

  // --- kapanirken kaydetme: yaz ve hemen kapat
  try {
    // odaktaki (sag) bolmede yeni sekmede ac: Gorevler sekmesi bolmede kalsin (geri yukleme asamasi bunu denetler)
    await key("O", ["control"]);
    await type("Sistem mimarisi");
    await key("Return", ["control"]);
    await wait(800);
    await key("End", ["control"]);
    await type(" KAPANIS");
    win.on("closed", () => {
      const ok = read("Mimari/Sistem mimarisi.md").includes("KAPANIS");
      writeFileSync(path.join(outDir, "log.txt"), `${log.join("\n")}\n${ok ? "GEÇTİ" : "KALDI"}  kapanırken kaydetme`, "utf8");
    });
    win.close();
  } catch {
    app.quit();
  }
}
