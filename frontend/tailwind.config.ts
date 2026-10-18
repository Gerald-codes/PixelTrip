import type { Config } from "tailwindcss";
import plugin from "tailwindcss/plugin";

/**
 * Tailwind CSS configuration for the PixelArt Trip Planner frontend.
 *
 * Foundation scope:
 *  - Task 2.2 wired Tailwind so utility classes produce styles at build time
 *    (the `content` globs below scan the App Router entry files under `app/`
 *    and all feature/component source under `src/`).
 *  - Task 4 (this change) populates `theme.extend` with the pixel design tokens
 *    from `pixel-design-system.md`: the ten color roles, an 8px-multiple spacing
 *    scale, the `display`/`body` font roles, and a pixelated `image-rendering`
 *    utility.
 *
 * These tokens are the single styling source of truth. Components consume them
 * via utility classes (e.g. `bg-bg`, `text-ink`, `p-16`, `font-display`,
 * `image-rendering-pixelated`) and never use raw hex or arbitrary pixel values.
 *
 * Palette — a cohesive, high-contrast 8-bit retro RPG set (chosen once, fixed):
 *   bg            #1a1c2c  deep midnight base background
 *   bg-alt        #29366f  panel / dialogue-box background
 *   ink           #f4f4f4  primary text on dark surfaces
 *   primary       #41a6f6  main action blue
 *   primary-dark  #3b5dc9  pressed/darker action blue
 *   accent        #ffcd75  gold highlight / XP-bar element
 *   success        #38b764  status: success / confirmed
 *   warning        #ef7d57  status: warning / caution
 *   danger        #b13e53  status: danger / destructive
 *   muted         #566c86  borders, disabled states (never text: too dim on panels)
 *
 * Text-only roles, added so small text passes 4.5:1 on both `bg` and `bg-alt`:
 *   subtle        #a9b8d4  secondary / helper text
 *   alert         #ff8fa3  error text (`danger` stays the fill for destructive buttons)
 * `success` and `warning` were lightened slightly for the same reason.
 */
const config: Config = {
  content: [
    "./app/**/*.{ts,tsx}",
    "./src/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        bg: "#1a1c2c",
        "bg-alt": "#29366f",
        ink: "#f4f4f4",
        primary: "#41a6f6",
        "primary-dark": "#3b5dc9",
        accent: "#ffcd75",
        success: "#4fd07e",
        warning: "#f59a7a",
        danger: "#b13e53",
        muted: "#566c86",
        subtle: "#a9b8d4",
        alert: "#ff8fa3",
      },
      // 8px base grid: spacing in multiples of 8 (8/16/24/32 required; extra
      // 8-multiples provided for convenient layout on the pixel grid).
      spacing: {
        "8": "8px",
        "16": "16px",
        "24": "24px",
        "32": "32px",
        "40": "40px",
        "48": "48px",
        "64": "64px",
      },
      // Stepped (not smooth) motion so loaders feel like 8-bit sprites. Pair every
      // use with `motion-reduce:animate-none`.
      keyframes: {
        "pixel-dot": {
          "0%, 100%": { opacity: "0.25" },
          "50%": { opacity: "1" },
        },
        "pixel-scan": {
          "0%": { transform: "translateX(-100%)" },
          "100%": { transform: "translateX(400%)" },
        },
        // Eyes closed for ~4% of the cycle: a quick idle blink.
        // A card arriving in the sidebar: three hard steps up into place.
        "pixel-pop": {
          "0%": { opacity: "0", transform: "translateY(8px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
        "pixel-blink": {
          "0%, 93%, 100%": { opacity: "0" },
          "95%, 98%": { opacity: "1" },
        },
      },
      animation: {
        "pixel-dot": "pixel-dot 1.2s steps(2, jump-none) infinite",
        "pixel-scan": "pixel-scan 1.6s steps(10) infinite",
        "pixel-blink": "pixel-blink 4.5s steps(1, end) infinite",
        "pixel-pop": "pixel-pop 240ms steps(3, end) both",
      },
      // Type scale for the display (monospace) face, used on headings, labels and
      // buttons; body copy stays in the readable face.
      fontSize: {
        "pixel-xs": ["16px", { lineHeight: "20px" }],
        "pixel-sm": ["20px", { lineHeight: "24px" }],
        // A question in a form: a step above its answers (20px), below a title.
        "pixel-q": ["24px", { lineHeight: "28px" }],
        // Title sizes are whole multiples of VT323's 16px pixel grid, so its strokes
        // land on whole pixels and stay crisp.
        "pixel-md": ["32px", { lineHeight: "32px" }],
        "pixel-lg": ["48px", { lineHeight: "48px" }],
        "pixel-xl": ["64px", { lineHeight: "64px" }],
      },
      // Hard-edged drop shadows: depth without blur, like a sprite's outline.
      boxShadow: {
        "pixel-sm": "2px 2px 0 0 #0d0e17",
        pixel: "4px 4px 0 0 #0d0e17",
      },
      fontFamily: {
        // Pixel/bitmap display font for headings and NPC dialogue.
        // VT323: a terminal-style pixel face. `title` is for page, party and section
        // names; `display` for labels and buttons. Same face, different sizes.
        title: ["var(--font-pixel)", "ui-monospace", "Menlo", "monospace"],
        display: ["var(--font-pixel)", "ui-monospace", "Menlo", "monospace"],
        // Legible body font for longer copy (readability over theme).
        body: ["var(--font-body)", "system-ui", "sans-serif"],
      },
    },
  },
  plugins: [
    // Expose a pixelated image-rendering utility so pixel-art sprites scale with
    // hard edges (integer scaling), per the pixel design system's crisp-scaling
    // principle. Usage: <img class="image-rendering-pixelated" ... />
    plugin(({ addUtilities }) => {
      addUtilities({
        ".image-rendering-pixelated": {
          "image-rendering": "pixelated",
        },
        ".image-rendering-crisp-edges": {
          "image-rendering": "crisp-edges",
        },
      });
    }),
  ],
};

export default config;
