import type { Config } from "tailwindcss";

const config: Config = {
  darkMode: "class",
  content: [
    "./pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      fontFamily: {
        mono: ["'JetBrains Mono'", "monospace"],
        sans: ["'DM Sans'", "sans-serif"],
      },
      colors: {
        bg: "#0a0b0f",
        surface: "#111318",
        border: "#1e2130",
        accent: "#7c6af7",
        "accent-dim": "#5748d4",
        muted: "#4a4f6a",
        text: "#e2e4f0",
        "text-dim": "#8b90a8",
      },
    },
  },
  plugins: [],
};
export default config;
