import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./app/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./lib/**/*.{js,ts}",
  ],
  theme: {
    extend: {
      colors: {
        "pt-deep": "#0F1B2E",
        "pt-card": "#162032",
        "pt-card-hover": "#1C2B42",
        "pt-navy": "#1E3A5F",
        "pt-sky": "#38BDF8",
        "pt-teal": "#4FD1C5",
        "pt-purple": "#A78BFA",
        "pt-neon-purple": "#A855F7",
        "pt-orange": "#FB923C",
        "pt-cyan": "#67E8F9",
        "pt-green": "#4ADE80",
        "pt-sand": "#FEF3C7",
        "pt-cream": "#E8ECF1",
        "pt-gold": "#FBBF24",
        "pt-error": "#F87171",
        "pt-info": "#60A5FA",
      },
      fontFamily: {
        pixel: ["'Press Start 2P'", "monospace"],
        body: ["'Inter'", "system-ui", "-apple-system", "sans-serif"],
        mono: ["'Courier New'", "Courier", "monospace"],
      },
      boxShadow: {
        "pixel": "4px 4px 0 #1E3A5F",
        "pixel-sm": "2px 2px 0 #1E3A5F",
        "pixel-card": "0 2px 8px rgba(0,0,0,0.35)",
        "pixel-bubble": "0 1px 4px rgba(0,0,0,0.25)",
      },
      borderRadius: {
        "pixel": "0px",
      },
      animation: {
        "pixel-bounce": "pixelBounce 0.7s ease-in-out infinite",
        "pixel-pulse": "pixelPulse 1.3s ease-in-out infinite",
        "pixel-wave": "pixelWave 1s ease-in-out infinite",
      },
      keyframes: {
        pixelBounce: {
          "0%, 100%": { transform: "translateY(0)" },
          "50%": { transform: "translateY(-4px)" },
        },
        pixelPulse: {
          "0%, 100%": { transform: "scale(1)", opacity: "1" },
          "50%": { transform: "scale(1.05)", opacity: "0.65" },
        },
        pixelWave: {
          "0%, 100%": { transform: "rotate(-12deg)" },
          "50%": { transform: "rotate(12deg)" },
        },
      },
    },
  },
  plugins: [],
};

export default config;
