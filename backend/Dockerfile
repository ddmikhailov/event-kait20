FROM python:3.12.10-slim AS runtime
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
WORKDIR /app
COPY backend/pyproject.toml ./backend/pyproject.toml
COPY backend/src ./backend/src
RUN python -m pip install --no-cache-dir ./backend
USER 65532:65532
EXPOSE 3000
CMD ["uvicorn", "event_api.main:app", "--host", "0.0.0.0", "--port", "3000"]
