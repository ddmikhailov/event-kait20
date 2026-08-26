import logging
import re
from typing import Any
from uuid import uuid4

from fastapi import Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse

LOGGER = logging.getLogger("event_api")


class ApiError(Exception):
    def __init__(
        self,
        status: int,
        code: str,
        message: str,
        details: dict[str, Any] | None = None,
    ) -> None:
        super().__init__(message)
        self.status = status
        self.code = code
        self.message = message
        self.details = details


def error_response(request: Request, error: ApiError) -> JSONResponse:
    supplied = request.headers.get("x-request-id", "")
    request_id = (
        supplied if re.fullmatch(r"[A-Za-z0-9._:-]{1,64}", supplied) else str(uuid4())
    )
    payload: dict[str, Any] = {
        "error": {
            "code": error.code,
            "message": error.message,
            "requestId": request_id,
        }
    }
    if error.details:
        payload["error"]["details"] = error.details
    return JSONResponse(status_code=error.status, content=payload)


async def api_error_handler(request: Request, error: ApiError) -> JSONResponse:
    return error_response(request, error)


async def validation_error_handler(
    request: Request, error: RequestValidationError
) -> JSONResponse:
    fields = [
        ".".join(str(part) for part in item["loc"][1:]) for item in error.errors()
    ]
    return error_response(
        request,
        ApiError(
            400, "VALIDATION_ERROR", "Request validation failed", {"fields": fields}
        ),
    )


async def unexpected_error_handler(request: Request, error: Exception) -> JSONResponse:
    route = request.scope.get("route")
    template = getattr(route, "path", "unknown")
    LOGGER.error("Unhandled error type=%s route=%s", type(error).__name__, template)
    return error_response(
        request, ApiError(500, "INTERNAL_ERROR", "Request could not be completed")
    )
