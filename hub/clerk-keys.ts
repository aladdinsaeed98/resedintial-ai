/**
 * Detect whether Clerk env looks real.
 *
 * Kept in its own file so middleware (Edge) can call it without pulling
 * node:crypto from hub/auth.ts. Placeholder keys from .env.example /
 * .env.production must read as "not configured" so `next build` works.
 */

export function clerkKeysConfigured(
  env: Record<string, string | undefined> = process.env,
): boolean {
  const publishable = env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY?.trim() ?? "";
  const secret = env.CLERK_SECRET_KEY?.trim() ?? "";
  if (publishable.length < 20 || secret.length < 20) {
    return false;
  }
  if (
    /placeholder|paste_from|your_/i.test(publishable) ||
    /placeholder|paste_from|your_/i.test(secret)
  ) {
    return false;
  }
  return publishable.startsWith("pk_") && secret.startsWith("sk_");
}
