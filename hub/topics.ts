/**
 * MQTT topic contract for node readings. There is no command topic.
 *
 * Data flow: ESP32 / simulator publish to hvac/<node>/reading. The hub
 * subscribes to hvac/+/reading. If a payload arrives on any other topic
 * (for example hvac/bench/set), parsing drops it.
 *
 * Check here first if the page never sees a point: the topic string must
 * match TOPIC_RE exactly.
 */

/** MQTT single-level wildcard: any node id, readings only. */
export const READING_SUBSCRIBE = "hvac/+/reading";

export const TOPIC_RE = /^hvac\/([A-Za-z0-9_-]+)\/reading$/;
export const POINT_RE = /^[a-z][a-z0-9_]{0,63}$/;
export const NODE_RE = /^[A-Za-z0-9_-]+$/;

/** Build the wire topic for one node. Throws on an illegal node id. */
export function readingTopic(nodeId: string): string {
  if (!NODE_RE.test(nodeId)) {
    throw new Error(`invalid node id ${nodeId}`);
  }
  return `hvac/${nodeId}/reading`;
}
