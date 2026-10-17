"""MQTT topic contract for node readings. There is no command topic."""

from __future__ import annotations

import re

READING_SUBSCRIBE = "hvac/+/reading"
TOPIC_RE = re.compile(r"^hvac/([A-Za-z0-9_-]+)/reading$")
POINT_RE = re.compile(r"^[a-z][a-z0-9_]{0,63}$")
NODE_RE = re.compile(r"^[A-Za-z0-9_-]+$")


def reading_topic(node_id: str) -> str:
    if not NODE_RE.match(node_id):
        raise ValueError(f"invalid node id {node_id}")
    return f"hvac/{node_id}/reading"
