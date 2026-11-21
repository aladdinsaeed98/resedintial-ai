-- Ask sessions / messages and incident snapshots (append-only, monitor-only).

CREATE TABLE "ask_sessions" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ask_sessions_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ask_messages" (
    "id" TEXT NOT NULL,
    "session_id" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "grounding_facts" JSONB,
    "refused" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ask_messages_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "incident_snapshots" (
    "id" TEXT NOT NULL,
    "alert_id" TEXT NOT NULL,
    "rule_id" TEXT NOT NULL,
    "subject" TEXT NOT NULL DEFAULT '',
    "opened_at" TIMESTAMP(3) NOT NULL,
    "readings" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "incident_snapshots_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ask_sessions_user_id_updated_at_idx" ON "ask_sessions"("user_id", "updated_at");
CREATE INDEX "ask_messages_session_id_created_at_idx" ON "ask_messages"("session_id", "created_at");
CREATE INDEX "incident_snapshots_alert_id_idx" ON "incident_snapshots"("alert_id");
CREATE INDEX "incident_snapshots_opened_at_idx" ON "incident_snapshots"("opened_at");

ALTER TABLE "ask_messages" ADD CONSTRAINT "ask_messages_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "ask_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
