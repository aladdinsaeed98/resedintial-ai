"""Start the hub from `python -m hub`.

Wires logging, loads settings, and runs the FastAPI app. This is the
process that must be running for the live page at http://127.0.0.1:8000.
If that page never loads, this module (or uvicorn) is the first place to look.
"""

import logging

import uvicorn

from hub.config import load_settings


def main() -> None:
    """Boot the read-only HTTP server with the settings from the environment.

    No MQTT messages are sent from here. The gateway inside the app only
    listens. Ctrl+C stops the process; it does not touch any equipment.
    """
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)s %(name)s: %(message)s",
    )
    settings = load_settings()
    logging.getLogger("hub").info(
        "Monitor-only hub listening on %s:%s. Open http://127.0.0.1:%s",
        settings.host,
        settings.port,
        settings.port,
    )
    # factory=True so each process builds a fresh app (store + MQTT client).
    uvicorn.run(
        "hub.app:create_app",
        factory=True,
        host=settings.host,
        port=settings.port,
        reload=False,
    )


if __name__ == "__main__":
    main()
