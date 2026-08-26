from __future__ import annotations

from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from .config import get_settings
from .database import Database
from .errors import ApiError, api_error_handler, validation_error_handler
from .routers import (
    attendance,
    auth,
    events,
    excel,
    participants,
    registrations,
    reporting,
    staff,
)
from .security import RateLimiter, verify_csrf


@asynccontextmanager
async def lifespan(app: FastAPI):
    with app.state.database.connect() as connection:
        connection.exec_driver_sql("SELECT 1")
    yield
    app.state.database.dispose()


def create_app() -> FastAPI:
    settings = get_settings()
    app = FastAPI(title="Event Registration API", version="1.0.0", lifespan=lifespan)
    app.state.settings = settings
    app.state.database = Database(settings)
    app.state.rate_limiter = RateLimiter(settings)
    app.add_exception_handler(ApiError, api_error_handler)  # type: ignore[arg-type]
    from fastapi.exceptions import RequestValidationError

    app.add_exception_handler(
        RequestValidationError,
        validation_error_handler,  # type: ignore[arg-type]
    )
    app.add_middleware(
        CORSMiddleware,
        allow_origins=[str(origin).rstrip("/") for origin in settings.cors_origins],
        allow_credentials=True,
        allow_methods=["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
        allow_headers=["Content-Type", "X-CSRF-Token"],
    )

    @app.middleware("http")
    async def protect_cookie_mutations(request: Request, call_next):  # type: ignore[no-untyped-def]
        if request.method not in {"GET", "HEAD", "OPTIONS"}:
            origin = request.headers.get("origin", "").rstrip("/")
            trusted = {str(item).rstrip("/") for item in settings.cors_origins}
            if origin not in trusted:
                return JSONResponse(
                    status_code=403,
                    content={
                        "error": {
                            "code": "ORIGIN_REJECTED",
                            "message": "Request origin is not trusted",
                        }
                    },
                )
            cookie = request.cookies.get("staff_session")
            if cookie:
                supplied = request.headers.get("x-csrf-token", "")
                if not supplied or not verify_csrf(
                    cookie, supplied, settings.session_secret
                ):
                    return JSONResponse(
                        status_code=403,
                        content={
                            "error": {
                                "code": "CSRF_REJECTED",
                                "message": "CSRF validation failed",
                            }
                        },
                    )
        return await call_next(request)

    @app.get("/health")
    @app.get("/health/live")
    def live() -> dict[str, str]:
        return {"status": "ok"}

    @app.get("/health/ready")
    def ready() -> dict[str, str]:
        with app.state.database.connect() as connection:
            connection.exec_driver_sql("SELECT 1")
        return {"status": "ready"}

    for router in (
        auth.router,
        staff.router,
        events.admin,
        events.scanner,
        registrations.public,
        registrations.tickets,
        registrations.scanner,
        registrations.admin,
        participants.people,
        participants.registrations,
        participants.scanner,
        attendance.router,
        reporting.router,
        excel.router,
    ):
        app.include_router(router)
    return app


app = create_app()


def run() -> None:
    import uvicorn

    settings = get_settings()
    uvicorn.run("event_api.main:app", host=settings.api_host, port=settings.api_port)
