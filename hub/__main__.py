import logging

import uvicorn

from hub.config import load_settings


def main() -> None:
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
    uvicorn.run(
        "hub.app:create_app",
        factory=True,
        host=settings.host,
        port=settings.port,
        reload=False,
    )


if __name__ == "__main__":
    main()
