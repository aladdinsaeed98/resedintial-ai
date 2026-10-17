"""HTTP surface for the bench page. Every route is a read."""

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
        return FileResponse(settings.web_dir / "index.html")

    @app.get("/api/readings")
    def readings(response: Response) -> dict:
        response.headers["Cache-Control"] = "no-store"
        body = public_snapshot(settings, store, clock.now())
        body["mqtt_connected"] = gateway.connected
        return body

    @app.get("/api/health")
    def health() -> dict:
        return {"ok": True, "mqtt_connected": gateway.connected}

    app.mount(
        "/static",
        StaticFiles(directory=settings.web_dir, html=False),
        name="static",
    )
    return app
