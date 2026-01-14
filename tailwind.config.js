/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['"Inter"', 'ui-sans-serif', 'system-ui', 'sans-serif'],
      },
      colors: {
        board: {
          bg: '#0a0f1e',
          zone: '#111827',
          border: '#1f2937',
          hover: '#1e2a3a',
        },
        clan: {
          crab:       '#3b6fd4',
          crane:      '#7eb8d4',
          dragon:     '#3dac6e',
          lion:       '#c9a227',
          phoenix:    '#d4523b',
          scorpion:   '#9b3d6e',
          unicorn:    '#8b5cf6',
          mantis:     '#4db87e',
          shadowlands:'#6b7280',
        },
      },
    },
  },
  plugins: [],
};
