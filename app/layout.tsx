import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "PixelTrip",
  description: "Collaborative AI travel planning with 8-bit personas.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
