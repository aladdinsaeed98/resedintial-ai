/**
 * No-LLM / no-key fallback. Builds an answer only from KB entries + alerts.
 */

import type { KbEntry } from "../kb";

export interface TemplateAlert {
  title: string;
  severity: string;
  cleared_at: string | null;
  rule_id?: string;
}

export function buildTemplateAnswer(args: {
  question: string;
  entries: KbEntry[];
  alerts: TemplateAlert[];
  missingNote?: string;
}): string {
  const lines: string[] = [];
  lines.push("Template answer (no model key or model skipped).");
  if (args.missingNote) {
    lines.push(args.missingNote);
  }

  const active = args.alerts.filter((row) => row.cleared_at === null);
  if (active.length > 0) {
    lines.push("");
    lines.push("Active alerts:");
    for (const alert of active.slice(0, 5)) {
      lines.push(`- [${alert.severity}] ${alert.title}`);
    }
  } else {
    lines.push("");
    lines.push("No active alerts in context.");
  }

  if (args.entries.length === 0) {
    lines.push("");
    lines.push(
      "No matching troubleshooting entry. Ask about a symptom (for example high delta-T or blower not running), or open an alert's hint link.",
    );
    return lines.join("\n");
  }

  for (const entry of args.entries) {
    lines.push("");
    lines.push(`Symptom: ${entry.symptom}`);
    lines.push("Likely causes (ranked):");
    for (const cause of [...entry.likely_causes].sort((a, b) => a.rank - b.rank)) {
      lines.push(
        `- ${cause.rank}. ${cause.cause}${cause.tech_only ? " (technician only)" : ""}`,
      );
    }
    lines.push("Safe homeowner checks:");
    for (const check of entry.homeowner_checks) {
      lines.push(`- ${check}`);
    }
    lines.push("Technician-only:");
    for (const item of entry.tech_only) {
      lines.push(`- ${item}`);
    }
    lines.push(`When to call a pro: ${entry.call_pro_when}`);
  }

  lines.push("");
  lines.push(
    "Numbers above are guidance labels only. Live values must come from the readings context when shown.",
  );
  return lines.join("\n");
}
