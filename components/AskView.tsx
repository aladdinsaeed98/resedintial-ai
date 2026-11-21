/**
 * Ask chat: grounded troubleshooting. Monitor-only — no equipment controls.
 */

"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { FormEvent, useEffect, useMemo, useState } from "react";

import { Skeleton } from "./Skeleton";

const STARTERS = [
  "Is everything okay right now?",
  "Why is delta-T high?",
  "What should I check for weak airflow?",
  "The outdoor unit is not starting — what can I check safely?",
];

interface Chip {
  kind: string;
  id: string;
  label: string;
}

interface ChatTurn {
  role: "user" | "assistant";
  content: string;
  chips?: Chip[];
  source?: string;
  refused?: boolean;
}

interface HistoryRow {
  id: string;
  updated_at: string;
  preview: string;
  message_count: number;
  refused: boolean;
}

export function AskView() {
  const params = useSearchParams();
  const prefill = params.get("q") ?? "";
  const [question, setQuestion] = useState(prefill);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [turns, setTurns] = useState<ChatTurn[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [history, setHistory] = useState<HistoryRow[] | null>(null);

  useEffect(() => {
    if (prefill) setQuestion(prefill);
  }, [prefill]);

  useEffect(() => {
    let cancelled = false;
    async function loadHistory() {
      try {
        const response = await fetch("/api/ask/history", { cache: "no-store" });
        if (!response.ok) {
          if (!cancelled) setHistory([]);
          return;
        }
        const body = (await response.json()) as { sessions: HistoryRow[] };
        if (!cancelled) setHistory(body.sessions ?? []);
      } catch {
        if (!cancelled) setHistory([]);
      }
    }
    void loadHistory();
    return () => {
      cancelled = true;
    };
  }, [sessionId, turns.length]);

  const lastChips = useMemo(() => {
    for (let i = turns.length - 1; i >= 0; i -= 1) {
      if (turns[i].role === "assistant" && turns[i].chips?.length) {
        return turns[i].chips!;
      }
    }
    return [] as Chip[];
  }, [turns]);

  async function submit(text: string) {
    const q = text.trim();
    if (!q || busy) return;
    setBusy(true);
    setError("");
    setTurns((prev) => [...prev, { role: "user", content: q }]);
    setQuestion("");
    try {
      const response = await fetch("/api/ask", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ question: q, session_id: sessionId }),
      });
      if (!response.ok) {
        throw new Error("ask failed (" + response.status + ")");
      }
      const body = (await response.json()) as {
        answer: string;
        session_id?: string;
        chips?: Chip[];
        source?: string;
        refused?: boolean;
      };
      if (body.session_id) setSessionId(body.session_id);
      setTurns((prev) => [
        ...prev,
        {
          role: "assistant",
          content: body.answer,
          chips: body.chips ?? [],
          source: body.source,
          refused: body.refused,
        },
      ]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Ask failed");
      setTurns((prev) => [
        ...prev,
        {
          role: "assistant",
          content:
            "I could not reach the Ask API. Check that the app is running. This app still cannot control equipment.",
        },
      ]);
    } finally {
      setBusy(false);
    }
  }

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    void submit(question);
  }

  return (
    <section className="page fade-in ask-layout">
      <header className="page-header">
        <p className="micro-label">Assistant</p>
        <h1>Ask</h1>
        <p className="sub">
          Grounded troubleshooting from live readings, alerts, and the knowledge base.
          Monitor only — never turns equipment on or off.
        </p>
      </header>

      <p className="ask-safety glass" role="note">
        Safe homeowner checks only here. Refrigerant, capacitors, contactors, line voltage,
        and gas are technician work. LED meanings come only from the installed table.
      </p>

      <div className="ask-starters">
        {STARTERS.map((item) => (
          <button
            key={item}
            type="button"
            className="ask-starter"
            onClick={() => void submit(item)}
            disabled={busy}
          >
            {item}
          </button>
        ))}
      </div>

      <div className="ask-chat glass">
        {turns.length === 0 ? (
          <p className="ask-empty">
            Ask a question, pick a starter, or open an alert&apos;s &quot;What should I do?&quot;
            link.
          </p>
        ) : (
          <ul className="ask-turns">
            {turns.map((turn, index) => (
              <li
                key={`${turn.role}-${index}`}
                className={turn.role === "user" ? "ask-turn user" : "ask-turn assistant"}
                data-refused={turn.refused ? "1" : "0"}
              >
                <p className="micro-label">{turn.role === "user" ? "You" : "Assistant"}</p>
                <pre className="ask-bubble">{turn.content}</pre>
                {turn.source ? (
                  <p className="ask-source">Source: {turn.source}</p>
                ) : null}
              </li>
            ))}
          </ul>
        )}

        {lastChips.length > 0 ? (
          <div className="ask-chips" aria-label="Based on">
            <p className="micro-label">Based on</p>
            <div className="ask-chip-row">
              {lastChips.map((chip) => (
                <span key={`${chip.kind}-${chip.id}`} className={`ask-chip ${chip.kind}`}>
                  {chip.kind}: {chip.label}
                </span>
              ))}
            </div>
          </div>
        ) : null}

        <form className="ask-form" onSubmit={onSubmit}>
          <label className="sr-only" htmlFor="ask-input">
            Question
          </label>
          <textarea
            id="ask-input"
            className="ask-input"
            rows={3}
            value={question}
            onChange={(event) => setQuestion(event.target.value)}
            placeholder="Ask about a symptom, alert, or reading…"
            disabled={busy}
          />
          <button type="submit" className="ask-send" disabled={busy || !question.trim()}>
            {busy ? "Thinking…" : "Ask"}
          </button>
        </form>
        {error ? <p className="banner">{error}</p> : null}
      </div>

      <aside className="ask-history glass">
        <p className="micro-label">Troubleshooting history</p>
        <h2 className="ask-history-title">Recent sessions</h2>
        {history === null ? (
          <Skeleton rows={3} />
        ) : history.length === 0 ? (
          <p className="empty-copy">
            No saved Ask sessions yet. Answers are stored when a database is configured (or
            in-memory during demo mode for this process).
          </p>
        ) : (
          <ul className="ask-history-list">
            {history.map((row) => (
              <li key={row.id}>
                <p className="ask-history-preview">{row.preview || "(empty)"}</p>
                <p className="ask-meta">
                  {row.message_count} messages · {new Date(row.updated_at).toLocaleString()}
                  {row.refused ? " · control refused" : ""}
                </p>
              </li>
            ))}
          </ul>
        )}
        <p className="ask-note">
          Prefer <Link href="/alerts">Alerts</Link> for rule-fired faults and{" "}
          <Link href="/live">Live</Link> for current numbers.
        </p>
      </aside>
    </section>
  );
}
