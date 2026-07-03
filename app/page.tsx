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
        <main style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", backgroundColor: "#0A1628" }}>
          <p style={{ fontFamily: "var(--pt-font-pixel)", fontSize: 9, color: "rgba(232,236,241,0.4)", letterSpacing: "0.08em" }}>
            Loading…
          </p>
        </main>
      }
    >
      <LandingForm />
    </Suspense>
  );
}
