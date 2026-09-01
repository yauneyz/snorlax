import { hexToRgbChannels, paletteVariableName, type PaletteColorName } from '@talysman/shared';

/**
 * The desktop app's action-signal colors, distinct from the landing page's lime. This is the
 * one place to change them — both the CSS custom properties (for Tailwind's `signal`/`seal`
 * utilities) and the raw hex values (for call sites that need a literal, like inline SVG fills
 * or `<canvas>`) come from here, so nothing can drift out of sync with the other.
 */
const DESKTOP_SIGNAL_OVERRIDES = {
  signal: '#2dd9ee',
  signalHigh: '#8ff0fa',
  signalInk: '#031316',
} satisfies Partial<Record<PaletteColorName, string>>;

export function desktopPaletteColor(name: keyof typeof DESKTOP_SIGNAL_OVERRIDES): string {
  return DESKTOP_SIGNAL_OVERRIDES[name];
}

/** Applies the desktop overrides on top of the shared palette's CSS variables. */
export function applyDesktopPaletteOverrides(element: HTMLElement): void {
  for (const [name, hex] of Object.entries(DESKTOP_SIGNAL_OVERRIDES)) {
    element.style.setProperty(paletteVariableName(name as PaletteColorName), hexToRgbChannels(hex));
  }
}
