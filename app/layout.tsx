/**
 * Root layout. Clerk wraps the tree when keys are real.
 *
 * Placeholder env (empty .env.production, no .env.local yet) skips Clerk so
 * `next build` does not need an account. The dashboard is still monitor-only.
 */

import type { Metadata } from "next";
import { ClerkProvider } from "@clerk/nextjs";

import { clerkKeysConfigured } from "@/hub/clerk-keys";

import "./globals.css";

export const metadata: Metadata = {
  title: "HVAC monitor",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const tree = (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
  if (!clerkKeysConfigured()) {
    return tree;
  }
  return <ClerkProvider>{tree}</ClerkProvider>;
}
