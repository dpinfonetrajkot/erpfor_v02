import type { SessionUser, UserPreferences } from '@bht/shared';

/** Last applied look, read by the small script in the root layout before the first paint. */
export const UI_CACHE_KEY = 'erp.ui';

export interface UiLook {
  font: string;
  accent: string;
  textSize: string;
}

/** The look to show: the user's own choice, else the company default, else the built-in one. */
export function effectiveLook(user: Pick<SessionUser, 'preferences' | 'appearance'>, override?: Partial<UserPreferences>): UiLook {
  const p = { ...user.preferences, ...override };
  return {
    font: p.font ?? user.appearance.font ?? 'jakarta',
    accent: p.accent ?? user.appearance.accent ?? 'blue',
    textSize: p.textSize ?? 'md',
  };
}

/** Puts the look on <html> (data-font / data-accent / data-size) and remembers it for the next page load. */
export function applyLook(look: UiLook) {
  if (typeof document === 'undefined') return;
  const d = document.documentElement;
  const set = (attr: string, value: string, base: string) => (value && value !== base ? d.setAttribute(attr, value) : d.removeAttribute(attr));
  set('data-font', look.font, 'jakarta');
  set('data-accent', look.accent, 'blue');
  set('data-size', look.textSize, 'md');
  try {
    localStorage.setItem(UI_CACHE_KEY, JSON.stringify({ font: look.font !== 'jakarta' ? look.font : undefined, accent: look.accent !== 'blue' ? look.accent : undefined, textSize: look.textSize !== 'md' ? look.textSize : undefined }));
  } catch {
    /* storage unavailable */
  }
}

/** CSS font-family of each choice, for previews on the Settings screen. */
export const FONT_FAMILY: Record<string, string> = {
  geist: 'var(--font-geist)',
  inter: 'var(--font-inter)',
  jakarta: 'var(--font-jakarta)',
  manrope: 'var(--font-manrope)',
  plex: 'var(--font-plex)',
  dm: 'var(--font-dm)',
  nunito: 'var(--font-nunito)',
  poppins: 'var(--font-poppins)',
  system: "ui-sans-serif, system-ui, -apple-system, 'Segoe UI', sans-serif",
};
