/**
 * La paleta del lienzo de diseño, y solo eso.
 *
 * Los valores son los mismos que la web (paper, honey, monad…) porque es la
 * misma marca; la configuración es propia porque la app no hereda ni el
 * espaciado, ni las sombras, ni los componentes de la web.
 */
/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        paper: '#121019',
        cream: '#1A1726',
        sand: '#232035',
        line: '#342E4A',
        noche: '#14111E',
        ink: { DEFAULT: '#F2EFFA', 2: '#C8C3DC', 3: '#948DAE' },
        honey: { DEFAULT: '#E29A2E', deep: '#D9982B', soft: '#2E2510', line: '#4A3A18' },
        olive: '#92A268',
        terra: '#C9653B',
        monad: { DEFAULT: '#836EF9', deep: '#6A4FF0', mist: '#B7A8FC' },
      },
      fontFamily: {
        display: ['"Space Grotesk"', 'system-ui', 'sans-serif'],
        sans: ['Inter', 'system-ui', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'ui-monospace', 'monospace'],
      },
      backgroundImage: {
        monad: 'linear-gradient(120deg, #836ef9 0%, #6a4ff0 55%, #5b3de8 100%)',
      },
      boxShadow: {
        monad: '0 1px 0 rgba(255,255,255,.22) inset, 0 8px 24px -8px rgba(131,110,249,.55)',
        hoja: '0 -12px 40px -8px rgba(0,0,0,.6)',
      },
    },
  },
  plugins: [],
};
