import type { Config } from 'tailwindcss';
export default {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['"IBM Plex Sans Arabic"', 'Cairo', 'system-ui', 'sans-serif'],
        display: ['Cairo', '"IBM Plex Sans Arabic"', 'sans-serif'],
      },
      colors: {
        ink: { 950: '#07111f', 900: '#0b1a2e', 800: '#11253f', 700: '#1a3354', 600: '#2a4a73' },
        gold: { 300: '#f3d98b', 400: '#e9c45a', 500: '#d4a72c', 600: '#b0861b' },
        teal: { 400: '#2dd4bf', 500: '#14b8a6', 600: '#0d9488' },
      },
      keyframes: {
        pop: { '0%': { transform: 'scale(.6)', opacity: '0' }, '60%': { transform: 'scale(1.06)', opacity: '1' }, '100%': { transform: 'scale(1)' } },
        glow: { '0%,100%': { boxShadow: '0 0 0 0 rgba(233,196,90,0)' }, '50%': { boxShadow: '0 0 80px 10px rgba(233,196,90,.35)' } },
      },
      animation: { pop: 'pop .7s cubic-bezier(.2,.9,.3,1.2)', glow: 'glow 1.6s ease-in-out 4' },
    },
  },
  plugins: [],
} satisfies Config;
