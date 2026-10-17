"""Publish two changing temperatures every 10 seconds. Retain is off."""

from __future__ import annotations

import argparse
import json
import logging
import time
from datetime import datetime, timezone

import paho.mqtt.client as mqtt

from hub.clock import format_timestamp
from hub.topics import reading_topic

logger = logging.getLogger(__name__)

DEFAULT_INTERVAL_SECONDS = 10
MQTT_RETAIN = False


def temperatures(step: int) -> dict[str, float]:
    bump = (step % 6) * 0.1
    return {
        "return_air_temp": round(74.0 + bump, 2),
        "supply_air_temp": round(56.0 + bump, 2),
    }


def build_payload(
    point: str,
    value: float | None,
    when: datetime,
    quality: str = "good",
    unit: str = "F",
) -> bytes:
    body = {
        "point": point,
        "value": value,
        "unit": unit,
        "timestamp": format_timestamp(when),
        "quality": quality,
    }
    return json.dumps(body, separators=(",", ":")).encode("utf-8")


def connect_client(host: str, port: int) -> mqtt.Client:
    client = mqtt.Client(
        mqtt.CallbackAPIVersion.VERSION2,
        client_id="hvac-bench-sim",
        protocol=mqtt.MQTTv311,
    )
    client.reconnect_delay_set(1, 30)
    while True:
        try:
            client.connect(host, port, keepalive=30)
            break
        except OSError as exc:
            logger.warning("broker %s:%s not up yet (%s)", host, port, exc)
            time.sleep(2)
    client.loop_start()
    return client


def publish_once(client: mqtt.Client, node_id: str, step: int, when: datetime) -> dict[str, float]:
    temps = temperatures(step)
    for point, value in temps.items():
        info = client.publish(
            reading_topic(node_id),
            build_payload(point, value, when),
            qos=0,
            retain=MQTT_RETAIN,
        )
        info.wait_for_publish(timeout=5)
    return temps


def run(host: str, port: int, interval: float, node_id: str, once: bool) -> None:
    client = connect_client(host, port)
    step = 0
    try:
        while True:
            temps = publish_once(client, node_id, step, datetime.now(timezone.utc))
            logger.info("published %s", temps)
            if once:
                return
            step += 1
            time.sleep(interval)
    finally:
        client.loop_stop()
        client.disconnect()


def main(argv: list[str] | None = None) -> None:
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)s %(name)s: %(message)s",
    )
    parser = argparse.ArgumentParser(description="Publish bench temperatures to the HVAC hub.")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=1883)
    parser.add_argument("--interval", type=float, default=DEFAULT_INTERVAL_SECONDS)
    parser.add_argument("--node", default="bench")
    parser.add_argument("--once", action="store_true")
    args = parser.parse_args(argv)
    try:
        run(args.host, args.port, args.interval, args.node, args.once)
    except KeyboardInterrupt:
        return


if __name__ == "__main__":
    main()
