/** Komut paleti ve klavye kisayollari tek listeden beslenir. */
import { api } from "../api";
import {
  activeTab, changeVault, closeTab, closeTabs, cycleTab, equalizeGroups, focusGroupAt, moveTabToSide, splitTab, flushAll, HTTP_PATH, modeOf, navigate, newDrawing, newFolder, newNote, newRequestFile,
  newSnippet, openBoard, openDaily, openGraph, openSearch, openView, renamePath, deletePath, setMode, SNIPPETS_PATH, toggleLeft,
  toggleRight, TOOLS_PATH, updateSettings, useStore,
} from "../store";
import { exportNote } from "./exporter";

export type Command = { id: string; title: string; keys?: string; run: () => void; when?: () => boolean };

const noteTab = () => {
  const t = activeTab();
  return t && t.kind === "note" ? t : null;
};
const fileTab = () => {
  const t = activeTab();
  return t && !t.path.startsWith("::") ? t : null;
};
const fontSize = (delta: number) => {
  const s = useStore.getState().settings;
  if (s) void updateSettings({ fontSize: delta === 0 ? 16 : Math.min(24, Math.max(12, s.fontSize + delta)) });
};

export const COMMANDS: Command[] = [
  { id: "note.new", title: "Yeni not", keys: "Ctrl+N", run: () => newNote() },
  { id: "drawing.new", title: "Yeni çizim / şema", keys: "Ctrl+Shift+N", run: () => newDrawing() },
  { id: "folder.new", title: "Yeni klasör", run: () => newFolder() },
  { id: "snippet.new", title: "Yeni kod parçası", run: newSnippet },
  { id: "snippets", title: "Kod parçaları kütüphanesi", keys: "Ctrl+Alt+S", run: () => openView(SNIPPETS_PATH) },
  { id: "board", title: "Görev panosu (Kanban)", keys: "Ctrl+Alt+B", run: () => void openBoard() },
  { id: "http", title: "HTTP istekleri", keys: "Ctrl+Alt+H", run: () => openView(HTTP_PATH) },
  { id: "http.new", title: "Yeni HTTP istek dosyası", run: newRequestFile },
  { id: "tools", title: "Geliştirici araçları (JSON, Regex, JWT, Base64…)", keys: "Ctrl+Alt+A", run: () => openView(TOOLS_PATH) },
  { id: "daily.open", title: "Bugünün günlük notu", keys: "Ctrl+Alt+D", run: () => void openDaily() },
  { id: "template.new", title: "Şablondan yeni not", keys: "Ctrl+Alt+T", run: () => useStore.setState({ overlay: "templates" }) },
  { id: "switcher", title: "Hızlı aç", keys: "Ctrl+O", run: () => useStore.setState({ overlay: "switcher" }) },
  { id: "palette", title: "Komut paleti", keys: "Ctrl+P", run: () => useStore.setState({ overlay: "commands" }) },
  { id: "search", title: "Tüm notlarda ara", keys: "Ctrl+Shift+F", run: () => openSearch() },
  { id: "graph", title: "Bağlantı grafiğini aç", keys: "Ctrl+Shift+G", run: openGraph },
  {
    id: "mode.toggle", title: "Okuma / düzenleme modu", keys: "Ctrl+E", when: () => !!noteTab(),
    run: () => { const t = noteTab(); if (t) setMode(t.path, modeOf(t.path) === "edit" ? "read" : "edit"); },
  },
  {
    id: "mode.split", title: "Önizlemeyle yan yana", keys: "Ctrl+\\", when: () => !!noteTab(),
    run: () => { const t = noteTab(); if (t) setMode(t.path, modeOf(t.path) === "split" ? "edit" : "split"); },
  },
  { id: "save", title: "Kaydet", keys: "Ctrl+S", run: () => void flushAll() },
  { id: "tab.close", title: "Sekmeyi kapat", keys: "Ctrl+W", run: () => { const t = activeTab(); if (t) closeTab(t.id); } },
  { id: "tab.next", title: "Sonraki sekme", keys: "Ctrl+Tab", run: () => cycleTab(1) },
  { id: "group.split", title: "Sağa böl (dosyayı yan yana aç)", when: () => !!activeTab(), run: () => { const t = activeTab(); if (t) splitTab(t.id, "right"); } },
  { id: "group.splitLeft", title: "Sola böl", when: () => !!activeTab(), run: () => { const t = activeTab(); if (t) splitTab(t.id, "left"); } },
  { id: "group.moveRight", title: "Sekmeyi sağdaki bölmeye taşı", keys: "Ctrl+Alt+Right", when: () => !!activeTab(), run: () => { const t = activeTab(); if (t) moveTabToSide(t.id, "right"); } },
  { id: "group.moveLeft", title: "Sekmeyi soldaki bölmeye taşı", keys: "Ctrl+Alt+Left", when: () => !!activeTab(), run: () => { const t = activeTab(); if (t) moveTabToSide(t.id, "left"); } },
  ...[1, 2, 3, 4, 5, 6].map((n) => ({ id: `group.focus${n}`, title: `${n}. bölmeye geç`, keys: `Ctrl+${n}`, run: () => focusGroupAt(n - 1) })),
  { id: "group.close", title: "Bölmeyi kapat", when: () => useStore.getState().groups.length > 1, run: () => closeTabs(useStore.getState().activeGroup) },
  { id: "group.equalize", title: "Bölme genişliklerini eşitle", when: () => useStore.getState().groups.length > 1, run: equalizeGroups },
  { id: "tab.prev", title: "Önceki sekme", keys: "Ctrl+Shift+Tab", run: () => cycleTab(-1) },
  { id: "nav.back", title: "Geri git", keys: "Alt+Left", run: () => navigate(-1) },
  { id: "nav.forward", title: "İleri git", keys: "Alt+Right", run: () => navigate(1) },
  { id: "file.rename", title: "Dosyayı yeniden adlandır", keys: "F2", when: () => !!fileTab(), run: () => { const t = fileTab(); if (t) renamePath(t.path); } },
  { id: "file.delete", title: "Dosyayı sil", when: () => !!fileTab(), run: () => { const t = fileTab(); if (t) deletePath(t.path); } },
  { id: "file.reveal", title: "Dosya Gezgini'nde göster", when: () => !!fileTab(), run: () => { const t = fileTab(); if (t) void api.vault.reveal(t.path); } },
  { id: "export.pdf", title: "PDF olarak dışa aktar", when: () => !!noteTab(), run: () => { const t = noteTab(); if (t) void exportNote(t.path, "pdf"); } },
  { id: "export.html", title: "HTML olarak dışa aktar", when: () => !!noteTab(), run: () => { const t = noteTab(); if (t) void exportNote(t.path, "html"); } },
  { id: "left.toggle", title: "Sol paneli aç / kapat", keys: "Ctrl+Shift+B", run: () => toggleLeft() },
  { id: "right.toggle", title: "Sağ paneli aç / kapat", keys: "Ctrl+Shift+R", run: toggleRight },
  { id: "tags", title: "Etiketleri göster", run: () => toggleLeft("tags") },
  { id: "font.up", title: "Yazıyı büyüt", keys: "Ctrl+=", run: () => fontSize(1) },
  { id: "font.down", title: "Yazıyı küçült", keys: "Ctrl+-", run: () => fontSize(-1) },
  { id: "font.reset", title: "Yazı boyutunu sıfırla", keys: "Ctrl+0", run: () => fontSize(0) },
  {
    id: "theme.toggle", title: "Koyu / açık tema",
    run: () => { const s = useStore.getState(); const dark = s.settings?.theme === "dark" || (s.settings?.theme !== "light" && s.systemDark); void updateSettings({ theme: dark ? "light" : "dark" }); },
  },
  { id: "settings", title: "Ayarlar", keys: "Ctrl+,", run: () => useStore.setState({ dialog: { type: "settings" } }) },
  { id: "vault.change", title: "Başka kasa (klasör) aç", run: () => void changeVault() },
  { id: "vault.folder", title: "Kasa klasörünü Gezgin'de aç", run: () => void api.vault.openFolder() },
];

/** KeyboardEvent -> "Ctrl+Shift+N" biciminde anahtar. */
export function keyOf(e: KeyboardEvent): string {
  const parts: string[] = [];
  if (e.ctrlKey || e.metaKey) parts.push("Ctrl");
  if (e.altKey) parts.push("Alt");
  if (e.shiftKey) parts.push("Shift");
  let k = e.key;
  if (k === "ArrowLeft") k = "Left";
  else if (k === "ArrowRight") k = "Right";
  else if (k === "+") k = "=";
  else if (k.length === 1) k = e.code.startsWith("Key") ? e.code.slice(3) : e.code === "Backslash" ? "\\" : e.code === "Equal" ? "=" : e.code === "Minus" ? "-" : e.code === "Comma" ? "," : e.code.startsWith("Digit") ? e.code.slice(5) : k.toUpperCase();
  parts.push(k);
  return parts.join("+");
}

export function handleGlobalKey(e: KeyboardEvent): void {
  if (e.defaultPrevented) return;
  const key = keyOf(e);
  const cmd = COMMANDS.find((c) => c.keys === key && (!c.when || c.when()));
  if (!cmd) return;
  e.preventDefault();
  cmd.run();
}
