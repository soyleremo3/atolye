/**
 * Yonetici tusu istegi (Ctrl+Alt+G ya da komut paleti). Merkez acik degilse once acilir;
 * Merkez'deki yonetici karti istegi karsilayinca onay kutusunu gosterir ve istegi temizler.
 * Kucuk ayri modul: kisayol Merkez'i (tembel yuklenen ekran) yuklemeden calisir; istek ekran
 * sonradan acilsa da kaybolmaz.
 */
import { create } from "zustand";

export const useManagerRun = create<{ pending: number }>(() => ({ pending: 0 }));

export function requestManagerRun(): void {
  useManagerRun.setState((s) => ({ pending: s.pending + 1 }));
}

export function takeManagerRun(): boolean {
  if (!useManagerRun.getState().pending) return false;
  useManagerRun.setState({ pending: 0 });
  return true;
}
