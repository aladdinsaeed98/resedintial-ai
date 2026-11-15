"""MQTT topic contract for node readings. There is no command topic.

Nodes publish to hvac/<node>/reading. The hub listens on hvac/+/reading.
A payload on any other path (for example hvac/bench/set) is dropped by
the parser. If the simulator runs but the hub hears nothing, compare the
topic string here with what the publisher used.
"""

from __future__ import annotations

import re

# MQTT wildcard: one node id, readings only. Same string as MqttGateway.subscribe_topic.
READING_SUBSCRIBE = "hvac/+/reading"
# Capture group 1 is the node id (letters, digits, underscore, hyphen).
TOPIC_RE = re.compile(r"^hvac/([A-Za-z0-9_-]+)/reading$")
# Wire point names: start with a letter, then letters/digits/underscore, max 64 chars.
POINT_RE = re.compile(r"^[a-z][a-z0-9_]{0,63}$")
NODE_RE = re.compile(r"^[A-Za-z0-9_-]+$")


def reading_topic(node_id: str) -> str:
    """Build hvac/<node_id>/reading. Raises if the node id has spaces or slashes."""
    if not NODE_RE.match(node_id):
        raise ValueError(f"invalid node id {node_id}")
    return f"hvac/{node_id}/reading"
