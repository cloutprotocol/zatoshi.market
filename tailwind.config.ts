import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      backgroundImage: {
        "gradient-radial": "radial-gradient(var(--tw-gradient-stops))",
        "gradient-conic":
          "conic-gradient(from 180deg at 50% 50%, var(--tw-gradient-stops))",
      },
      animation: {
        'dither': 'dither 0.5s steps(4) infinite',
      },
      keyframes: {
        dither: {
          '0%, 100%': { backgroundPosition: '0px 0px' },
          '25%': { backgroundPosition: '1px 0px' },
          '50%': { backgroundPosition: '0px 1px' },
          '75%': { backgroundPosition: '1px 1px' },
        },
      },
    },
  },
  plugins: [],
};
export default config;
