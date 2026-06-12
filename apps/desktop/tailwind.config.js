/** @type {import('tailwindcss').Config} */
export default {
  content: ['./src/renderer/index.html', './src/renderer/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        bg: '#0b0f17',
        panel: '#121826',
        panel2: '#1a2233',
        border: '#243049',
        ok: '#22c55e',
        danger: '#ef4444',
        accent: '#6366f1',
      },
    },
  },
  plugins: [],
};
