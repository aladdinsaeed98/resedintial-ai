-- Phase B fault alerts. One row per occurrence; a clear that returns inside
-- 30 minutes reopens the same row (occurrence increments). subject keeps two
-- stale sensors from colliding.

CREATE TABLE "alerts" (
    "id" TEXT NOT NULL,
    "rule_id" TEXT NOT NULL,
    "subject" TEXT NOT NULL DEFAULT '',
    "rules_version" INTEGER NOT NULL,
    "severity" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "system_name" TEXT NOT NULL,
    "opened_at" TIMESTAMP(3) NOT NULL,
    "last_seen_at" TIMESTAMP(3) NOT NULL,
    "cleared_at" TIMESTAMP(3),
    "occurrence" INTEGER NOT NULL,
    "detail" JSONB NOT NULL,

    CONSTRAINT "alerts_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "alerts_rule_id_subject_last_seen_at_idx" ON "alerts"("rule_id", "subject", "last_seen_at");
CREATE INDEX "alerts_cleared_at_last_seen_at_idx" ON "alerts"("cleared_at", "last_seen_at");
