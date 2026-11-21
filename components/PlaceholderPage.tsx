/**
 * Later-phase screen. Styled like the rest of the app, no features yet.
 */

import { PLACEHOLDER_COPY } from "@/lib/screens";

export function PlaceholderPage({ title }: { title: string }) {
  return (
    <section className="panel glass">
      <h1>{title}</h1>
      <p className="sub">{PLACEHOLDER_COPY}</p>
    </section>
  );
}
