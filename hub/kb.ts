/**
 * Troubleshooting knowledge base. JSON files under config/troubleshooting/.
 *
 * Load + validate on read. Retrieval ranks by rule ids, point ids, and
 * symptom/alias keyword overlap. No brand-specific invention here.
 */

import fs from "node:fs";
import path from "node:path";

import { ROOT } from "./config";

export interface KbCause {
  rank: number;
  cause: string;
  tech_only?: boolean;
}

export interface KbEntry {
  id: string;
  symptom: string;
  aliases: string[];
  rule_ids: string[];
  point_ids: string[];
  likely_causes: KbCause[];
  homeowner_checks: string[];
  tech_only: string[];
  call_pro_when: string;
  sources: string[];
  assumptions: string[];
}

export interface KbManifest {
  version: number;
  updated: string;
  note: string;
  entries: string[];
}

export interface KbStore {
  version: number;
  entries: KbEntry[];
}

const KB_DIR = path.join(ROOT, "config", "troubleshooting");

function requireString(value: unknown, label: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`KB ${label} must be a non-empty string`);
  }
  return value.trim();
}

function requireStringArray(value: unknown, label: string): string[] {
  if (!Array.isArray(value) || !value.every((item) => typeof item === "string")) {
    throw new Error(`KB ${label} must be a string array`);
  }
  return value.map((item) => String(item));
}

/** Validate one entry object. Throws on bad shape. */
export function validateKbEntry(raw: unknown, fileLabel = "entry"): KbEntry {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    throw new Error(`KB ${fileLabel} must be an object`);
  }
  const data = raw as Record<string, unknown>;
  const causesRaw = data.likely_causes;
  if (!Array.isArray(causesRaw) || causesRaw.length === 0) {
    throw new Error(`KB ${fileLabel} needs likely_causes`);
  }
  const likely_causes: KbCause[] = causesRaw.map((item, index) => {
    if (typeof item !== "object" || item === null) {
      throw new Error(`KB ${fileLabel} likely_causes[${index}] invalid`);
    }
    const row = item as Record<string, unknown>;
    const rank = Number(row.rank);
    if (!Number.isInteger(rank) || rank < 1) {
      throw new Error(`KB ${fileLabel} likely_causes[${index}].rank invalid`);
    }
    return {
      rank,
      cause: requireString(row.cause, `${fileLabel}.likely_causes[${index}].cause`),
      ...(row.tech_only === true ? { tech_only: true } : {}),
    };
  });

  return {
    id: requireString(data.id, `${fileLabel}.id`),
    symptom: requireString(data.symptom, `${fileLabel}.symptom`),
    aliases: requireStringArray(data.aliases ?? [], `${fileLabel}.aliases`),
    rule_ids: requireStringArray(data.rule_ids ?? [], `${fileLabel}.rule_ids`),
    point_ids: requireStringArray(data.point_ids ?? [], `${fileLabel}.point_ids`),
    likely_causes,
    homeowner_checks: requireStringArray(
      data.homeowner_checks,
      `${fileLabel}.homeowner_checks`,
    ),
    tech_only: requireStringArray(data.tech_only, `${fileLabel}.tech_only`),
    call_pro_when: requireString(data.call_pro_when, `${fileLabel}.call_pro_when`),
    sources: requireStringArray(data.sources, `${fileLabel}.sources`),
    assumptions: requireStringArray(data.assumptions ?? [], `${fileLabel}.assumptions`),
  };
}

export function loadKb(dir: string = KB_DIR): KbStore {
  const manifestPath = path.join(dir, "manifest.json");
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8")) as KbManifest;
  if (!Number.isInteger(manifest.version) || manifest.version < 1) {
    throw new Error("KB manifest.version must be a positive integer");
  }
  if (!Array.isArray(manifest.entries) || manifest.entries.length === 0) {
    throw new Error("KB manifest.entries must be a non-empty array");
  }
  const entries: KbEntry[] = [];
  const seen = new Set<string>();
  for (const file of manifest.entries) {
    const full = path.join(dir, file);
    const entry = validateKbEntry(
      JSON.parse(fs.readFileSync(full, "utf8")),
      file,
    );
    if (seen.has(entry.id)) {
      throw new Error(`duplicate KB id ${entry.id}`);
    }
    seen.add(entry.id);
    entries.push(entry);
  }
  return { version: manifest.version, entries };
}

export interface RetrieveInput {
  question: string;
  ruleIds?: string[];
  pointIds?: string[];
  limit?: number;
}

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9+]+/)
    .filter((token) => token.length > 2);
}

/** Score and return the best-matching KB entries for a question + context. */
export function retrieveKbEntries(
  store: KbStore,
  input: RetrieveInput,
): KbEntry[] {
  const limit = input.limit ?? 3;
  const qTokens = new Set(tokenize(input.question));
  const ruleIds = new Set(input.ruleIds ?? []);
  const pointIds = new Set(input.pointIds ?? []);

  const scored = store.entries.map((entry) => {
    let score = 0;
    for (const ruleId of entry.rule_ids) {
      if (ruleIds.has(ruleId)) score += 8;
      // Prefer the entry whose id matches the fired rule.
      if (ruleIds.has(ruleId) && entry.id === ruleId) score += 6;
    }
    for (const pointId of entry.point_ids) {
      if (pointIds.has(pointId)) score += 3;
    }
    const hay = tokenize(
      [entry.symptom, entry.id, ...entry.aliases, ...entry.likely_causes.map((c) => c.cause)].join(
        " ",
      ),
    );
    for (const token of hay) {
      if (qTokens.has(token)) score += 2;
    }
    if (qTokens.has(entry.id.replace(/_/g, ""))) score += 4;
    return { entry, score };
  });

  scored.sort((a, b) => b.score - a.score || a.entry.id.localeCompare(b.entry.id));
  const positive = scored.filter((row) => row.score > 0);
  const picked = (positive.length > 0 ? positive : scored).slice(0, limit);
  return picked.map((row) => row.entry);
}
