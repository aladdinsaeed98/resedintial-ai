/**
 * GET /api/alerts — active and recent fault rows for the Alerts screen.
 *
 * Clerk session required when keys are configured. POST is 405.
 * Response never includes a command. Alerts are never sent to devices.
 */

import { NextResponse } from "next/server";

import { getAlertStore } from "@/hub/alert-store";
import type { AlertRecord } from "@/hub/alerts";
import { SystemClock } from "@/hub/clock";
import { alertHint, demoAlertsPayload, isDemoMode } from "@/hub/demo";
import { methodNotAllowed } from "@/hub/reject-write";
import { runRulesIfDue } from "@/hub/rules-runner";
import { loadRules } from "@/hub/rules";
import { dashboardUserId } from "@/hub/session";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function asPublic(row: AlertRecord): Record<string, unknown> {
  return {
    id: row.id,
    rule_id: row.ruleId,
    subject: row.subject,
    rules_version: row.rulesVersion,
    severity: row.severity,
    title: row.title,
    system_name: row.systemName,
    opened_at: row.openedAt.toISOString(),
    last_seen_at: row.lastSeenAt.toISOString(),
    cleared_at: row.clearedAt ? row.clearedAt.toISOString() : null,
    occurrence: row.occurrence,
    detail: row.detail,
    hint: alertHint(row.ruleId),
  };
}

export async function GET(): Promise<NextResponse> {
  const userId = await dashboardUserId();
  if (userId === null) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  if (isDemoMode()) {
    return NextResponse.json(demoAlertsPayload(), {
      headers: { "Cache-Control": "no-store" },
    });
  }

  try {
    await runRulesIfDue(new SystemClock().now());
  } catch (error) {
    console.error("lazy rules evaluation failed", error);
  }

  const store = getAlertStore();
  const alerts = store ? await store.list(50) : [];
  const activeCount = alerts.filter((row) => row.clearedAt === null).length;
  let rulesVersion = 0;
  try {
    rulesVersion = loadRules().version;
  } catch {
    rulesVersion = 0;
  }

  return NextResponse.json(
    {
      alerts: alerts.map(asPublic),
      active_count: activeCount,
      rules_version: rulesVersion,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}

export async function POST(): Promise<NextResponse> {
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
