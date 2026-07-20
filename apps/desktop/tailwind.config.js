/** @type {import('tailwindcss').Config} */
export default {
  content: ['./src/renderer/index.html', './src/renderer/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        bg: '#08090a',
        panel: '#0e0f11',
        panel2: '#16181b',
        border: '#26292e',
        ok: '#22c55e',
        danger: '#ef4444',
        // Silver, not indigo. `accentInk` is the dark text that sits on top of it.
        accent: '#c7ccd4',
        accentInk: '#0a0b0d',
        // Neutral ramp shadowing Tailwind's `slate` so the existing text-slate-*
        // usage reads silver-grey instead of blue-grey, with no call-site churn.
        slate: {
          50: '#fafafa',
          100: '#f2f3f5',
          200: '#dcdee2',
          300: '#b8bcc4',
          400: '#8b9098',
          500: '#676c74',
          600: '#4d5158',
          700: '#3a3d43',
          800: '#26292e',
          900: '#17191c',
          950: '#0e0f11',
        },
      },
    },
  },
  plugins: [],
};
