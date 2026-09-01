import paletteDocument from './palette.json';

export const palette = paletteDocument;
export type PaletteColorName = keyof typeof palette.colors;

/** CSS custom-property spelling shared by the server-rendered web shell and Electron. */
export function paletteVariableName(name: PaletteColorName): `--color-${string}` {
  return `--color-${name.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)}`;
}

/** Convert the canonical #rrggbb value into modern CSS rgb channel syntax (`r g b`). */
export function hexToRgbChannels(hex: string): string {
  const match = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  if (!match) throw new Error(`Palette color must use #rrggbb: ${hex}`);
  return `${Number.parseInt(match[1]!, 16)} ${Number.parseInt(match[2]!, 16)} ${Number.parseInt(match[3]!, 16)}`;
}

export function paletteCssVariables(): Record<`--color-${string}`, string> {
  return Object.fromEntries(
    Object.entries(palette.colors).map(([name, value]) => [
      paletteVariableName(name as PaletteColorName),
      hexToRgbChannels(value),
    ]),
  );
}

export function applyPaletteVariables(element: HTMLElement): void {
  for (const [name, value] of Object.entries(paletteCssVariables())) {
    element.style.setProperty(name, value);
  }
}

export function paletteColor(name: PaletteColorName): string {
  return palette.colors[name];
}

const profileColors = palette.profileColors.map(
  (name) => palette.colors[name as PaletteColorName],
);

export const PROFILE_COLORS: readonly [string, ...string[]] = [
  profileColors[0]!,
  ...profileColors.slice(1),
];
