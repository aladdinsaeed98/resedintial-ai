"""Phase 1 pass, in software.

These tests are the desk checklist without hardware: a new sample replaces
the previous one, firmware and simulator publish every 10 seconds, and a
point with no sample for 120 seconds is stale — the number is not in the
payload the page renders.

They inject MQTT-shaped JSON into the gateway (no live broker). If a test
fails after a comment-only change, the code itself moved, not just the notes.
"""

from __future__ import annotations

import json
from datetime import datetime, timedelta, timezone
from pathlib import Path

import paho.mqtt.client as mqtt
import pytest
from fastapi.testclient import TestClient

from hub.app import create_app
from hub.clock import ManualClock
from hub.config import ROOT, Settings, load_settings
from hub.gateway import MqttGateway
from hub.live import public_snapshot
from hub.models import Quality, UnknownPoint, WriteNotSupported
from hub.parsing import parse_reading
from hub.store import ReadingStore
from hub.topics import reading_topic
from simulator.bench_publisher import (
    DEFAULT_INTERVAL_SECONDS,
    MQTT_RETAIN,
    build_payload,
)

START = datetime(2026, 10, 17, 12, 0, tzinfo=timezone.utc)
REPO = Path(__file__).resolve().parents[1]


class World:
    """Mini bench in memory: frozen clock, temp SQLite, real gateway, no broker.

    publish() feeds a payload as if MQTT delivered it. snapshot() is what
    /api/readings would return. Tests must close() so Windows can delete tmp.
    """

    def __init__(self, tmp_path: Path) -> None:
        """Build settings pointing at a temp database under tmp_path."""
        self.clock = ManualClock(START)
        self.settings = Settings(
            mqtt_host="127.0.0.1",
            mqtt_port=1883,
            database_path=tmp_path / "hvac.db",
            stale_after_seconds=120,
            system_name="Bench",
            points=load_settings(env={}).points,
            web_dir=ROOT / "web",
            host="127.0.0.1",
            port=8000,
        )
        self.store = ReadingStore(self.settings.database_path)
        self.gateway = MqttGateway(self.settings, self.store, self.clock)

    def close(self) -> None:
        """Close SQLite so the temp folder can be removed."""
        self.store.close()

    def publish(self, point_id: str, value: float, quality: str = "good", when: datetime | None = None) -> None:
        """Store one valid reading as the bench node would send it."""
        payload = build_payload(point_id, value, when or self.clock.now(), quality=quality)
        assert self.gateway.handle_message(reading_topic("bench"), payload) is True

    def snapshot(self) -> dict:
        """Public live-page payload at the current frozen clock time."""
        return public_snapshot(self.settings, self.store, self.clock.now())


@pytest.fixture
def world(tmp_path: Path):
    """Fresh World per test, then close the database."""
    item = World(tmp_path)
    yield item
    item.close()


def point(snap: dict, point_id: str) -> dict:
    """Pick one point dict out of a snapshot. Fails if the id is missing."""
    return next(item for item in snap["points"] if item["point_id"] == point_id)


def test_shipped_defaults_match_the_bench_pass() -> None:
    """Stale is 120 s, two F points, 10 s publish, retain off, DB outside the repo."""
    settings = load_settings(env={})
    assert settings.stale_after_seconds == 120
    assert [item.id for item in settings.points] == ["return_air_temp", "supply_air_temp"]
    assert DEFAULT_INTERVAL_SECONDS == 10
    assert MQTT_RETAIN is False
    database = settings.database_path.resolve()
    repo = REPO.resolve()
    assert repo != database and repo not in database.parents


def test_firmware_publishes_readings_and_does_not_subscribe() -> None:
    """Sketch publishes on a 10 s timer and has no inbound MQTT or GPIO outputs."""
    source = (REPO / "firmware" / "bench_node" / "bench_node.ino").read_text(encoding="utf-8")
    assert "kPublishIntervalMs = 10000" in source
    assert "mqtt.publish(" in source
    assert "subscribe(" not in source
    assert "digitalWrite(" not in source
    assert 'hvac/%s/reading' in source
    assert '\\"point\\"' in source
    assert '\\"quality\\"' in source


def test_simulator_payload_uses_the_wire_contract() -> None:
    """Simulator JSON is exactly {point, value, unit, timestamp, quality} and parses GOOD."""
    payload = build_payload("return_air_temp", 70.25, START)
    body = json.loads(payload)
    assert set(body) == {"point", "value", "unit", "timestamp", "quality"}
    result = parse_reading(reading_topic("bench"), payload, received_at=START)
    assert result.error is None
    assert result.reading is not None
    assert result.reading.value == pytest.approx(70.25)
    assert result.reading.quality is Quality.GOOD


def test_degree_symbol_counts_as_fahrenheit(world: World) -> None:
    """°F from a probe library is the same unit as F, so tiles do not split."""
    body = json.loads(build_payload("return_air_temp", 70.0, START))
    body["unit"] = "°F"
    result = parse_reading(reading_topic("bench"), json.dumps(body), received_at=START)
    assert result.reading is not None
    assert result.reading.unit == "F"


def test_readings_update_on_the_next_sample(world: World) -> None:
    """A new 10 s sample replaces the previous numbers; old values are gone."""
    world.publish("return_air_temp", 72.4)
    world.publish("supply_air_temp", 56.2)
    world.clock.advance(10)
    world.publish("return_air_temp", 73.0)
    world.publish("supply_air_temp", 57.1)
    snap = world.snapshot()
    assert [item["point_id"] for item in snap["points"]] == [
        "return_air_temp",
        "supply_air_temp",
    ]
    assert point(snap, "return_air_temp")["value"] == pytest.approx(73.0)
    assert point(snap, "return_air_temp")["age_seconds"] == 0
    assert point(snap, "supply_air_temp")["status"] == "live"
    text = json.dumps(snap)
    assert "72.4" not in text
    assert "56.2" not in text


def test_unplug_marks_both_points_stale_at_two_minutes(world: World) -> None:
    """119 s still live; at 120 s both tiles are stale and the numbers are absent."""
    world.publish("return_air_temp", 72.4)
    world.publish("supply_air_temp", 56.2)
    world.clock.advance(119)
    still_live = world.snapshot()
    assert point(still_live, "return_air_temp")["status"] == "live"
    assert point(still_live, "return_air_temp")["value"] == pytest.approx(72.4)

    world.clock.advance(1)
    stale = world.snapshot()
    text = json.dumps(stale)
    for point_id in ("return_air_temp", "supply_air_temp"):
        item = point(stale, point_id)
        assert item["status"] == "stale"
        assert item["value"] is None
        assert item["quality"] is None
    assert "72.4" not in text
    assert "56.2" not in text


def test_one_probe_can_go_stale_while_the_other_stays_live(world: World) -> None:
    """Silence is per point. One dead probe does not grey out the other."""
    world.publish("return_air_temp", 72.4)
    world.publish("supply_air_temp", 56.2)
    world.clock.advance(120)
    world.publish("return_air_temp", 72.8)
    snap = world.snapshot()
    assert point(snap, "return_air_temp")["status"] == "live"
    assert point(snap, "return_air_temp")["value"] == pytest.approx(72.8)
    assert point(snap, "supply_air_temp")["status"] == "stale"
    assert point(snap, "supply_air_temp")["value"] is None
    assert "56.2" not in json.dumps(snap)


def test_a_future_device_clock_does_not_keep_a_silent_probe_live(world: World) -> None:
    """Stale uses hub receive time. A node clock set 10 minutes ahead cannot fake live."""
    future = world.clock.now() + timedelta(minutes=10)
    world.publish("return_air_temp", 71.5, when=future)
    world.clock.advance(120)
    item = point(world.snapshot(), "return_air_temp")
    assert item["status"] == "stale"
    assert item["value"] is None


def test_a_just_arrived_reading_is_live_even_if_the_device_clock_is_old(world: World) -> None:
    """Phase 1: a sample that just arrived is live even if the ESP32 clock is wrong.

    Later SUSPECT_CLOCK (checklist added item) will change this on purpose.
    """
    old = world.clock.now() - timedelta(hours=1)
    world.publish("return_air_temp", 71.5, when=old)
    item = point(world.snapshot(), "return_air_temp")
    assert item["status"] == "live"
    assert item["value"] == pytest.approx(71.5)
    assert item["age_seconds"] == 0


def test_malformed_payload_does_not_replace_the_last_good_reading(world: World) -> None:
    """Truncated JSON and a command-shaped topic are dropped; last good value stays."""
    world.publish("return_air_temp", 72.4)
    assert world.gateway.handle_message(reading_topic("bench"), b"{") is False
    assert world.gateway.handle_message("hvac/bench/set", build_payload("return_air_temp", 1, START)) is False
    item = point(world.snapshot(), "return_air_temp")
    assert item["status"] == "live"
    assert item["value"] == pytest.approx(72.4)


def test_a_command_key_is_data_and_there_is_no_write_path(world: World) -> None:
    """Extra JSON keys are ignored. write() raises. No point is writable."""
    body = json.loads(build_payload("return_air_temp", 70.0, START))
    body["command"] = "off"
    assert world.gateway.handle_message(reading_topic("bench"), json.dumps(body)) is True
    with pytest.raises(WriteNotSupported):
        world.gateway.write("return_air_temp", 60)
    assert world.gateway.supports_write is False
    assert all(item.writable is False for item in world.gateway.list_points())
    assert world.gateway.list_equipment() == ["bench"]
    assert world.gateway.subscribe_topic == "hvac/+/reading"


def test_impossible_temperatures_are_stored_and_not_shown(world: World) -> None:
    """999 °F and DS18B20 -127 are kept in SQLite as BAD but omitted from the page."""
    world.publish("return_air_temp", 999)
    world.publish("supply_air_temp", -127)
    snap = world.snapshot()
    assert point(snap, "return_air_temp")["status"] == "bad"
    assert point(snap, "supply_air_temp")["status"] == "bad"
    assert point(snap, "return_air_temp")["value"] is None
    text = json.dumps(snap)
    assert "999" not in text
    assert "-127" not in text
    stored = world.store.latest("supply_air_temp")
    assert stored is not None
    assert stored.value == pytest.approx(-127)
    assert stored.quality is Quality.BAD
    reading = world.gateway.read("supply_air_temp")
    assert reading.value is None
    assert reading.trustworthy() is False
    assert "-127" not in json.dumps(reading.raw)


def test_missing_quality_is_not_treated_as_good(world: World) -> None:
    """No quality field means unknown, not a live number. We do not guess GOOD."""
    body = json.loads(build_payload("return_air_temp", 70.0, START))
    del body["quality"]
    assert world.gateway.handle_message(reading_topic("bench"), json.dumps(body)) is True
    item = point(world.snapshot(), "return_air_temp")
    assert item["status"] == "unknown"
    assert item["value"] is None
    assert "70.0" not in json.dumps(item)


def test_point_id_alias_is_rejected() -> None:
    """The wire field is 'point'. 'point_id' is dropped so a typo cannot sneak in."""
    body = {
        "point_id": "return_air_temp",
        "value": 70,
        "unit": "F",
        "timestamp": "2026-10-17T12:00:00Z",
        "quality": "good",
    }
    result = parse_reading(reading_topic("bench"), json.dumps(body), received_at=START)
    assert result.reading is None


def test_unknown_point_is_not_invented(world: World) -> None:
    """Asking for a heat-pump point on this AC bench raises, it does not make one up."""
    with pytest.raises(UnknownPoint):
        world.gateway.read("heat_pump")


def test_restart_does_not_revive_an_old_number(world: World) -> None:
    """Reopening SQLite after 120 s still shows stale, not the last stored number."""
    world.publish("return_air_temp", 72.4)
    world.publish("supply_air_temp", 56.2)
    path = world.settings.database_path
    world.store.close()
    world.clock.advance(120)
    reopened = ReadingStore(path)
    try:
        snap = public_snapshot(world.settings, reopened, world.clock.now())
    finally:
        reopened.close()
    assert point(snap, "return_air_temp")["status"] == "stale"
    assert point(snap, "return_air_temp")["value"] is None
    assert "72.4" not in json.dumps(snap)


def test_api_is_read_only_and_hides_stale_numbers(world: World) -> None:
    """HTTP is GET-only, no-store, hides stale numbers, and the page has no controls."""
    world.publish("return_air_temp", 72.4)
    world.publish("supply_air_temp", 56.2)
    app = create_app(world.settings, store=world.store, clock=world.clock, start_mqtt=False)
    with TestClient(app) as client:
        spec = client.get("/openapi.json").json()
        for methods in spec["paths"].values():
            assert set(methods) <= {"get", "head"}
        assert client.post("/api/readings").status_code == 405
        live = client.get("/api/readings")
        assert live.status_code == 200
        assert live.headers["cache-control"] == "no-store"
        assert live.json()["points"][0]["value"] == pytest.approx(72.4)
        assert live.json()["mqtt_connected"] is False
        world.clock.advance(120)
        stale = client.get("/api/readings")
        assert "72.4" not in stale.text
        assert "56.2" not in stale.text
        assert stale.json()["points"][0]["status"] == "stale"
        page = client.get("/")
        assert page.status_code == 200
        assert "Read only" in page.text
        script = client.get("/static/app.js")
        assert script.status_code == 200
        assert 'status === "live"' in script.text
        assert "innerHTML" not in script.text
        assert "stale_after_seconds" in script.text
        html = (REPO / "web" / "index.html").read_text(encoding="utf-8").lower()
        assert "<form" not in html
        assert "<input" not in html
        assert "<button" not in html


def test_paho_client_accepts_the_v2_callback_api() -> None:
    """The installed paho-mqtt still builds a v2 client the way the hub does."""
    client = mqtt.Client(
        mqtt.CallbackAPIVersion.VERSION2,
        client_id="test-hvac-hub",
        protocol=mqtt.MQTTv311,
        clean_session=True,
    )
    assert client is not None


def test_page_source_marks_a_silent_probe_stale() -> None:
    """CSS greys non-live tiles; JS has the Stale label and only paints numeric live values."""
    css = (REPO / "web" / "style.css").read_text(encoding="utf-8")
    js = (REPO / "web" / "app.js").read_text(encoding="utf-8")
    assert '[data-status="live"]' in css
    assert 'stale: "Stale"' in js
    assert "typeof point.value === \"number\"" in js
