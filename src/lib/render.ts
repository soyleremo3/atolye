/** Bir notu, kasa indeksine gore cozumlenen baglantilarla HTML'e cevirir. */
import { getIndex, useStore } from "../store";
import { md, renderMarkdown, sectionOf, stripFrontmatter, type RenderEnv } from "./markdown";

export function envFor(notePath: string): RenderEnv {
  const idx = getIndex();
  const env: RenderEnv = {
    notePath,
    depth: 0,
    resolve: (target) => idx.resolver.resolve(target),
    renderNote: (path, heading, depth) => {
      const src = useStore.getState().notes[path] ?? "";
      const part = heading ? sectionOf(src, heading) : src;
      return md.render(stripFrontmatter(part), { ...env, notePath: path, depth });
    },
  };
  return env;
}

export function renderNote(notePath: string, src: string): string {
  return renderMarkdown(src, envFor(notePath));
}
