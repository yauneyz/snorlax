import { resolve } from 'node:path';
import desktop from '../desktop/tailwind.config.js';

/**
 * The desktop app's Tailwind config, unchanged, so the real renderer components look exactly as
 * they do in the app. Only `content` is widened (and made absolute) to cover the compositions.
 */
/** @type {import('tailwindcss').Config} */
export default {
  ...desktop,
  content: [
    resolve(import.meta.dirname, '../desktop/src/renderer/**/*.{ts,tsx}'),
    resolve(import.meta.dirname, 'src/**/*.{ts,tsx}'),
  ],
};
