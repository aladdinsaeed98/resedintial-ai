"""MQTT subscriber for the ESP32 nodes.

This is the only hub module that talks to the broker. It listens on
hvac/+/reading, parses each payload, and appends it to the store. It does
not publish. write() is the base refusal so a bug cannot command equipment.

If readings never appear, check Mosquitto, then these logs for "dropped mqtt
payload" or "mqtt connect failed". A dropped payload leaves the last good
row in the store — that is on purpose.
"""

from __future__ import annotations

import logging
from typing import Any

import paho.mqtt.client as mqtt

from hub.clock import format_timestamp
from hub.config import Settings
from hub.live import live_point_for
from hub.models import (
    BuildingGateway,
    Point,
    PointValue,
    Quality,
    UnknownPoint,
)
from hub.parsing import parse_reading
from hub.store import ReadingStore

logger = logging.getLogger(__name__)


def _connect_failed(reason_code: Any) -> bool:
    """True when the broker refused the connection.

    paho v2 gives a reason object with is_failure; older callbacks give an
    integer where 0 means success. Anything we cannot read is treated as fail
    so we never subscribe after a half-open connect.
    """
    if hasattr(reason_code, "is_failure"):
        return bool(reason_code.is_failure)
    try:
        return int(reason_code) != 0
    except (TypeError, ValueError):
        return True


class MqttGateway(BuildingGateway):
    """Read-only MQTT adapter. One instance per hub process.

    supports_write stays False. The inherited write() raises WriteNotSupported
    so there is no code path that could publish a command to a node.
    """

    backend_name = "mqtt"
    adapter_kind = "mqtt"
    supports_write = False
    # + is MQTT's single-level wildcard: any node id, readings only.
    subscribe_topic = "hvac/+/reading"

    def __init__(self, settings: Settings, store: ReadingStore, clock: Any) -> None:
        """Remember settings, the SQLite store, and the clock used for received_at."""
        self.settings = settings
        self.store = store
        self.clock = clock
        self._client: mqtt.Client | None = None

    @property
    def connected(self) -> bool:
        """True only when the paho client exists and the broker session is up."""
        return self._client is not None and self._client.is_connected()

    def connect(self) -> None:
        """Start a background MQTT loop that only receives.

        clean_session=True so we do not replay a backlog of old readings as
        if they were current. keepalive=30 s is a dead-broker detect, not a
        command. A connect error is logged and swallowed so the HTTP page
        still serves stale/missing tiles instead of crashing.
        """
        if self._client is not None:
            return
        client = mqtt.Client(
            mqtt.CallbackAPIVersion.VERSION2,
            client_id="hvac-hub",
            protocol=mqtt.MQTTv311,
            clean_session=True,
        )
        client.reconnect_delay_set(min_delay=1, max_delay=30)
        client.on_connect = self._on_connect
        client.on_message = self._on_message
        try:
            client.connect_async(self.settings.mqtt_host, self.settings.mqtt_port, keepalive=30)
            client.loop_start()
        except Exception:
            logger.exception("mqtt loop failed to start")
            return
        self._client = client

    def close(self) -> None:
        """Stop the background loop and disconnect. Safe to call twice."""
        client = self._client
        self._client = None
        if client is None:
            return
        client.loop_stop()
        client.disconnect()

    def handle_message(self, topic: str, payload: bytes | str) -> bool:
        """Parse one MQTT message and store it if it is a valid reading.

        Returns True when a row was stored, False when the payload was
        dropped (bad JSON, wrong topic, etc.). Tests call this directly so
        they do not need a live broker. Extra JSON keys are ignored — a
        "command" field is data, not an instruction.
        """
        result = parse_reading(topic, payload, received_at=self.clock.now())
        if result.reading is None:
            logger.warning("dropped mqtt payload on %s: %s", topic, result.error)
            return False
        self.store.add(result.reading)
        reading = result.reading
        logger.info(
            "reading %s=%s %s quality=%s node=%s",
            reading.point_id,
            reading.value,
            reading.unit,
            reading.quality.value,
            reading.node_id,
        )
        return True

    def list_equipment(self) -> list[str]:
        """Node ids from points.json, in first-seen order. Phase 1 is just 'bench'."""
        equipment: list[str] = []
        for spec in self.settings.points:
            if spec.node_id not in equipment:
                equipment.append(spec.node_id)
        return equipment

    def list_points(self, equipment_id: str | None = None) -> list[Point]:
        """Configured points, always writable=False. Optional filter by node id."""
        points: list[Point] = []
        for spec in self.settings.points:
            if equipment_id is not None and spec.node_id != equipment_id:
                continue
            points.append(
                Point(
                    id=spec.id,
                    name=spec.name,
                    equipment_id=spec.node_id,
                    unit=spec.unit,
                    writable=False,
                )
            )
        return points

    def read(self, point_id: str) -> PointValue:
        """Latest classified value for one point.

        UnknownPoint is raised if the id is not in config and has never been
        stored — we do not invent a heat-pump point on an AC-only bench.
        Quality follows the live-page status so a stale or bad number is
        never returned as trustworthy current data.
        """
        live = live_point_for(self.settings, self.store, point_id, self.clock.now())
        if live is None:
            raise UnknownPoint(f"unknown point {point_id}")
        if live.status == "live":
            quality = Quality.GOOD
        elif live.status == "bad":
            quality = Quality.BAD
        else:
            quality = Quality.UNKNOWN
        return PointValue(
            point_id=live.point_id,
            value=live.value,
            unit=live.unit,
            quality=quality,
            timestamp=live.device_timestamp or self.clock.now(),
            raw={
                "status": live.status,
                "node_id": live.node_id,
                "age_seconds": live.age_seconds,
                "received_at": (
                    format_timestamp(live.received_at) if live.received_at else None
                ),
                "time_source": live.time_source,
            },
        )

    def _on_connect(self, client: mqtt.Client, userdata: Any, flags: Any, reason_code: Any, properties: Any) -> None:
        """paho callback: listen for readings once the session is up. Do not publish."""
        if _connect_failed(reason_code):
            logger.error("mqtt connect failed: %s", reason_code)
            return
        client.subscribe(self.subscribe_topic)
        logger.info("mqtt subscribed to %s", self.subscribe_topic)

    def _on_message(self, client: mqtt.Client, userdata: Any, message: mqtt.MQTTMessage) -> None:
        """paho callback: one inbound reading. Handler errors must not kill the loop."""
        try:
            self.handle_message(message.topic, message.payload)
        except Exception:
            logger.exception("mqtt handler failed")
