/**
 * Terminal panelinin acik/kapali durumu. Ayri dosyada: panelin kendisi (xterm) ilk acilista yuklenir,
 * kisayol ve serit dugmesi ise bu kucuk modulu kullanir.
 */
import { create } from "zustand";

const LS_OPEN = "atolye.term.open";

function readOpen(): boolean {
  try {
    return localStorage.getItem(LS_OPEN) === "1";
  } catch {
    return false;
  }
}

/** request: baska bir ekrandan (Merkez) "su klasorde su terminali ac" istegi; panel karsilayinca temizler. */
export const useTerminal = create<{ open: boolean; request: { profile: string; dir: string; n: number } | null }>(() => ({
  open: readOpen(),
  request: null,
}));

let seq = 0;
/** Paneli acar ve verilen klasorde (app, agents, vault...) yeni terminal (claude, agy, codex, powershell) baslatir. */
export function requestTerminal(profile: string, dir: string): void {
  useTerminal.setState({ open: true, request: { profile, dir, n: ++seq } });
  try {
    localStorage.setItem(LS_OPEN, "1");
  } catch {
    /* yok sayilir */
  }
}

export function toggleTerminal(force?: boolean): void {
  const open = force ?? !useTerminal.getState().open;
  useTerminal.setState({ open });
  try {
    localStorage.setItem(LS_OPEN, open ? "1" : "0");
  } catch {
    /* yok sayilir */
  }
}
