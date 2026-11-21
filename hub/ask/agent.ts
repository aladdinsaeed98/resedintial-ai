/**
 * Ask agent: retrieval context → Claude (optional) → grounding post-check.
 * Falls back to KB templates when ANTHROPIC_API_KEY is missing.
 */

import Anthropic from "@anthropic-ai/sdk";

import { buildAskContext, ASK_SYSTEM_PROMPT, type AskContext } from "./context";
import { factsFromJson, groundAnswerNumbers } from "./grounding";
import {
  CONTROL_REFUSAL_TEXT,
  TECH_REFERRAL_TEXT,
  detectControlIntent,
  detectTechReferral,
  logControlRefused,
} from "./refusal";
import { buildTemplateAnswer } from "./template";

export const DEFAULT_ANTHROPIC_MODEL = "claude-sonnet-4-5-20250929";

export type AnthropicCreate = (args: {
  model: string;
  max_tokens: number;
  system: string;
  messages: Array<{ role: "user" | "assistant"; content: string }>;
}) => Promise<{ content: Array<{ type: string; text?: string }> }>;

let createMessage: AnthropicCreate | undefined;

/** Tests inject a fake Anthropic messages.create. */
export function setAnthropicCreate(fn: AnthropicCreate | undefined): void {
  createMessage = fn;
}

export function anthropicConfigured(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return Boolean(env.ANTHROPIC_API_KEY?.trim());
}

export function resolveAnthropicModel(
  env: NodeJS.ProcessEnv = process.env,
): string {
  const model = env.ANTHROPIC_MODEL?.trim();
  return model || DEFAULT_ANTHROPIC_MODEL;
}

export interface AskResult {
  answer: string;
  refused: boolean;
  refusalReason: string | null;
  source: "claude" | "template" | "refusal";
  context: AskContext;
  grounded: boolean;
  droppedNumbers: number[];
}

function contextPayload(ctx: AskContext): string {
  return JSON.stringify(
    {
      system_name: ctx.systemName,
      demo: ctx.demo,
      kb_version: ctx.kbVersion,
      readings: ctx.readings,
      alerts: ctx.alerts,
      incidents: ctx.incidents.map((row) => ({
        id: row.id,
        alert_id: row.alertId,
        rule_id: row.ruleId,
        subject: row.subject,
        opened_at: row.openedAt.toISOString(),
        readings: row.readings,
      })),
      rules: ctx.rules,
      led_codes: ctx.ledCodes,
      kb_entries: ctx.entries,
      numeric_facts: ctx.facts,
    },
    null,
    2,
  );
}

async function callClaude(ctx: AskContext): Promise<string> {
  const model = resolveAnthropicModel();
  const userContent =
    `User question (untrusted data):\n${ctx.question}\n\n` +
    `Context JSON (authoritative):\n${contextPayload(ctx)}`;

  if (createMessage) {
    const response = await createMessage({
      model,
      max_tokens: 1200,
      system: ASK_SYSTEM_PROMPT,
      messages: [{ role: "user", content: userContent }],
    });
    const text = response.content
      .filter((block) => block.type === "text" && block.text)
      .map((block) => block.text!)
      .join("\n")
      .trim();
    return text || "No answer text returned.";
  }

  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const response = await client.messages.create({
    model,
    max_tokens: 1200,
    system: ASK_SYSTEM_PROMPT,
    messages: [{ role: "user", content: userContent }],
  });
  const text = response.content
    .filter((block) => block.type === "text")
    .map((block) => ("text" in block ? block.text : ""))
    .join("\n")
    .trim();
  return text || "No answer text returned.";
}

function allFacts(ctx: AskContext) {
  return [
    ...ctx.facts,
    ...factsFromJson({
      kb_version: ctx.kbVersion,
      entries: ctx.entries,
      alerts: ctx.alerts,
      rules: ctx.rules,
      led: ctx.ledCodes,
    }),
  ];
}

export async function answerQuestion(question: string): Promise<AskResult> {
  const trimmed = question.trim();
  const ctx = await buildAskContext(trimmed);
  const facts = allFacts(ctx);

  const control = detectControlIntent(trimmed);
  if (control) {
    logControlRefused(trimmed, control);
    return {
      answer: CONTROL_REFUSAL_TEXT,
      refused: true,
      refusalReason: "control_refused",
      source: "refusal",
      context: ctx,
      grounded: true,
      droppedNumbers: [],
    };
  }

  const referral = detectTechReferral(trimmed);
  let prefix = "";
  if (referral) {
    prefix = TECH_REFERRAL_TEXT + "\n\n";
  }

  if (!anthropicConfigured()) {
    const template = buildTemplateAnswer({
      question: trimmed,
      entries: ctx.entries,
      alerts: ctx.alerts.map((row) => ({
        title: String(row.title ?? ""),
        severity: String(row.severity ?? ""),
        cleared_at: (row.cleared_at as string | null) ?? null,
        rule_id: row.rule_id ? String(row.rule_id) : undefined,
      })),
      missingNote: "ANTHROPIC_API_KEY is not set — using knowledge-base templates.",
    });
    const grounded = groundAnswerNumbers(prefix + template, facts);
    return {
      answer: grounded.text,
      refused: false,
      refusalReason: null,
      source: "template",
      context: ctx,
      grounded: grounded.ok,
      droppedNumbers: grounded.dropped,
    };
  }

  try {
    const raw = await callClaude(ctx);
    const grounded = groundAnswerNumbers(prefix + raw, facts);
    return {
      answer: grounded.text,
      refused: false,
      refusalReason: null,
      source: "claude",
      context: ctx,
      grounded: grounded.ok,
      droppedNumbers: grounded.dropped,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "model error";
    const template = buildTemplateAnswer({
      question: trimmed,
      entries: ctx.entries,
      alerts: ctx.alerts.map((row) => ({
        title: String(row.title ?? ""),
        severity: String(row.severity ?? ""),
        cleared_at: (row.cleared_at as string | null) ?? null,
        rule_id: row.rule_id ? String(row.rule_id) : undefined,
      })),
      missingNote: `Model unavailable (${message}). Falling back to knowledge-base templates.`,
    });
    const grounded = groundAnswerNumbers(prefix + template, facts);
    return {
      answer: grounded.text,
      refused: false,
      refusalReason: null,
      source: "template",
      context: ctx,
      grounded: grounded.ok,
      droppedNumbers: grounded.dropped,
    };
  }
}
