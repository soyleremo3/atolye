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

export const useTerminal = create<{ open: boolean }>(() => ({ open: readOpen() }));

export function toggleTerminal(force?: boolean): void {
  const open = force ?? !useTerminal.getState().open;
  useTerminal.setState({ open });
  try {
    localStorage.setItem(LS_OPEN, open ? "1" : "0");
  } catch {
    /* yok sayilir */
  }
}
