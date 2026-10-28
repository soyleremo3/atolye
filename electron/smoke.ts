/**
 * Otomatik duman testi (sadece ATOLYE_SMOKE=<klasor> ortam degiskeni verilirse calisir).
 * Uygulamayi gercek pencerede gezer, her adimin ekran goruntusunu kaydeder, sonuclari log.txt'ye yazar ve kapanir.
 */
import { app, clipboard, type BrowserWindow } from "electron";
import { promises as fs, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function runSmoke(win: BrowserWindow, outDir: string): Promise<void> {
  await fs.mkdir(outDir, { recursive: true });
  const wc = win.webContents;
  const log: string[] = [];
  wc.on("console-message", (e) => {
    if (e.level === "error" && !/esm\.sh|subsetting|document is not defined/.test(e.message)) log.push(`[konsol hatası] ${e.message.slice(0, 300)}`);
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
    await wait(1200);
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
    await wait(1200);
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
