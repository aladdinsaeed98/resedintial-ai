/**
 * POST /api/ask — grounded troubleshooting answer.
 *
 * Clerk session when keys are configured. Uses Anthropic when keyed; otherwise
 * KB templates. Never returns equipment commands. Monitor-only.
 */

import { NextResponse } from "next/server";

import { answerQuestion } from "@/hub/ask/agent";
import { getAskStore, MemoryAskStore, setAskStore } from "@/hub/ask/store";
import { methodNotAllowed } from "@/hub/reject-write";
import { dashboardUserId } from "@/hub/session";
import { isDemoMode } from "@/hub/demo";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function ensureAskStore() {
  const existing = getAskStore();
  if (existing) return existing;
  // Demo / no-DB local: keep an in-memory store for the process.
  if (isDemoMode()) {
    const memory = new MemoryAskStore();
    setAskStore(memory);
    return memory;
  }
  return null;
}

export async function POST(request: Request): Promise<NextResponse> {
  const userId = await dashboardUserId();
  if (userId === null) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let body: { question?: unknown; session_id?: unknown };
  try {
    body = (await request.json()) as { question?: unknown; session_id?: unknown };
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  const question = typeof body.question === "string" ? body.question.trim() : "";
  if (!question) {
    return NextResponse.json({ error: "question required" }, { status: 400 });
  }

  const result = await answerQuestion(question);
  const store = ensureAskStore();
  const owner = userId === "skipped" ? "local" : userId;

  let sessionId =
    typeof body.session_id === "string" && body.session_id.trim()
      ? body.session_id.trim()
      : null;

  if (store) {
    try {
      if (!sessionId) {
        const session = await store.createSession(owner);
        sessionId = session.id;
      }
      await store.appendMessage(sessionId, owner, {
        role: "user",
        content: question,
      });
      await store.appendMessage(sessionId, owner, {
        role: "assistant",
        content: result.answer,
        refused: result.refused,
        groundingFacts: {
          source: result.source,
          chips: result.context.chips,
          kb_ids: result.context.entries.map((entry) => entry.id),
          dropped_numbers: result.droppedNumbers,
          grounded: result.grounded,
          refusal_reason: result.refusalReason,
        },
      });
    } catch (error) {
      console.error("ask persistence failed", error);
    }
  }

  return NextResponse.json(
    {
      answer: result.answer,
      refused: result.refused,
      refusal_reason: result.refusalReason,
      source: result.source,
      grounded: result.grounded,
      dropped_numbers: result.droppedNumbers,
      session_id: sessionId,
      chips: result.context.chips,
      kb_version: result.context.kbVersion,
      demo: result.context.demo,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}

export async function GET(): Promise<NextResponse> {
  return methodNotAllowed();
}

export async function PUT(): Promise<NextResponse> {
  return methodNotAllowed();
}

export async function PATCH(): Promise<NextResponse> {
  return methodNotAllowed();
}

export async function DELETE(): Promise<NextResponse> {
  return methodNotAllowed();
}
