FROM python:3.12-slim@sha256:7a8b475003c4fe15a2cd4e55e5cfc2f3560bdc9333d624f24cdd6d4340fd7a17 AS runtime
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
WORKDIR /app
RUN apt-get update && apt-get upgrade -y && rm -rf /var/lib/apt/lists/*
COPY backend/pyproject.toml ./backend/pyproject.toml
COPY backend/src ./backend/src
COPY backend/migrations ./migrations
RUN python -m pip install --no-cache-dir ./backend
ENV MIGRATIONS_DIR=/app/migrations
USER 65532:65532
EXPOSE 3000
CMD ["uvicorn", "event_api.main:app", "--host", "0.0.0.0", "--port", "3000"]
