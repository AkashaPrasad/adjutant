"""Consistent error model: every error response is {"error": {"code", "message"}}."""

from __future__ import annotations

import logging

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

log = logging.getLogger("adjutant.errors")


class ApiError(Exception):
    def __init__(self, status_code: int, code: str, message: str) -> None:
        super().__init__(message)
        self.status_code = status_code
        self.code = code
        self.message = message


def not_found(what: str) -> ApiError:
    return ApiError(404, "not_found", f"{what} not found")


def conflict(code: str, message: str) -> ApiError:
    return ApiError(409, code, message)


def _body(code: str, message: str, details: list | None = None) -> dict:
    error: dict = {"code": code, "message": message}
    if details:
        error["details"] = details
    return {"error": error}


_HTTP_CODES = {400: "bad_request", 404: "not_found", 405: "method_not_allowed", 413: "payload_too_large"}


def install_error_handlers(app: FastAPI) -> None:
    @app.exception_handler(ApiError)
    async def _api_error(_: Request, exc: ApiError) -> JSONResponse:
        return JSONResponse(_body(exc.code, exc.message), status_code=exc.status_code)

    @app.exception_handler(RequestValidationError)
    async def _validation_error(_: Request, exc: RequestValidationError) -> JSONResponse:
        details = [
            {"loc": ".".join(str(p) for p in err.get("loc", ())), "msg": err.get("msg", "")} for err in exc.errors()
        ]
        message = "; ".join(f"{d['loc']}: {d['msg']}" for d in details[:3]) or "invalid request"
        return JSONResponse(_body("validation_error", message, details), status_code=422)

    @app.exception_handler(StarletteHTTPException)
    async def _http_error(_: Request, exc: StarletteHTTPException) -> JSONResponse:
        code = _HTTP_CODES.get(exc.status_code, "http_error")
        return JSONResponse(_body(code, str(exc.detail)), status_code=exc.status_code)

    @app.exception_handler(Exception)
    async def _unhandled(_: Request, exc: Exception) -> JSONResponse:
        log.exception("unhandled error: %s", exc)
        return JSONResponse(_body("internal_error", "internal server error"), status_code=500)
