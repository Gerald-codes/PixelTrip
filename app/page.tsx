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
        <main className="flex min-h-screen items-center justify-center p-8">
          <p className="text-gray-600">Loading…</p>
        </main>
      }
    >
      <LandingForm />
    </Suspense>
  );
}
