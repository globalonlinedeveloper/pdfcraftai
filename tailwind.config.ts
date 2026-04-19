import type { Config } from "tailwindcss";

// Tokens are driven by CSS variables in app/globals.css so dark/light
// switches at runtime without re-building.
const config: Config = {
  content: [
    "./app/**/*.{ts,tsx,mdx}",
    "./components/**/*.{ts,tsx}",
    "./lib/**/*.{ts,tsx}",
  ],
  darkMode: ["class", "[data-theme='dark']"],
  theme: {
    container: {
      center: true,
      padding: "28px",
      screens: {
        "2xl": "1280px",
      },
    },
    extend: {
      colors: {
        bg: "var(--bg)",
        "bg-1": "var(--bg-1)",
        "bg-2": "var(--bg-2)",
        "bg-3": "var(--bg-3)",
        border: "var(--border)",
        "border-strong": "var(--border-strong)",
        fg: "var(--fg)",
        "fg-muted": "var(--fg-muted)",
        "fg-subtle": "var(--fg-subtle)",
        accent: "var(--accent)",
        "accent-fg": "var(--accent-fg)",
        "accent-soft": "var(--accent-soft)",
        "brand-blue": "var(--blue)",
        "brand-blue-soft": "var(--blue-soft)",
        "brand-green": "var(--green)",
        "brand-green-soft": "var(--green-soft)",
        "brand-red": "var(--red)",
        "brand-yellow": "var(--yellow)",
      },
      fontFamily: {
        sans: ["var(--font-geist-sans)", "Inter", "ui-sans-serif", "system-ui", "sans-serif"],
        mono: ["var(--font-geist-mono)", "ui-monospace", "SF Mono", "Menlo", "monospace"],
      },
      borderRadius: {
        sm: "6px",
        DEFAULT: "8px",
        lg: "14px",
      },
      boxShadow: {
        sm: "var(--shadow-sm)",
        DEFAULT: "var(--shadow)",
        lg: "var(--shadow-lg)",
      },
      keyframes: {
        fadeIn: {
          from: { opacity: "0", transform: "translateY(6px)" },
          to: { opacity: "1", transform: "none" },
        },
      },
      animation: {
        "fade-in": "fadeIn .25s ease-out both",
      },
    },
  },
  plugins: [],
};

export default config;
