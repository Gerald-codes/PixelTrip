/**
 * PostCSS configuration for the PixelArt Trip Planner frontend.
 *
 * Wires Tailwind CSS and Autoprefixer into the build pipeline so that the
 * `@tailwind` directives in `app/globals.css` are expanded and utility classes
 * used across `app/` and `src/` produce real CSS at build time.
 *
 * ESM (`.mjs`) is used because package.json declares `"type": "module"`.
 */
const config = {
  plugins: {
    tailwindcss: {},
    autoprefixer: {},
  },
};

export default config;
