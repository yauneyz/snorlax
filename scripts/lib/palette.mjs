import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
export const PALETTE_PATH = resolve(REPO_ROOT, 'packages/shared/src/palette.json');

export function readPalette() {
  const palette = JSON.parse(readFileSync(PALETTE_PATH, 'utf8'));
  if (!palette?.colors || !palette?.profileColors) {
    throw new Error('palette.json must define colors and profileColors');
  }
  for (const [name, value] of Object.entries(palette.colors)) {
    if (!/^#[0-9a-f]{6}$/i.test(value)) {
      throw new Error(`palette color ${name} must use #rrggbb`);
    }
  }
  for (const name of palette.profileColors) {
    if (!(name in palette.colors)) throw new Error(`unknown profile color token: ${name}`);
  }
  return palette;
}

export function paletteVariableName(name) {
  return `--color-${name.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)}`;
}

export function hexToRgbChannels(hex) {
  const match = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  if (!match) throw new Error(`invalid palette color: ${hex}`);
  return [1, 2, 3].map((index) => Number.parseInt(match[index], 16)).join(' ');
}

export function paletteCssBlock(palette = readPalette()) {
  const declarations = Object.entries(palette.colors)
    .map(([name, value]) => `  ${paletteVariableName(name)}: ${hexToRgbChannels(value)};`)
    .join('\n');
  return `:root {\n${declarations}\n}\n`;
}
