---
inclusion: fileMatch
fileMatchPattern: '{app,src/components,src/features,styles}/**/*.{tsx,ts,css}'
---

# Pixel Design System

The visual language is a cohesive 8-bit retro RPG. Every UI surface should feel like it
belongs in the same game.

## Visual Identity

- Cooperative adventure aesthetic: dialogue boxes, decision cards, sprites, party framing.
- Chunky, deliberate, low-resolution look. Nothing glossy or gradient-heavy.
- Consistency over novelty: reuse the same primitives everywhere.

## 8-bit Design Principles

- **Pixel grid.** Lay out on an 8px base grid; spacing in multiples of 8 (8/16/24/32).
- **Hard edges.** No soft shadows, no rounded blurs, no smooth gradients. Borders are
  solid and blocky.
- **Limited palette.** Use the defined color set below rather than arbitrary colors.
- **Crisp scaling.** Pixel art uses `image-rendering: pixelated` (Tailwind's
  `image-rendering` utility or a theme extension) and integer scaling only.
- **Stepped motion.** Animation is frame-based/stepped, not smoothly eased.

## Styling Approach

Styling uses **Tailwind CSS**. Design tokens (colours, spacing, fonts) are defined in the
Tailwind theme config and consumed via utility classes. Do not use raw hex or arbitrary
pixel values in components — extend the Tailwind theme with named tokens instead. Reusable
class combinations live in the shared component primitives, not copied per feature.

## Colour System

Define a small, named palette as Tailwind theme tokens and use those tokens, never raw
hex, in components. Recommended roles (final hex chosen once, then fixed):
- `bg` / `bg-alt` — base and panel backgrounds.
- `ink` — primary text.
- `primary` / `primary-dark` — main action / accents.
- `accent` — highlights, XP-bar style elements.
- `success`, `warning`, `danger` — status colors.
- `muted` — borders, disabled states.
- `subtle` — secondary and helper **text**. Use this, not `muted`, for text: `muted` is
  too dim to read on panels (2.1:1).
- `alert` — error **text**. `danger` stays the fill for destructive buttons.

Every text and background pair must reach 4.5:1. Buttons already do: dark `bg` text on
`primary`, `accent` and `success` fills; light `ink` text on `danger`.

### Type scale

Two faces. VT323, a terminal-style pixel face, is used for titles (`font-title`) and
for labels and buttons (`font-display`). Inter (`font-body`) is used for anything longer
than a label. Both are loaded in `app/layout.tsx` with `next/font`.

- `font-display` defaults to 20px. VT323 draws small for its size and has one weight:
  never bold it (a faked bold smears the pixels).
- Titles use `text-pixel-md` (32px, section headings), `text-pixel-lg` (48px, the party
  name) and `text-pixel-xl` (64px, the product name): whole multiples of the font's 16px
  pixel grid, so it stays crisp.
- Tried and dropped: Press Start 2P everywhere (too hard to read) and Pixelify Sans on
  titles.

### Depth, press and icons

- Depth is a hard offset shadow, never a blur: `shadow-pixel` (4px) on cards and dialogue
  boxes, `shadow-pixel-sm` (2px) on buttons.
- `PixelButton` renders its label in capitals, brightens on hover and sinks into its
  shadow while pressed. A disabled button is flat and dim. `PixelCard` titles are capitals
  in `accent`.
- No emoji. Use `PixelIcon` (8x8 bitmaps drawn in the current text colour) for small
  icons and `PixelSprite` for characters.

Keep contrast strong; retro palettes tend to be high-contrast.

## Typography

- A pixel/bitmap display font for headings and NPC dialogue.
- A legible font for longer body text (readability wins over theme for paragraphs).
- Fixed type scale on the 8px rhythm. No arbitrary font sizes.

## UI Components (primitives)

All primitives live in `src/components` and are reused across features.

### Buttons
- Blocky border, pixel corners, pressed/hover states via stepped changes.
- Variants: `primary`, `secondary`, `option` (multiple-choice), `danger`.
- Always have a clear label; icon-only buttons need an accessible label.

### Cards
- Panel with solid border. Variants:
  - **Recommendation card** — image/sprite, title, key details, action.
  - **Voting card** — options with live vote counts and a cast-vote action.
  - **Decision summary card** — the resolved choice.

### Dialogue Boxes
- NPC message container styled like a classic RPG text box.
- Optional typewriter reveal (stepped, skippable).
- Distinguish AI/NPC messages from user messages visually.

### Character Components
- **Character sprite** — renders avatar/appearance from character data.
- **Party roster** — row/grid of member sprites with names and status/presence.
- Sprites scale by integer factors only.

### Chat
- **Chat bubble** — user vs. AI styling; supports text and embedded cards.

## Animations

- Sprite idle/walk cycles, stepped.
- Card entrance, vote-count ticks, XP/progress bar fills — all stepped/frame-based.
- Respect `prefers-reduced-motion`: reduce or disable non-essential animation.

## Accessibility Considerations

- Meet WCAG AA contrast for text and interactive elements; do not rely on the retro
  palette alone to convey meaning.
- Full keyboard operability: focus order, visible focus states, Enter/Space activation.
- Semantic HTML and ARIA labels; decorative sprites use empty alt / `aria-hidden`.
- Body copy stays readable — never sacrifice legibility of paragraphs for pixel styling.
- Honor `prefers-reduced-motion`.
- Note: full WCAG conformance requires manual testing with assistive tech and expert review.
