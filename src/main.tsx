// Excalidraw yazi tiplerini internetten degil uygulamanin icinden yukle
window.EXCALIDRAW_ASSET_PATH = `${location.origin}/`;
// Yakalanmayan hatalari topla (tani ve otomatik test icin)
window.__errors = [];
window.addEventListener("error", (e) => window.__errors!.push(String(e.message)));
window.addEventListener("unhandledrejection", (e) => window.__errors!.push(String(e.reason?.message || e.reason)));

import { createRoot } from "react-dom/client";
import "katex/dist/katex.min.css";
import "./styles/app.css";
import "./styles/markdown.css";
import "./styles/atolye.css";
import { App } from "./App";
import { init } from "./store";

createRoot(document.getElementById("root")!).render(<App />);
void init();
