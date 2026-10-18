import type { Metadata } from "next";
import { IBM_Plex_Sans, VT323 } from "next/font/google";
import type { ReactNode } from "react";
import "./globals.css";

/**
 * Root layout for the PixelArt Trip Planner App Router.
 *
 * Thin composition only: imports the Tailwind entry stylesheet and defines the
 * root <html>/<body>. No business logic, no data transformation, no
 * service/API calls.
 */
// Self-hosted at build time by next/font; exposed as CSS variables that the
// Tailwind font roles read. Titles, labels and buttons use VT323, a terminal-style
// pixel face that stays readable; longer text uses IBM Plex Sans, whose squared,
// engineered letterforms sit well beside a terminal face.
const pixel = VT323({
  weight: "400",
  subsets: ["latin"],
  variable: "--font-pixel",
  display: "swap",
});
const body = IBM_Plex_Sans({
  weight: ["400", "500", "600"],
  subsets: ["latin"],
  variable: "--font-body",
  display: "swap",
});

export const metadata: Metadata = {
  title: "PixelTrip",
  description:
    "Gather your party and plan your next adventure — an 8-bit collaborative trip planner.",
};

export default function RootLayout({
  children,
}: {
  children: ReactNode;
}) {
  return (
    <html lang="en" className={`${pixel.variable} ${body.variable}`}>
      <body>{children}</body>
    </html>
  );
}
