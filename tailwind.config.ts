import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  safelist: [
    // Ensure custom gold palette utilities are always available
    { pattern: /^(bg|text|border)-gold-(50|100|200|300|400|500|600|700|800|900)$/ },
    // Common opacities we use alongside gold utilities
    { pattern: /^(bg|text|border)-gold-(100|200|300|400|500)\/([1-9]0)$/ },
    // Custom background alias
    'bg-liquid-glass',
    // Effects used across pages
    'backdrop-blur-xl',
    'animate-glow',
    'animate-shimmer',
  ],
  theme: {
    extend: {
      colors: {
        gold: {
          50: '#fffef7',
          100: '#fffbeb',
          200: '#fff4c7',
          300: '#ffeaa3',
          400: '#ffd95b',
          500: '#ffc837',
          600: '#f4a927',
          700: '#d98d1f',
          800: '#b36f1b',
          900: '#8f5719',
        },
      },
      backgroundImage: {
        "gradient-radial": "radial-gradient(var(--tw-gradient-stops))",
        "gradient-conic": "conic-gradient(from 180deg at 50% 50%, var(--tw-gradient-stops))",
        "liquid-glass": "linear-gradient(135deg, rgba(255, 200, 55, 0.3) 0%, rgba(255, 234, 163, 0.2) 50%, rgba(255, 200, 55, 0.3) 100%)",
      },
      animation: {
        'dither': 'dither 0.5s steps(4) infinite',
        'shimmer': 'shimmer 2s infinite',
        'glow': 'glow 2s ease-in-out infinite alternate',
      },
      keyframes: {
        dither: {
          '0%, 100%': { backgroundPosition: '0px 0px' },
          '25%': { backgroundPosition: '1px 0px' },
          '50%': { backgroundPosition: '0px 1px' },
          '75%': { backgroundPosition: '1px 1px' },
        },
        shimmer: {
          '0%': { backgroundPosition: '-200% center' },
          '100%': { backgroundPosition: '200% center' },
        },
        glow: {
          '0%': { boxShadow: '0 0 5px rgba(255, 200, 55, 0.5), 0 0 10px rgba(255, 200, 55, 0.3)' },
          '100%': { boxShadow: '0 0 10px rgba(255, 200, 55, 0.8), 0 0 20px rgba(255, 200, 55, 0.5), 0 0 30px rgba(255, 200, 55, 0.3)' },
        },
      },
    },
  },
  plugins: [],
};
export default config;
