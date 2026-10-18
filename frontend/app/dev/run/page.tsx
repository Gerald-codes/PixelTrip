import { notFound } from "next/navigation";

import { DevRunConsole } from "@/features/dev-console/DevRunConsole";

/**
 * Developer test console for the AI agent runs.
 *
 * Hidden (a normal 404) unless `NEXT_PUBLIC_ENABLE_DEV_CONSOLE=true`, which
 * `run-local.sh` sets for local development. `NEXT_PUBLIC_*` values are inlined at
 * build time, so a production build without the flag does not contain a reachable
 * console.
 */
export default function DevRunPage() {
  if (process.env.NEXT_PUBLIC_ENABLE_DEV_CONSOLE !== "true") {
    notFound();
  }
  return <DevRunConsole />;
}
