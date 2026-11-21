/**
 * Clerk sign-up. Public. Keep this home-only: one owner account is enough.
 */

import { SignUp } from "@clerk/nextjs";

export const dynamic = "force-dynamic";

export default function SignUpPage() {
  return (
    <main>
      <h1>HVAC monitor</h1>
      <p className="sub">Create the owner account. This app cannot change the equipment.</p>
      <SignUp />
    </main>
  );
}
