"""MQTT subscriber for the ESP32 nodes.

This module does not publish. write() is the base refusal.
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
    if hasattr(reason_code, "is_failure"):
        return bool(reason_code.is_failure)
    try:
        return int(reason_code) != 0
    except (TypeError, ValueError):
        return True


class MqttGateway(BuildingGateway):
    backend_name = "mqtt"
    adapter_kind = "mqtt"
    supports_write = False
    subscribe_topic = "hvac/+/reading"

    def __init__(self, settings: Settings, store: ReadingStore, clock: Any) -> None:
        self.settings = settings
        self.store = store
        self.clock = clock
        self._client: mqtt.Client | None = None

    @property
    def connected(self) -> bool:
        return self._client is not None and self._client.is_connected()

    def connect(self) -> None:
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
        client = self._client
        self._client = None
        if client is None:
            return
        client.loop_stop()
        client.disconnect()

    def handle_message(self, topic: str, payload: bytes | str) -> bool:
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
        equipment: list[str] = []
        for spec in self.settings.points:
            if spec.node_id not in equipment:
                equipment.append(spec.node_id)
        return equipment

    def list_points(self, equipment_id: str | None = None) -> list[Point]:
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
        if _connect_failed(reason_code):
            logger.error("mqtt connect failed: %s", reason_code)
            return
        client.subscribe(self.subscribe_topic)
        logger.info("mqtt subscribed to %s", self.subscribe_topic)

    def _on_message(self, client: mqtt.Client, userdata: Any, message: mqtt.MQTTMessage) -> None:
        try:
            self.handle_message(message.topic, message.payload)
        except Exception:
            logger.exception("mqtt handler failed")
