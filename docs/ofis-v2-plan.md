# Ajan Ofisi v2 planı (2026-11-22)

Sahibin geri bildirimi: v1 basit, renkler iç açıcı değil, animasyon ve verinin canlı olduğu belli değil.
Referans: selmakcby/ajan-ofisi demosu (yalnız görsel inceleme; lisans ticari kullanıma kapalı,
kod ve görsel kopyalanmadı, her şey sıfırdan yazıldı).

## Referanstan çıkan tasarım ilkeleri

1. Sıcak krem arka plan, kalın kenarlı bir masa maketi (diorama) üstünde ofis.
2. Her ajan kendi küçük odası: iki renkli duvar (arka + sol), krem zemin, desenli halı, eşya.
3. İzometrik (ortografik) kamera, yumuşak gölge, doygun ama pastel renkler; siyah yok.
4. Alçak poligonlu ağaç/bitki, duvar çerçeveleri, raf, sunucu dolabı, beyaz tahta.
5. Oda adı zemine yazılı; üstte buzlu cam bilgi kartı: ad + "uyuyor · son iş …" ya da "● çalışıyor: …".
6. Kenarlarda: selamlama/özet kartı, onay listesi (Onayla / Sonra), canlı hareket akışı, "N ajan çalışıyor".
7. Çalışan ajana yöneticiden turuncu ışık noktaları akar (iş gidiyor hissi).

## Bizim uyarlamamız (köpek)

- Sevimli oranlar: büyük yuvarlak kafa, kısa bacak, tasma + künye (Claude turuncu, Google mavi).
- Durumlar yumuşak geçişle (anında atlamaz):
  uyuyor = köpek yatağında kıvrılmış, nefes alır, "z" harfleri yükselir ·
  çalışıyor = sandalyede laptopa bakar, patileri yazar, ekran parlar, iş noktaları akar ·
  bitti = kuyruk sallar, bir kez zıplar, kartta yeşil ✓ · takıldı = kafa eğik, turuncu "!" ·
  hata = kulaklar düşük, kart kırmızı · planlı = soluk oda, "planlı" etiketi.
- Ekip renk aileleri: Yönetim mercan, Developer mavi-mor, Satış sarı-turuncu, Genel yeşil-turkuaz.

## Veri doğruluğu (canlılık)

- Kaynak: ajan reposundaki `roller/*/durum.json`, onaylar, git günlüğü. Uydurma veri yok.
- Ofis açıkken her 60 sn `git pull` (eskisi 5 dk); yeni veri gelince sahne yalnız değişen köpeği günceller.
- "Hemen çalıştır" olayları anında yansır (çalışan köpek, kartta canlı araç adı).
- Bulut yöneticisi işe başlarken kendi ve işçinin durumunu `working` yapıp gönderir (playbook'a eklendi),
  böylece bulut işleri de ~1 dk içinde ofiste görünür.

## Performans

- Ortografik kamera, gölge haritası bir kez (değişince) güncellenir, piksel oranı ≤ 1.5,
  görünüm gizliyken çizim durur, geometri/malzeme paylaşılır.

## Adımlar

1. Sahne motoru v2 (maket, odalar, eşya, köpek, animasyon, ışık noktaları, HTML kartlar).
2. Ofis ekranı düzeni (özet kartı, onay listesi, canlı akış, üst şerit).
3. Veri: 60 sn eşitleme, olay akışı, yönetici playbook'u.
4. Duman testi: canlı durum değişikliği köpeğe yansıyor mu (dosya değiştir → poz değişir).
5. Paketle, sahibe göster.
