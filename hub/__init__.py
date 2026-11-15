"""Read-only residential HVAC monitor hub.

This package is the home-network brain of the bench: it listens to sensor
nodes, stores what they send, and serves the live page. Data flows one way:

    ESP32 or simulator
        -> MQTT topic hvac/<node>/reading
        -> gateway (hub/gateway.py) listens only
        -> store (hub/store.py)
        -> FastAPI (hub/app.py)
        -> live page (web/)

Nothing here can start, stop, or change a furnace, thermostat, or condenser.
If the page is empty, check Mosquitto first, then the `python -m hub` logs.
"""

# Phase 1 bench. Bump this when the API shape changes.
__version__ = "0.1.0"
