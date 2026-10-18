import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

/**
 * Vitest configuration for the frontend.
 *
 * - `@vitejs/plugin-react` enables JSX/TSX transform for React Testing Library.
 * - `environment: "jsdom"` provides a DOM for RTL and browser-ish globals.
 * - `globals: true` exposes `describe`/`it`/`expect`/`vi` without imports.
 * - The `@` alias mirrors `tsconfig.json` (`@/*` -> `./src/*`) so imports such
 *   as `@/types` and `@/services` resolve inside tests.
 *
 * Tests run single-shot via `vitest --run` (see the `test` script in
 * package.json) rather than watch mode.
 */
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./vitest.setup.ts"],
    include: ["src/**/*.{test,spec}.{ts,tsx}"],
  },
});
