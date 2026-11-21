/**
 * Later-phase screen. Styled like the rest of the app, no features yet.
 */

import { PLACEHOLDER_COPY } from "@/lib/screens";

export function PlaceholderPage({ title }: { title: string }) {
  return (
    <section className="page fade-in">
      <header className="page-header">
        <p className="micro-label">Later phase</p>
        <h1>{title}</h1>
      </header>
      <div className="panel glass">
        <p className="sub">{PLACEHOLDER_COPY}</p>
      </div>
    </section>
  );
}
