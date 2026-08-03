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
        // Historical near-black surfaces from the pre-redesign palette.
        bg: '#08090a',
        panel: '#0e0f11',
        panel2: '#16181b',
        border: '#26292e',
        // Keep the current semantic API while restoring silver as the product accent.
        seal: '#c7ccd4',
        sealInk: '#f2f3f5',
        ok: '#22c55e',
        okInk: '#4ade80',
        warn: '#f59e0b',
        danger: '#ef4444',
        dangerInk: '#f87171',
        // Silver, not indigo. `accentInk` is the dark text that sits on top of it.
        accent: '#c7ccd4',
        accentInk: '#0a0b0d',
        // Neutral ramp shadowing Tailwind's `slate` so the existing text-slate-*
        // usage reads silver-grey instead of blue-grey, with no call-site churn.
        slate: {
          50: '#fafafa',
          100: '#f2f3f5',
          150: '#e8eaee',
          200: '#dcdee2',
          250: '#c7ccd4',
          300: '#b8bcc4',
          400: '#8b9098',
          450: '#5a5f67',
          500: '#676c74',
          600: '#4d5158',
          700: '#3a3d43',
          800: '#26292e',
          900: '#17191c',
          950: '#0e0f11',
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
