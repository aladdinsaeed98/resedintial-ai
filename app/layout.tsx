/**
 * Root layout. Clerk wraps the tree when keys are real.
 *
 * Placeholder env (empty .env.production, no .env.local yet) skips Clerk so
 * `next build` does not need an account. The dashboard is still monitor-only.
 */

import type { Metadata, Viewport } from "next";
import { Outfit, Source_Sans_3 } from "next/font/google";
import { ClerkProvider } from "@clerk/nextjs";

import { PwaRegister } from "@/components/PwaRegister";
import { clerkKeysConfigured } from "@/hub/clerk-keys";
import { clerkAppearance } from "@/lib/clerk-appearance";

import "./globals.css";

const display = Outfit({
  subsets: ["latin"],
  variable: "--font-display",
  display: "swap",
});

const body = Source_Sans_3({
  subsets: ["latin"],
  variable: "--font-body",
  display: "swap",
});

export const metadata: Metadata = {
  title: "HVAC monitor",
  description: "Monitor-only residential HVAC dashboard. Read only.",
  applicationName: "HVAC monitor",
  appleWebApp: {
    capable: true,
    title: "HVAC",
    statusBarStyle: "black-translucent",
  },
  icons: {
    icon: [
      { url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: [{ url: "/icons/apple-touch-icon.png", sizes: "180x180" }],
  },
};

export const viewport: Viewport = {
  themeColor: "#05070c",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const tree = (
    <html lang="en" className={`${display.variable} ${body.variable}`}>
      <body>
        <PwaRegister />
        {children}
      </body>
    </html>
  );
  if (!clerkKeysConfigured()) {
    return tree;
  }
  return <ClerkProvider appearance={clerkAppearance}>{tree}</ClerkProvider>;
}
