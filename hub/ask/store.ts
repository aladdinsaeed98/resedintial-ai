/**
 * Ask session / message persistence. Prisma when DB is configured; memory in tests.
 * Append-only. Never writes to equipment.
 */

import type { Prisma, PrismaClient } from "@prisma/client";

import { databaseConfigured, getPrisma } from "../../lib/prisma";

export interface AskMessageRecord {
  id: string;
  sessionId: string;
  role: "user" | "assistant" | "system";
  content: string;
  groundingFacts: Record<string, unknown> | null;
  refused: boolean;
  createdAt: Date;
}

export interface AskSessionRecord {
  id: string;
  userId: string;
  createdAt: Date;
  updatedAt: Date;
  messages: AskMessageRecord[];
}

export interface AskStore {
  createSession(userId: string): Promise<AskSessionRecord>;
  getSession(id: string, userId: string): Promise<AskSessionRecord | null>;
  listSessions(userId: string, limit?: number): Promise<AskSessionRecord[]>;
  appendMessage(
    sessionId: string,
    userId: string,
    message: {
      role: "user" | "assistant" | "system";
      content: string;
      groundingFacts?: Record<string, unknown> | null;
      refused?: boolean;
    },
  ): Promise<AskMessageRecord>;
}

const GLOBAL_KEY = "__hvacAskStore";

type GlobalStore = typeof globalThis & {
  [GLOBAL_KEY]?: AskStore;
};

export function setAskStore(store: AskStore | undefined): void {
  const g = globalThis as GlobalStore;
  if (store) g[GLOBAL_KEY] = store;
  else delete g[GLOBAL_KEY];
}

export function getAskStore(): AskStore | null {
  const override = (globalThis as GlobalStore)[GLOBAL_KEY];
  if (override) return override;
  if (!databaseConfigured()) return null;
  return new PrismaAskStore(getPrisma());
}

function mapMessage(row: {
  id: string;
  sessionId: string;
  role: string;
  content: string;
  groundingFacts: Prisma.JsonValue | null;
  refused: boolean;
  createdAt: Date;
}): AskMessageRecord {
  const facts =
    typeof row.groundingFacts === "object" &&
    row.groundingFacts !== null &&
    !Array.isArray(row.groundingFacts)
      ? (row.groundingFacts as Record<string, unknown>)
      : null;
  return {
    id: row.id,
    sessionId: row.sessionId,
    role: row.role as AskMessageRecord["role"],
    content: row.content,
    groundingFacts: facts,
    refused: row.refused,
    createdAt: row.createdAt,
  };
}

export class PrismaAskStore implements AskStore {
  constructor(private readonly prisma: PrismaClient) {}

  async createSession(userId: string): Promise<AskSessionRecord> {
    const row = await this.prisma.askSession.create({
      data: { userId },
      include: { messages: { orderBy: { createdAt: "asc" } } },
    });
    return {
      id: row.id,
      userId: row.userId,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      messages: row.messages.map(mapMessage),
    };
  }

  async getSession(id: string, userId: string): Promise<AskSessionRecord | null> {
    const row = await this.prisma.askSession.findFirst({
      where: { id, userId },
      include: { messages: { orderBy: { createdAt: "asc" } } },
    });
    if (!row) return null;
    return {
      id: row.id,
      userId: row.userId,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      messages: row.messages.map(mapMessage),
    };
  }

  async listSessions(userId: string, limit = 20): Promise<AskSessionRecord[]> {
    const rows = await this.prisma.askSession.findMany({
      where: { userId },
      orderBy: { updatedAt: "desc" },
      take: limit,
      include: { messages: { orderBy: { createdAt: "asc" }, take: 4 } },
    });
    return rows.map((row) => ({
      id: row.id,
      userId: row.userId,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      messages: row.messages.map(mapMessage),
    }));
  }

  async appendMessage(
    sessionId: string,
    userId: string,
    message: {
      role: "user" | "assistant" | "system";
      content: string;
      groundingFacts?: Record<string, unknown> | null;
      refused?: boolean;
    },
  ): Promise<AskMessageRecord> {
    const session = await this.prisma.askSession.findFirst({
      where: { id: sessionId, userId },
    });
    if (!session) throw new Error("ask session not found");
    const row = await this.prisma.askMessage.create({
      data: {
        sessionId,
        role: message.role,
        content: message.content,
        groundingFacts: (message.groundingFacts ?? undefined) as
          | Prisma.InputJsonValue
          | undefined,
        refused: Boolean(message.refused),
      },
    });
    await this.prisma.askSession.update({
      where: { id: sessionId },
      data: { updatedAt: new Date() },
    });
    return mapMessage(row);
  }
}

export class MemoryAskStore implements AskStore {
  sessions: AskSessionRecord[] = [];
  private next = 1;

  async createSession(userId: string): Promise<AskSessionRecord> {
    const now = new Date();
    const row: AskSessionRecord = {
      id: `s${this.next++}`,
      userId,
      createdAt: now,
      updatedAt: now,
      messages: [],
    };
    this.sessions.unshift(row);
    return row;
  }

  async getSession(id: string, userId: string): Promise<AskSessionRecord | null> {
    return this.sessions.find((row) => row.id === id && row.userId === userId) ?? null;
  }

  async listSessions(userId: string, limit = 20): Promise<AskSessionRecord[]> {
    return this.sessions.filter((row) => row.userId === userId).slice(0, limit);
  }

  async appendMessage(
    sessionId: string,
    userId: string,
    message: {
      role: "user" | "assistant" | "system";
      content: string;
      groundingFacts?: Record<string, unknown> | null;
      refused?: boolean;
    },
  ): Promise<AskMessageRecord> {
    const session = await this.getSession(sessionId, userId);
    if (!session) throw new Error("ask session not found");
    const row: AskMessageRecord = {
      id: `m${this.next++}`,
      sessionId,
      role: message.role,
      content: message.content,
      groundingFacts: message.groundingFacts ?? null,
      refused: Boolean(message.refused),
      createdAt: new Date(),
    };
    session.messages.push(row);
    session.updatedAt = row.createdAt;
    return row;
  }
}
