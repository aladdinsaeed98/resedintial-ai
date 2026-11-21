/**
 * Shared HTTP helpers for the monitor-only hub.
 *
 * User-facing routes are GET/HEAD. POST /api/ingest is the collector's
 * storage path (secret-authenticated) and is listed separately. The Phase 1
 * API test still uses createMonitorServer to prove POST /api/readings is 405.
 */

import type { IncomingMessage, ServerResponse } from "node:http";
import { createServer, type Server } from "node:http";

import type { Clock } from "./clock";
import type { Settings } from "./config";
import type { MqttGateway } from "./gateway";
import { publicSnapshot } from "./live";
import type { ReadingStore } from "./store";

export const READ_METHODS = new Set(["GET", "HEAD"]);

/** True for POST/PUT/PATCH/DELETE and anything else that is not a read. */
export function isWriteMethod(method: string): boolean {
  return !READ_METHODS.has(method.toUpperCase());
}

/** JSON body for GET /api/readings, including mqtt_connected. */
export function readingsPayload(
  settings: Settings,
  store: ReadingStore,
  clock: Clock,
  gateway: MqttGateway,
): Record<string, unknown> {
  const body = publicSnapshot(settings, store, clock.now());
  return { ...body, mqtt_connected: gateway.connected };
}

/**
 * Minimal OpenAPI document.
 * People-facing paths are GET/HEAD. POST /api/ingest stores readings only;
 * it never returns a command to the collector.
 */
export function openApiDocument(): Record<string, unknown> {
  return {
    openapi: "3.1.0",
    info: { title: "Residential HVAC Monitor", version: "0.1.0" },
    paths: {
      "/": { get: { summary: "Home (Clerk session)" }, head: {} },
      "/live": { get: { summary: "Live readings" }, head: {} },
      "/history": { get: { summary: "History" }, head: {} },
      "/codes": { get: { summary: "Codes (later phase)" }, head: {} },
      "/alerts": { get: { summary: "Alerts" }, head: {} },
      "/ask": { get: { summary: "Ask (coming soon)" }, head: {} },
      "/settings": { get: { summary: "Settings (later phase)" }, head: {} },
      "/api/readings": { get: { summary: "Current readings" }, head: {} },
      "/api/alerts": { get: { summary: "Active and recent alerts (Clerk session)" }, head: {} },
      "/api/history": { get: { summary: "History rows (Clerk session)" }, head: {} },
      "/api/health": { get: { summary: "Health" }, head: {} },
      "/api/cron/rules": {
        get: { summary: "Vercel Cron rules tick (CRON_SECRET). Time-based stale/offline checks." },
      },
      "/openapi.json": { get: { summary: "This document" }, head: {} },
      "/api/ingest": {
        post: {
          summary: "Collector ingest (INGEST_SECRET). Stores readings, evaluates rules; returns { accepted } only.",
        },
      },
    },
  };
}

export type NodeHandler = (req: IncomingMessage, res: ServerResponse) => void;

/**
 * Wrap an HTTP handler so write methods never reach the people-facing app.
 * The Phase 1 API test still uses this to prove POST /api/readings is 405.
 * Production ingest is a separate App Router route with a shared secret.
 */
export function createMonitorServer(nextHandler: NodeHandler): Server {
  return createServer((req, res) => {
    const method = req.method ?? "GET";
    if (isWriteMethod(method)) {
      res.statusCode = 405;
      res.setHeader("Allow", "GET, HEAD");
      res.end();
      return;
    }
    nextHandler(req, res);
  });
}
