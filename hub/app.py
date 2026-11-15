"""HTTP surface for the bench page. Every route is a read.

Fits in the data flow after the store: the live page and `/api/readings`
only fetch what already arrived over MQTT. There is no POST that could
command equipment.

If the browser says "Can't reach the hub", this process is down.
If tiles never update, check `/api/health` for mqtt_connected, then Mosquitto.
"""

from __future__ import annotations

from contextlib import asynccontextmanager
from typing import Any

from fastapi import FastAPI, Response
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from hub.clock import SystemClock
from hub.config import Settings, load_settings
from hub.gateway import MqttGateway
from hub.live import public_snapshot
from hub.store import ReadingStore


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Connect the MQTT listener on startup; close MQTT and SQLite on shutdown.

    Tests pass start_mqtt=False so they never need a real broker. The store
    is only closed when this app created it (owns_store), not when a test
    handed one in.
    """
    if app.state.start_mqtt:
        app.state.gateway.connect()
    try:
        yield
    finally:
        if app.state.start_mqtt:
            app.state.gateway.close()
        if app.state.owns_store:
            app.state.store.close()


def create_app(
    settings: Settings | None = None,
    store: ReadingStore | None = None,
    clock: Any = None,
    start_mqtt: bool = True,
) -> FastAPI:
    """Build the FastAPI app used by `python -m hub` and by the tests.

    Inputs: optional settings, store, and clock so tests can inject a
    ManualClock and a temp database. start_mqtt=False skips the broker.
    Output: a FastAPI app with only GET routes.
    """
    settings = settings or load_settings()
    clock = clock or SystemClock()
    owns_store = store is None
    store = store or ReadingStore(settings.database_path)
    gateway = MqttGateway(settings, store, clock)

    app = FastAPI(title="Residential HVAC Monitor", lifespan=lifespan)
    app.state.settings = settings
    app.state.store = store
    app.state.clock = clock
    app.state.gateway = gateway
    app.state.start_mqtt = start_mqtt
    app.state.owns_store = owns_store

    @app.get("/")
    def home() -> FileResponse:
        """Serve the live HTML page. Display only; the file has no controls."""
        return FileResponse(settings.web_dir / "index.html")

    @app.get("/api/readings")
    def readings(response: Response) -> dict:
        """Latest point snapshot for the page.

        Cache-Control: no-store so a phone never shows a cached old number
        as if it were current. Stale or bad values are already None here.
        """
        response.headers["Cache-Control"] = "no-store"
        body = public_snapshot(settings, store, clock.now())
        body["mqtt_connected"] = gateway.connected
        return body

    @app.get("/api/health")
    def health() -> dict:
        """Tiny liveness check. mqtt_connected false usually means no broker."""
        return {"ok": True, "mqtt_connected": gateway.connected}

    # CSS and JS for the live page. html=False so a missing file is 404, not an index.
    app.mount(
        "/static",
        StaticFiles(directory=settings.web_dir, html=False),
        name="static",
    )
    return app
