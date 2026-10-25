// Excalidraw yazi tiplerini uygulamaya kopyalar: cizim ekrani internet olmadan da calisir.
import { cpSync, existsSync, rmSync } from "node:fs";

const src = "node_modules/@excalidraw/excalidraw/dist/prod/fonts";
const dst = "public/fonts";
if (!existsSync(src)) throw new Error(`Bulunamadi: ${src}`);
rmSync(dst, { recursive: true, force: true });
cpSync(src, dst, { recursive: true });
console.log("fonts: ok");
