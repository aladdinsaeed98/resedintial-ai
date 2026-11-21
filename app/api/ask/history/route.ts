/**
 * GET /api/ask/history — troubleshooting session list for the signed-in user.
 * Read-only. No equipment control.
 */

import { NextResponse } from "next/server";

import { getAskStore, MemoryAskStore, setAskStore } from "@/hub/ask/store";
import { isDemoMode } from "@/hub/demo";
import { methodNotAllowed } from "@/hub/reject-write";
import { dashboardUserId } from "@/hub/session";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function ensureAskStore() {
  const existing = getAskStore();
  if (existing) return existing;
  if (isDemoMode()) {
    const memory = new MemoryAskStore();
    setAskStore(memory);
    return memory;
  }
  return null;
}

export async function GET(): Promise<NextResponse> {
  const userId = await dashboardUserId();
  if (userId === null) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const store = ensureAskStore();
  const owner = userId === "skipped" ? "local" : userId;
  const sessions = store ? await store.listSessions(owner, 30) : [];

  return NextResponse.json(
    {
      sessions: sessions.map((session) => ({
        id: session.id,
        created_at: session.createdAt.toISOString(),
        updated_at: session.updatedAt.toISOString(),
        preview: session.messages
          .filter((message) => message.role === "user")
          .slice(-1)
          .map((message) => message.content)[0] ?? "",
        message_count: session.messages.length,
        refused: session.messages.some((message) => message.refused),
      })),
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}

export async function POST(): Promise<NextResponse> {
  return methodNotAllowed();
}
