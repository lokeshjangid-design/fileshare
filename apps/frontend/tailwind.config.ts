import type { Config } from 'tailwindcss';
import defaultTheme from 'tailwindcss/defaultTheme';

const config: Config = {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  darkMode: ['class', '[data-theme="dark"]'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['"SF Pro Display"', '"Plus Jakarta Sans"', ...defaultTheme.fontFamily.sans],
      },
      colors: {
        background: {
          light: '#f7f7f9',
          dark: '#05060a',
        },
        primary: '#007aff',
        secondary: '#34c759',
        accent: '#8e8efc',
      },
      boxShadow: {
        glass: '0 25px 60px rgba(5, 6, 10, 0.25)',
      },
      keyframes: {
        wiggle: {
          '0%, 100%': { transform: 'rotate(-1deg)' },
          '50%': { transform: 'rotate(1deg)' },
        },
      },
      animation: {
        wiggle: 'wiggle 6s ease-in-out infinite',
      },
    },
  },
  plugins: [],
};

export default config;
