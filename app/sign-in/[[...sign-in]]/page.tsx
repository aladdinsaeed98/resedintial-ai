/**
 * Clerk sign-in. Public. After login, Clerk sends the owner to the dashboard.
 */

import { SignIn } from "@clerk/nextjs";

export const dynamic = "force-dynamic";

export default function SignInPage() {
  return (
    <main>
      <h1>HVAC monitor</h1>
      <p className="sub">Sign in to see live readings. This app cannot change the equipment.</p>
      <SignIn />
    </main>
  );
}
