import type { Config } from "tailwindcss";
import animate from "tailwindcss-animate";

/**
 * Verity design tokens.
 * Light mode default; dark mode via the `class` strategy + next-themes.
 */
export default {
  darkMode: ["class"],
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    container: {
      center: true,
      padding: "1rem",
      screens: {
        "2xl": "1400px",
      },
    },
    extend: {
      colors: {
        // Semantic CSS-variable-driven palette (toggles with theme)
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        muted: {
          DEFAULT: "hsl(var(--muted))",
          foreground: "hsl(var(--muted-foreground))",
        },
        card: {
          DEFAULT: "hsl(var(--card))",
          foreground: "hsl(var(--card-foreground))",
        },
        popover: {
          DEFAULT: "hsl(var(--popover))",
          foreground: "hsl(var(--popover-foreground))",
        },
        border: "hsl(var(--border))",
        input: "hsl(var(--input))",
        ring: "hsl(var(--ring))",
        primary: {
          DEFAULT: "hsl(var(--primary))",
          foreground: "hsl(var(--primary-foreground))",
        },
        secondary: {
          DEFAULT: "hsl(var(--secondary))",
          foreground: "hsl(var(--secondary-foreground))",
        },
        accent: {
          DEFAULT: "hsl(var(--accent))",
          foreground: "hsl(var(--accent-foreground))",
        },
        destructive: {
          DEFAULT: "hsl(var(--destructive))",
          foreground: "hsl(var(--destructive-foreground))",
        },
        // Trust semantic — mapped to Tailwind's emerald/amber/rose
        // Use directly as e.g. text-ok-foreground, bg-ok-tint
        ok: {
          DEFAULT: "hsl(var(--ok))",
          foreground: "hsl(var(--ok-foreground))",
          tint: "hsl(var(--ok-tint))",
        },
        warn: {
          DEFAULT: "hsl(var(--warn))",
          foreground: "hsl(var(--warn-foreground))",
          tint: "hsl(var(--warn-tint))",
        },
        danger: {
          DEFAULT: "hsl(var(--danger))",
          foreground: "hsl(var(--danger-foreground))",
          tint: "hsl(var(--danger-tint))",
        },
        unknown: {
          DEFAULT: "hsl(var(--unknown))",
          foreground: "hsl(var(--unknown-foreground))",
        },
      },
      borderRadius: {
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)",
      },
      fontFamily: {
        sans: ["Inter", "ui-sans-serif", "system-ui", "sans-serif"],
        mono: ["JetBrains Mono", "ui-monospace", "monospace"],
      },
      fontSize: {
        // Tightened type scale.
        "display-2xl": ["48px", { lineHeight: "56px", letterSpacing: "-0.02em", fontWeight: "700" }],
        "display-xl": ["36px", { lineHeight: "44px", letterSpacing: "-0.02em", fontWeight: "700" }],
        "display-lg": ["30px", { lineHeight: "38px", letterSpacing: "-0.01em", fontWeight: "600" }],
        "display-md": ["24px", { lineHeight: "32px", letterSpacing: "-0.01em", fontWeight: "600" }],
        // Body / utility scale (overrides Tailwind defaults to lock the spec)
        xl: ["20px", { lineHeight: "28px", letterSpacing: "-0.005em", fontWeight: "600" }],
        lg: ["18px", { lineHeight: "28px", fontWeight: "500" }],
        base: ["14px", { lineHeight: "20px" }],
        sm: ["13px", { lineHeight: "18px" }],
        xs: ["12px", { lineHeight: "16px", letterSpacing: "0.005em", fontWeight: "500" }],
      },
      keyframes: {
        "fade-in": {
          from: { opacity: "0" },
          to: { opacity: "1" },
        },
        "slide-in-right": {
          from: { transform: "translateX(100%)" },
          to: { transform: "translateX(0)" },
        },
        "soft-pulse": {
          "0%, 100%": { opacity: "0.6" },
          "50%": { opacity: "1" },
        },
      },
      animation: {
        "fade-in": "fade-in 200ms ease-out",
        "slide-in-right": "slide-in-right 300ms cubic-bezier(0.16, 1, 0.3, 1)",
        "soft-pulse": "soft-pulse 2000ms ease-in-out infinite",
      },
    },
  },
  plugins: [animate],
} satisfies Config;
