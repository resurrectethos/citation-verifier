/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        primary: '#4f46e5',
        secondary: '#10b981',
        accent: '#f97316',
        neutral: '#1f2937',
        'neutral-content': '#d1d5db',
        'base-100': '#111827',
        'base-200': '#1f2937',
        'base-300': '#374151',
        'base-content': '#f9fafb',
      },
      fontFamily: {
        sans: ['Inter', 'sans-serif'],
      },
    },
  },
  plugins: [],
}
