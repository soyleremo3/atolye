/** Ilk acilista kasaya konan ornek icerik: notlar, pano, kod parcalari, istekler, cizim ve sablonlar. */

const box = (id: string, x: number, y: number, w: number, h: number, bg: string) => ({
  id, type: "rectangle", x, y, width: w, height: h, angle: 0, strokeColor: "#1e1e1e", backgroundColor: bg,
  fillStyle: "solid", strokeWidth: 2, strokeStyle: "solid", roughness: 1, opacity: 100, roundness: { type: 3 },
  seed: 1, version: 1, versionNonce: 1, isDeleted: false, groupIds: [], boundElements: [], locked: false,
});
const text = (id: string, x: number, y: number, t: string, size = 20) => ({
  id, type: "text", x, y, width: t.length * size * 0.55, height: size * 1.25, angle: 0, strokeColor: "#1e1e1e",
  backgroundColor: "transparent", fillStyle: "solid", strokeWidth: 1, strokeStyle: "solid", roughness: 1, opacity: 100,
  seed: 2, version: 1, versionNonce: 1, isDeleted: false, groupIds: [], boundElements: [], locked: false,
  text: t, originalText: t, fontSize: size, fontFamily: 5, textAlign: "left", verticalAlign: "top", lineHeight: 1.25,
  containerId: null, autoResize: true,
});
const arrow = (id: string, x: number, y: number, dx: number, dy: number) => ({
  id, type: "arrow", x, y, width: Math.abs(dx), height: Math.abs(dy), angle: 0, strokeColor: "#1e1e1e",
  backgroundColor: "transparent", fillStyle: "solid", strokeWidth: 2, strokeStyle: "solid", roughness: 1, opacity: 100,
  seed: 3, version: 1, versionNonce: 1, isDeleted: false, groupIds: [], boundElements: [], locked: false,
  points: [[0, 0], [dx, dy]], startArrowhead: null, endArrowhead: "arrow", startBinding: null, endBinding: null,
});

const DRAWING = {
  type: "excalidraw",
  version: 2,
  source: "atolye",
  elements: [
    box("w", 0, 0, 190, 80, "#a5d8ff"), text("wt", 45, 28, "Web / Mobil"),
    box("a", 300, 0, 190, 80, "#b2f2bb"), text("at", 365, 28, "API"),
    box("d", 600, 0, 190, 80, "#ffec99"), text("dt", 640, 28, "PostgreSQL"),
    box("q", 300, 160, 190, 80, "#ffc9c9"), text("qt", 340, 188, "Kuyruk"),
    arrow("wa", 195, 40, 100, 0), arrow("ad", 495, 40, 100, 0), arrow("aq", 395, 85, 0, 70),
    text("n", 0, 280, "Taslak: tıkla, sürükle, yaz — otomatik kaydedilir.", 16),
  ],
  appState: { viewBackgroundColor: "#ffffff", gridSize: null },
  files: {},
};

export const WELCOME_FILES: Record<string, string> = {
  "Atölye'ye hoş geldin.md": `# Atölye'ye hoş geldin 🛠️

Atölye; yazılım notların, **kod parçaların**, **görevlerin**, **HTTP isteklerin** ve **geliştirici araçların** için tek bir yerel çalışma alanı.
Her şey bu bilgisayarda düz dosyalar olarak durur: notlar \`.md\`, parçalar gerçek kaynak dosyaları, istekler \`.http\`.

## Beş bölüm (soldaki şerit)
| | Ne işe yarar | Kısayol |
|---|---|---|
| 📝 Notlar | Markdown, \`[[bağlantılar]]\`, Mermaid şemaları, çizimler | \`Ctrl+N\` |
| 🧩 Kod parçaları | Ara, etiketle, tek tıkla kopyala | \`Ctrl+Alt+S\` |
| 📋 Görev panosu | Sürükle-bırak Kanban (Markdown'a kaydedilir) | \`Ctrl+Alt+B\` |
| 🌐 HTTP istekleri | REST Client uyumlu \`.http\` dosyaları | \`Ctrl+Alt+H\` |
| 🔧 Araçlar | JSON, Regex, JWT, Base64, diff, UUID… | \`Ctrl+Alt+A\` |

\`Ctrl+P\` komut paleti, \`Ctrl+O\` hızlı aç (her dosya türü), \`Ctrl+Shift+F\` tüm notlarda ara.

## Başlamak için
- [[Sistem mimarisi]] — Mermaid ile kodla şema
- [[ADR-001 Veritabanı seçimi]] — mimari karar kaydı örneği
- [[Görevler]] — proje panosu
- Çizim: ![[Çizimler/Mimari taslak.excalidraw]]

> [!tip] İpucu
> \`Ctrl+Alt+T\` ile şablondan not oluştur: ADR, hata raporu, API dokümanı, kod incelemesi…

#başlangıç
`,
  "Mimari/Sistem mimarisi.md": `# Sistem mimarisi

#mimari

\`\`\`mermaid
flowchart LR
  U[Kullanıcı] --> W[Web / Mobil]
  W -->|HTTPS + JWT| A[API]
  A --> D[(PostgreSQL)]
  A --> C[(Redis önbellek)]
  A --> Q[[Kuyruk]]
  Q --> J[İş işleyici]
\`\`\`

## Bileşenler
- **API:** durumsuz, yatay ölçeklenir. Kararı: [[ADR-001 Veritabanı seçimi]]
- **Kuyruk:** e-posta ve rapor gibi uzun işler

\`\`\`mermaid
sequenceDiagram
  participant İstemci
  participant API
  participant DB as Veritabanı
  İstemci->>API: POST /siparis
  API->>DB: INSERT
  DB-->>API: id
  API-->>İstemci: 201 Created
\`\`\`
`,
  "Kararlar/ADR-001 Veritabanı seçimi.md": `# ADR-001: Veritabanı seçimi

#adr #mimari
**Durum:** Kabul edildi · **Tarih:** 2026-10-25

## Bağlam
İlişkisel veri, işlem (transaction) ihtiyacı ve raporlama sorguları var.

## Karar
**PostgreSQL** kullanılacak.

## Sonuçlar
- ✅ Güçlü tutarlılık, JSONB, olgun araçlar
- ⚠️ Yatay ölçeklemek için okuma kopyaları gerekecek

İlgili: [[Sistem mimarisi]]
`,
  "Görevler.md": `---
atolye: board
---

## Yapılacak
- [ ] Giriş ekranı için \`/auth/login\` uç noktasını yaz #backend
- [ ] [[Sistem mimarisi]] notunu güncelle #doküman
- [ ] Hata kayıtlarını merkezileştir #ops

## Yapılıyor
- [ ] Sipariş listesini sayfalama ile getir #frontend

## Bitti
- [x] [[ADR-001 Veritabanı seçimi]] kararını yaz
- [x] Proje iskeletini oluştur
`,
  "Parçalar/debounce.ts": `/** Ardisik cagrilari birlestirir: son cagridan "ms" sonra bir kez calistirir. */
export function debounce<T extends (...args: never[]) => void>(fn: T, ms = 300) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return (...args: Parameters<T>) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  };
}
`,
  "Parçalar/useLocalStorage.tsx": `import { useEffect, useState } from "react";

/** localStorage ile senkron React durumu. */
export function useLocalStorage<T>(key: string, initial: T) {
  const [value, setValue] = useState<T>(() => {
    try {
      const raw = localStorage.getItem(key);
      return raw ? (JSON.parse(raw) as T) : initial;
    } catch {
      return initial;
    }
  });
  useEffect(() => {
    localStorage.setItem(key, JSON.stringify(value));
  }, [key, value]);
  return [value, setValue] as const;
}
`,
  "Parçalar/retry_with_backoff.py": `import random
import time


def retry(fn, attempts=5, base=0.5, cap=8.0):
    """Ustel geri cekilme + rastgele sapma ile yeniden dene."""
    for i in range(attempts):
        try:
            return fn()
        except Exception:
            if i == attempts - 1:
                raise
            time.sleep(min(cap, base * 2 ** i) * random.uniform(0.5, 1.0))
`,
  "Parçalar/docker-compose.yml": `services:
  db:
    image: postgres:17
    environment:
      POSTGRES_PASSWORD: gelistirme
    ports: ["5432:5432"]
    volumes: [pgdata:/var/lib/postgresql/data]
  redis:
    image: redis:7
    ports: ["6379:6379"]
volumes:
  pgdata:
`,
  "Parçalar/git-kisayollari.sh": `# Son commit mesajini duzelt (henuz push edilmediyse)
git commit --amend

# Dal gecmisini tek satirda, grafikle goster
git log --oneline --graph --decorate --all

# Calisma alanindaki degisiklikleri gecici olarak sakla / geri al
git stash push -m "yarim is"
git stash pop

# Uzak dalda silinmis yerel dallari temizle
git fetch --prune
`,
  ".atolye/parcalar.json": JSON.stringify(
    {
      "Parçalar/debounce.ts": { desc: "Ardışık çağrıları birleştir", tags: ["typescript", "performans"] },
      "Parçalar/useLocalStorage.tsx": { desc: "localStorage ile kalıcı React durumu", tags: ["react", "hooks"] },
      "Parçalar/retry_with_backoff.py": { desc: "Üstel geri çekilmeyle yeniden deneme", tags: ["python", "ağ"] },
      "Parçalar/docker-compose.yml": { desc: "Yerel PostgreSQL + Redis", tags: ["docker", "veritabanı"] },
      "Parçalar/git-kisayollari.sh": { desc: "Sık kullanılan git komutları", tags: ["git", "terminal"] },
    },
    null,
    2,
  ),
  "İstekler/Örnek API.http": `@baseUrl = https://httpbin.org

### Basit GET
GET {{baseUrl}}/get?kaynak=atolye
Accept: application/json

### JSON gövdeli POST
POST {{baseUrl}}/post
Content-Type: application/json

{
  "ad": "Atölye",
  "sürüm": 1
}

### GitHub deposu bilgisi
GET https://api.github.com/repos/microsoft/vscode
Accept: application/vnd.github+json
`,
  "Çizimler/Mimari taslak.excalidraw": JSON.stringify(DRAWING, null, 2),
  "Şablonlar/ADR.md": `# ADR-XXX: {{title}}

#adr
**Durum:** Önerildi · **Tarih:** {{date}}

## Bağlam

## Karar

## Alternatifler
-

## Sonuçlar
-
`,
  "Şablonlar/Hata raporu.md": `# Hata: {{title}}

#hata
**Tarih:** {{date}} · **Önem:** orta

## Adımlar
1.

## Beklenen

## Gerçekleşen

## Ortam
- Sürüm:
- İşletim sistemi:

## Kayıtlar
\`\`\`text

\`\`\`
`,
  "Şablonlar/API dokümanı.md": `# {{title}}

#api
\`GET /kaynak/{id}\`

## İstek
| Parametre | Tür | Zorunlu | Açıklama |
|---|---|---|---|
| id | string | evet | |

## Yanıt
\`\`\`json
{
}
\`\`\`

## Hatalar
| Kod | Anlam |
|---|---|
| 404 | Bulunamadı |
`,
  "Şablonlar/Kod incelemesi.md": `# İnceleme: {{title}}

#inceleme
**Tarih:** {{date}} · **PR:**

## Özet

## Kontrol listesi
- [ ] Testler var ve geçiyor
- [ ] Hata durumları ele alınmış
- [ ] Güvenlik (girdi doğrulama, yetki) kontrol edildi
- [ ] Gereksiz karmaşıklık yok

## Yorumlar
-
`,
  "Şablonlar/Toplantı.md": `# {{title}}

**Tarih:** {{date}} · **Katılımcılar:**

## Gündem
1.

## Kararlar
-

## Aksiyonlar
- [ ]
`,
  "Şablonlar/Günlük.md": `# {{date}}

## Dün
-

## Bugün
- [ ]

## Engeller
-
`,
};
