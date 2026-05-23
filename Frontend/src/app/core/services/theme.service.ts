import { Injectable, signal } from '@angular/core';

export type ThemePref = 'system' | 'light' | 'dark';

/**
 * Maneja la preferencia de tema (claro / oscuro / sistema).
 * Aplica `data-theme` en <html>; el CSS de styles.scss resuelve los tokens.
 * Persiste en localStorage. El index.html ya fija el atributo antes del boot
 * para evitar parpadeo (FOUC).
 */
@Injectable({ providedIn: 'root' })
export class ThemeService {
  private readonly KEY = 'theme-pref';

  readonly theme = signal<ThemePref>(this.read());

  constructor() {
    this.apply(this.theme());
  }

  set(pref: ThemePref): void {
    this.theme.set(pref);
    try { localStorage.setItem(this.KEY, pref); } catch { /* almacenamiento no disponible */ }
    this.apply(pref);
  }

  private read(): ThemePref {
    let v: string | null = null;
    try { v = localStorage.getItem(this.KEY); } catch { /* ignore */ }
    return v === 'light' || v === 'dark' || v === 'system' ? v : 'system';
  }

  private apply(pref: ThemePref): void {
    document.documentElement.setAttribute('data-theme', pref);
  }
}
