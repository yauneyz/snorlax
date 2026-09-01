import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const palette = JSON.parse(
  readFileSync(resolve(import.meta.dirname, '../../packages/shared/src/palette.json'), 'utf8'),
);

const cssColor = (name) => {
  if (!(name in palette.colors)) throw new Error(`Unknown palette token: ${name}`);
  return `rgb(var(--color-${name.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)}) / <alpha-value>)`;
};

/** @type {import('tailwindcss').Config} */
export default {
  content: ['./src/renderer/index.html', './src/renderer/**/*.{ts,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['"Space Grotesk Variable"', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        mono: ['"JetBrains Mono Variable"', 'ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'],
      },
      colors: {
        bg: cssColor('background'),
        panel: cssColor('panel'),
        panel2: cssColor('panelRaised'),
        border: cssColor('border'),
        signal: cssColor('signal'),
        signalHi: cssColor('signalHigh'),
        signalInk: cssColor('signalInk'),
        seal: cssColor('signal'),
        sealInk: cssColor('signal'),
        ok: cssColor('success'),
        okInk: cssColor('successInk'),
        warn: cssColor('warning'),
        danger: cssColor('danger'),
        dangerInk: cssColor('dangerInk'),
        locked: cssColor('profileCoral'),
        lockedInk: cssColor('lockedInk'),
        accent: cssColor('signal'),
        accentInk: cssColor('signalInk'),
        // Neutral ramp shadowing Tailwind's `slate` so the existing text-slate-*
        // usage reads silver-grey instead of blue-grey, with no call-site churn.
        slate: {
          50: cssColor('neutral50'),
          100: cssColor('foregroundStrong'),
          150: cssColor('neutral150'),
          200: cssColor('foreground'),
          250: cssColor('brand'),
          300: cssColor('foregroundSoft'),
          400: cssColor('foregroundMuted'),
          450: cssColor('foregroundFaint'),
          500: cssColor('foregroundDim'),
          600: cssColor('neutral600'),
          700: cssColor('neutral700'),
          800: cssColor('border'),
          900: cssColor('neutral900'),
          950: cssColor('panel'),
        },
      },
      keyframes: {
        'tal-pulse': { '0%,100%': { opacity: '0.5' }, '50%': { opacity: '1' } },
        'tal-rise': {
          from: { transform: 'translateY(6px)', opacity: '0' },
          to: { transform: 'none', opacity: '1' },
        },
      },
      animation: {
        // Slow enough to read as "alive" rather than "loading".
        pulse: 'tal-pulse 2.6s ease-in-out infinite',
        rise: 'tal-rise 0.22s ease-out both',
        'spin-slow': 'spin 90s linear infinite',
      },
    },
  },
  plugins: [],
};
