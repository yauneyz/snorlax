import { hexToRgbChannels, paletteColor, paletteVariableName, type PaletteColorName } from '@talysman/shared';

/**
 * The desktop app's action-signal colors, distinct from the landing page's lime. The values live
 * in palette.json (`desktop*`); this maps them onto the shared names so both the CSS custom
 * properties (for Tailwind's `signal`/`seal` utilities) and the raw hex values (for call sites
 * that need a literal, like inline SVG fills or `<canvas>`) come from one place.
 */
const DESKTOP_SIGNAL_OVERRIDES = {
  signal: paletteColor('desktopSignal'),
  signalHigh: paletteColor('desktopSignalHigh'),
  signalInk: paletteColor('desktopSignalInk'),
  background: paletteColor('desktopBackground'),
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
