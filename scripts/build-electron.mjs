// Ana surec ve preload'u tek dosyalik CommonJS paketlerine derler.
import { build } from "esbuild";

const common = {
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node22",
  external: ["electron"],
  sourcemap: false,
  minify: true,
  logLevel: "warning",
};

await Promise.all([
  build({ ...common, entryPoints: ["electron/main.ts"], outfile: "dist-electron/main.js" }),
  build({ ...common, entryPoints: ["electron/preload.ts"], outfile: "dist-electron/preload.js" }),
]);
console.log("electron: ok");
