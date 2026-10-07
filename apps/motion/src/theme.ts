import { palette } from '@talysman/shared';

/** Every color in a composition comes from the shared palette. */
export const c = palette.colors;

export const FPS = 30;
export const WIDTH = 1920;
export const HEIGHT = 1080;

export const fonts = {
  sans: '"Space Grotesk Variable", ui-sans-serif, system-ui, sans-serif',
  mono: '"JetBrains Mono Variable", ui-monospace, monospace',
};

/** Seconds → frames. Scripts are written in seconds; Remotion counts frames. */
export const s = (seconds: number) => Math.round(seconds * FPS);

/** `rgba()` from a palette hex, for glows and scrims. */
export function alpha(hex: string, a: number): string {
  const n = Number.parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
}
