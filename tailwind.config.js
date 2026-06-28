/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        surface: {
          900: "rgb(var(--s900) / <alpha-value>)",
          800: "rgb(var(--s800) / <alpha-value>)",
          700: "rgb(var(--s700) / <alpha-value>)",
          600: "rgb(var(--s600) / <alpha-value>)",
          500: "rgb(var(--s500) / <alpha-value>)",
        },
        accent: {
          DEFAULT: "rgb(var(--accent) / <alpha-value>)",
          hover: "rgb(var(--accent-hov) / <alpha-value>)",
        },
        danger: "#ef4444",
        success: "#22c55e",
        warning: "#f59e0b",
        muted: "rgb(var(--muted) / <alpha-value>)",
      },
      fontFamily: {
        mono: ["'JetBrains Mono'", "Consolas", "monospace"],
      },
    },
  },
  plugins: [],
};
