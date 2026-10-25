/** Excalidraw tabanli cizim / sema editoru (.excalidraw dosyalari). Ayri parca olarak gec yuklenir. */
import { useEffect, useRef, useState } from "react";
import { Excalidraw, getSceneVersion, serializeAsJSON } from "@excalidraw/excalidraw";
import "@excalidraw/excalidraw/index.css";
import { api } from "../api";
import { title } from "../lib/paths";
import { refreshFiles, toast, writeFile } from "../store";

type Props = { path: string; dark: boolean; active: boolean };
type Api = { scrollToContent: (target?: unknown, opts?: { fitToContent?: boolean; animate?: boolean }) => void };
type Scene = Parameters<typeof serializeAsJSON>;

export default function DrawingView({ path, dark, active }: Props) {
  const [exApi, setExApi] = useState<Api | null>(null);
  const [initial, setInitial] = useState<Record<string, unknown> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const last = useRef("");
  const version = useRef<string | null>(null);
  const pending = useRef<Scene | null>(null);
  const timer = useRef<number | undefined>(undefined);

  const save = async () => {
    window.clearTimeout(timer.current);
    const scene = pending.current;
    pending.current = null;
    if (!scene) return;
    const json = serializeAsJSON(...scene);
    if (json === last.current) return;
    last.current = json;
    if (await writeFile(path, json)) void refreshFiles();
  };

  useEffect(() => {
    let alive = true;
    api.vault
      .read(path)
      .then((raw) => {
        if (!alive) return;
        const data = raw.trim() ? JSON.parse(raw) : {};
        last.current = raw;
        setInitial({
          elements: data.elements || [],
          appState: { ...(data.appState || {}), collaborators: new Map() },
          files: data.files || {},
          scrollToContent: true,
        });
      })
      .catch((e) => setError(String(e?.message || e)));
    return () => {
      alive = false;
      void save();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path]);

  // Gizli sekmeden donunce Excalidraw boyutunu yeniden olcsun
  useEffect(() => {
    if (!active || !exApi) return;
    const id = window.setTimeout(() => window.dispatchEvent(new Event("resize")), 30);
    return () => window.clearTimeout(id);
  }, [active, exApi]);

  useEffect(() => {
    if (!exApi) return;
    const id = window.setTimeout(() => {
      window.dispatchEvent(new Event("resize"));
      exApi.scrollToContent(undefined, { fitToContent: true, animate: false });
    }, 60);
    return () => window.clearTimeout(id);
  }, [exApi]);

  if (error) return <div className="empty-state">Çizim açılamadı: {error}</div>;
  if (!initial) return <div className="empty-state">Çizim yükleniyor…</div>;

  return (
    <div className="drawing-view">
      <Excalidraw
        initialData={initial}
        excalidrawAPI={(a) => setExApi(a as unknown as Api)}
        theme={dark ? "dark" : "light"}
        langCode="tr-TR"
        name={title(path)}
        UIOptions={{ canvasActions: { loadScene: false, saveToActiveFile: false, toggleTheme: false } }}
        onChange={(elements, appState, files) => {
          // Sadece cizim degistiginde kaydet (kaydirma/yakinlastirma dosyayi degistirmesin)
          const v = `${getSceneVersion(elements)}:${Object.keys(files).length}`;
          if (version.current === null || version.current === v) {
            version.current = v;
            return;
          }
          version.current = v;
          pending.current = [elements, appState, files, "local"] as Scene;
          window.clearTimeout(timer.current);
          timer.current = window.setTimeout(() => {
            save().catch((e) => toast(String(e?.message || e), "error"));
          }, 700);
        }}
      />
    </div>
  );
}
