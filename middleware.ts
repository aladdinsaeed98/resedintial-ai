/**
 * Clerk session on every page and API route except public ones.
 *
 * Public: sign-in, sign-up, POST /api/ingest (collector secret), GET /api/health.
 * When Clerk keys are placeholders, middleware is a no-op so `next build`
 * and Vitest work without a Clerk account.
 *
 * This file stays Edge-safe: it does not import node:crypto or Prisma.
 */

import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";

import { clerkKeysConfigured } from "./hub/clerk-keys";

const isPublicRoute = createRouteMatcher([
  "/sign-in(.*)",
  "/sign-up(.*)",
  "/api/ingest(.*)",
  "/api/health(.*)",
  "/openapi.json",
]);

function passthrough() {
  return NextResponse.next();
}

export default clerkKeysConfigured()
  ? clerkMiddleware(async (auth, req) => {
      if (!isPublicRoute(req)) {
        await auth.protect();
      }
    })
  : passthrough;

export const config = {
  matcher: [
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    "/(api|trpc)(.*)",
  ],
};
