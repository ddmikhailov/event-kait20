"""Enable template-only operational records in the process entrypoints."""

import logging


def enable_operational_logging() -> None:
    # Uvicorn configures its own loggers, but not the application logger.
    # Keep other libraries at their default warning threshold.
    logging.basicConfig(
        level=logging.WARNING,
        format="%(asctime)s %(levelname)s %(name)s %(message)s",
    )
    logging.getLogger("event_api").setLevel(logging.INFO)
