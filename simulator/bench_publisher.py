"""Publish two changing temperatures every 10 seconds. Retain is off.

Pretends to be the bench ESP32 so you can exercise the hub without hardware.
Same topic and JSON as firmware/bench_node. Retain is off so stopping this
process (like unplugging the board) lets tiles go stale instead of leaving
a last number stuck in the broker.

If this prints "broker not up yet", start Mosquitto first.
"""

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

# Matches the ESP32 sketch (10 s) and the Phase 1 pass test.
DEFAULT_INTERVAL_SECONDS = 10
# Retain would keep the last payload after we quit — the page would look live.
MQTT_RETAIN = False


def temperatures(step: int) -> dict[str, float]:
    """Return air ~74 °F and supply ~56 °F, bumping 0.1 °F each 10 s cycle.

    The 6-step sawtooth is only so the tiles visibly change. Not real weather.
    """
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
    """JSON bytes for one reading: {point, value, unit, timestamp, quality}.

    Tests reuse this so the hub is proven against the same wire shape the
    simulator (and firmware) send.
    """
    body = {
        "point": point,
        "value": value,
        "unit": unit,
        "timestamp": format_timestamp(when),
        "quality": quality,
    }
    return json.dumps(body, separators=(",", ":")).encode("utf-8")


def connect_client(host: str, port: int) -> mqtt.Client:
    """Connect to Mosquitto, retrying every 2 s until it is up.

    Does not publish commands. client_id is distinct from the hub's so both
    can share one broker.
    """
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
    """Send both temperatures for this step. qos 0, retain off. Returns the pair."""
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
    """Loop: publish, log, sleep. once=True is for a single-shot smoke test."""
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
    """CLI: --host, --port, --interval, --node, --once. Ctrl+C exits cleanly."""
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
