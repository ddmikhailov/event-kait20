from __future__ import annotations

from contextlib import asynccontextmanager

from fastapi import FastAPI, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from sqlalchemy.exc import SQLAlchemyError

from .config import Settings, get_settings
from .database import Database
from .errors import (
    ApiError,
    api_error_handler,
    unexpected_error_handler,
    validation_error_handler,
)
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


def create_app(settings_override: Settings | None = None) -> FastAPI:
    settings = settings_override if settings_override is not None else get_settings()
    production = settings.production
    app = FastAPI(
        title="Event Registration API",
        version="1.0.0",
        lifespan=lifespan,
        docs_url=None if production else "/docs",
        redoc_url=None if production else "/redoc",
        openapi_url=None if production else "/openapi.json",
    )
    app.state.settings = settings
    app.state.database = Database(settings)
    app.state.rate_limiter = RateLimiter(settings, app.state.database)
    app.add_exception_handler(ApiError, api_error_handler)  # type: ignore[arg-type]
    from fastapi.exceptions import RequestValidationError

    app.add_exception_handler(
        RequestValidationError,
        validation_error_handler,  # type: ignore[arg-type]
    )
    app.add_exception_handler(Exception, unexpected_error_handler)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=[str(origin).rstrip("/") for origin in settings.cors_origins],
        allow_credentials=True,
        allow_methods=["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
        allow_headers=["Content-Type", "X-CSRF-Token"],
    )

    def add_security_headers(response: Response, request: Request) -> Response:
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["X-Frame-Options"] = "DENY"
        response.headers["Referrer-Policy"] = "no-referrer"
        response.headers["Permissions-Policy"] = (
            "camera=(), microphone=(), geolocation=()"
        )
        if request.url.path.startswith(("/auth", "/admin", "/scanner", "/tickets")):
            response.headers["Cache-Control"] = "no-store"
        if production:
            response.headers["Strict-Transport-Security"] = (
                "max-age=31536000; includeSubDomains"
            )
        return response

    @app.middleware("http")
    async def security_headers(request: Request, call_next):  # type: ignore[no-untyped-def]
        return add_security_headers(await call_next(request), request)

    @app.middleware("http")
    async def protect_cookie_mutations(request: Request, call_next):  # type: ignore[no-untyped-def]
        if request.method not in {"GET", "HEAD", "OPTIONS"}:
            origin = request.headers.get("origin", "").rstrip("/")
            trusted = {str(item).rstrip("/") for item in settings.cors_origins}
            if origin not in trusted:
                return add_security_headers(
                    JSONResponse(
                        status_code=403,
                        content={
                            "error": {
                                "code": "ORIGIN_REJECTED",
                                "message": "Request origin is not trusted",
                            }
                        },
                    ),
                    request,
                )
            cookie = request.cookies.get("staff_session")
            public_auth = request.url.path in {
                "/auth/login",
                "/auth/password/forgot",
                "/auth/password/reset",
            } or request.url.path.startswith("/auth/invitations/")
            if cookie and not public_auth:
                supplied = request.headers.get("x-csrf-token", "")
                if not supplied or not verify_csrf(
                    cookie, supplied, settings.session_secret
                ):
                    return add_security_headers(
                        JSONResponse(
                            status_code=403,
                            content={
                                "error": {
                                    "code": "CSRF_REJECTED",
                                    "message": "CSRF validation failed",
                                }
                            },
                        ),
                        request,
                    )
        return await call_next(request)

    @app.get("/health")
    @app.get("/health/live")
    def live() -> dict[str, str]:
        return {"status": "ok"}

    @app.get("/health/ready")
    def ready() -> dict[str, str]:
        try:
            with app.state.database.connect() as connection:
                connection.exec_driver_sql("SELECT 1")
        except SQLAlchemyError as error:
            raise ApiError(
                503, "SERVICE_UNAVAILABLE", "Service is not ready"
            ) from error
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
