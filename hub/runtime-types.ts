/**
 * Shared hub runtime shape. Kept free of sqlite/mqtt imports so the
 * Vercel bundle can type-check GET handlers without native modules.
 */

import type { Clock } from "./clock";
import type { Settings } from "./config";
import type { MqttGateway } from "./gateway";
import type { ReadingStore } from "./store";

export interface HubRuntime {
  settings: Settings;
  store: ReadingStore;
  clock: Clock;
  gateway: MqttGateway;
  ownsStore: boolean;
}
