"""The standardized API error envelope.

Every error response the backend returns conforms to this shape:

.. code-block:: json

    {"error": {"code": "ROOM_NOT_FOUND", "message": "Room not found."}}

Declaring it as a Pydantic model (rather than assembling dicts ad hoc) puts the
shape into the OpenAPI output, so frontend developers see the error contract in
``/docs`` without reading backend source.
"""

from __future__ import annotations

from pydantic import BaseModel, ConfigDict, Field


class ErrorDetail(BaseModel):
    """The inner payload of an :class:`ErrorResponse`."""

    model_config = ConfigDict(
        json_schema_extra={"examples": [{"code": "ROOM_NOT_FOUND", "message": "Room not found."}]}
    )

    code: str = Field(
        description="Machine-readable uppercase error code.",
        examples=["ROOM_NOT_FOUND"],
    )
    message: str = Field(
        min_length=1,
        max_length=500,
        description="Human-readable, display-safe message. Never contains secrets, "
        "raw database payloads, SQL, LLM prompt text, or stack traces.",
        examples=["Room not found."],
    )


class ErrorResponse(BaseModel):
    """The single error envelope returned by every failing endpoint."""

    model_config = ConfigDict(
        json_schema_extra={
            "examples": [{"error": {"code": "ROOM_NOT_FOUND", "message": "Room not found."}}]
        }
    )

    error: ErrorDetail


def error_body(code: str, message: str) -> dict[str, dict[str, str]]:
    """Build a serialized :class:`ErrorResponse` body.

    Args:
        code: Machine-readable uppercase error code.
        message: Developer-authored, display-safe message.

    Returns:
        A plain dict suitable for a ``JSONResponse`` content argument.
    """
    return ErrorResponse(error=ErrorDetail(code=code, message=message)).model_dump()
