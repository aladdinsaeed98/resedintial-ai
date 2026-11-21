-- Phase 1 cloud tables. Append-only readings plus collector heartbeat.
-- Stale is decided from received_at, not device_timestamp.

CREATE TABLE "readings" (
    "id" SERIAL NOT NULL,
    "point_id" TEXT NOT NULL,
    "node_id" TEXT NOT NULL,
    "value" DOUBLE PRECISION,
    "unit" TEXT NOT NULL,
    "quality" TEXT NOT NULL,
    "device_timestamp" TIMESTAMP(3) NOT NULL,
    "received_at" TIMESTAMP(3) NOT NULL,
    "time_source" TEXT NOT NULL,

    CONSTRAINT "readings_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "readings_point_id_id_idx" ON "readings"("point_id", "id");

CREATE TABLE "collector_status" (
    "id" INTEGER NOT NULL,
    "mqtt_connected" BOOLEAN NOT NULL,
    "last_ingest_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "collector_status_pkey" PRIMARY KEY ("id")
);
