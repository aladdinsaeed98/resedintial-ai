/**
 * Shared HTTP helpers for the monitor-only hub.
 *
 * GET and HEAD are allowed. Every other method is 405 so a form or a script
 * cannot POST a setpoint even if someone later adds a route by mistake.
 * The custom server in server.ts and the Phase 1 API test both use this.
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
 * Minimal OpenAPI document. Every path is GET/HEAD only so a test (and a
 * human) can see there is no write operation.
 */
export function openApiDocument(): Record<string, unknown> {
  return {
    openapi: "3.1.0",
    info: { title: "Residential HVAC Monitor", version: "0.1.0" },
    paths: {
      "/": { get: { summary: "Live page" }, head: {} },
      "/api/readings": { get: { summary: "Current readings" }, head: {} },
      "/api/health": { get: { summary: "Health" }, head: {} },
      "/openapi.json": { get: { summary: "This document" }, head: {} },
    },
  };
}

export type NodeHandler = (req: IncomingMessage, res: ServerResponse) => void;

/**
 * Wrap an HTTP handler so write methods never reach the app.
 * This is the same gate production (server.ts) and the API test use.
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
