/**
 * Ask screen placeholder until the grounded AI lands in a later PR.
 */

import { ASK_COMING_SOON } from "@/lib/screens";

export function AskPlaceholder() {
  return (
    <section className="page fade-in">
      <header className="page-header">
        <p className="micro-label">Assistant</p>
        <h1>Ask</h1>
      </header>
      <div className="ask-panel glass">
        <p className="ask-kicker">Coming soon</p>
        <p className="ask-title">AI troubleshooting</p>
        <p className="sub">{ASK_COMING_SOON}</p>
        <p className="ask-note">
          Until then, use Live for numbers and Alerts for rule-fired faults.
          This screen will stay read-only — it will never command equipment.
        </p>
      </div>
    </section>
  );
}
