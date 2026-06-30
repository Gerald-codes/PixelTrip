import { Suspense } from "react";

import LandingForm from "./LandingForm";

/**
 * Landing page entry. The form uses useSearchParams (to read ?join=CODE from
 * invite links), which Next.js 14 requires to be wrapped in a Suspense
 * boundary — without it the production build fails to prerender.
 */
export default function Home() {
  return (
    <Suspense
      fallback={
        /* Hero gradient matches LandingForm so there's no flash on load */
        <main className="flex min-h-screen items-center justify-center bg-gradient-to-br from-[#1E3A5F] to-[#38BDF8] p-8">
          <p className="font-bold text-[#FEF3C7]">Loading…</p>
        </main>
      }
    >
      <LandingForm />
    </Suspense>
  );
}
