/**
 * Dashboard session check. Clerk when configured; open in local tests/build.
 *
 * GET /api/readings and GET /api/alerts call this. A missing session is 401, not a redirect
 * (fetch from the live page). Middleware still redirects document requests
 * to sign-in when Clerk keys are real.
 */

export type AuthLookup = () => Promise<{ userId: string | null }>;

let authLookup: AuthLookup | undefined;

/** Tests inject a fake Clerk auth() here. */
export function setAuthLookup(lookup: AuthLookup | undefined): void {
  authLookup = lookup;
}

export async function dashboardUserId(): Promise<string | null | "skipped"> {
  const { clerkKeysConfigured } = await import("./clerk-keys");
  if (!clerkKeysConfigured()) {
    return "skipped";
  }
  if (authLookup) {
    const session = await authLookup();
    return session.userId;
  }
  const { auth } = await import("@clerk/nextjs/server");
  const session = await auth();
  return session.userId ?? null;
}
