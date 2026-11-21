/**
 * Signed-in app chrome. Every screen here still requires Clerk when keys
 * are configured. The shell has no write controls.
 */

import { clerkKeysConfigured } from "@/hub/clerk-keys";
import { AppShell } from "@/components/AppShell";

export const dynamic = "force-dynamic";

export default function SignedInLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return <AppShell showAccount={clerkKeysConfigured()}>{children}</AppShell>;
}
