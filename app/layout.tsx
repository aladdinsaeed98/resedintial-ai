/**
 * Root layout for the live page. Display only: no forms, no buttons.
 *
 * Data flow ends here: GET /api/readings -> LivePage -> these tiles.
 */

import type { Metadata } from "next";

import "./globals.css";

export const metadata: Metadata = {
  title: "HVAC monitor",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
