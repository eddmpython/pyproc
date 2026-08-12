"""Strict version 1 codec for the pyproc Control Protocol."""

from __future__ import annotations

import json
import math
import re
from typing import Any

CONTROL_PROTOCOL = "pyproc-control"
CONTROL_VERSION = 1
CONTROL_MAX_FRAME_BYTES = 1024 * 1024
CONTROL_ATTACHMENT_CHUNK_BYTES = 256 * 1024
CONTROL_MAX_ATTACHMENT_BYTES = 64 * 1024 * 1024

idPattern = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$")
namePattern = re.compile(r"^[a-z][a-z0-9]*(?:\.[a-z][a-z0-9]*)+$")
codePattern = re.compile(r"^[A-Z][A-Z0-9_]{2,95}$")
mimePattern = re.compile(r"^[a-z0-9][a-z0-9.+-]*/[a-z0-9][a-z0-9.+-]*$")
shaPattern = re.compile(r"^[0-9a-f]{64}$")
frameTypes = {"hello", "request", "response", "error", "cancel", "event", "attachment"}
successOutcomes = {"observed", "applied"}
errorOutcomes = {"notSent", "rejected", "applied", "outcomeUnknown"}


class ControlProtocolError(ValueError):
    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code


def fail(code: str, message: str) -> None:
    raise ControlProtocolError(code, message)


def assertObject(value: Any, label: str) -> dict[str, Any]:
    if not isinstance(value, dict):
        fail("CONTROL_INVALID_FRAME", f"{label} must be an object")
    return value


def assertExact(value: dict[str, Any], allowed: set[str], required: set[str], label: str) -> None:
    unknown = set(value) - allowed
    missing = required - set(value)
    if unknown:
        fail("CONTROL_INVALID_FRAME", f"{label} has unknown field: {sorted(unknown)[0]}")
    if missing:
        fail("CONTROL_INVALID_FRAME", f"{label} is missing field: {sorted(missing)[0]}")


def assertId(value: Any, label: str) -> str:
    if not isinstance(value, str) or idPattern.fullmatch(value) is None:
        fail("CONTROL_INVALID_FRAME", f"{label} is invalid")
    return value


def assertName(value: Any, label: str) -> str:
    if not isinstance(value, str) or namePattern.fullmatch(value) is None:
        fail("CONTROL_INVALID_FRAME", f"{label} is invalid")
    return value


def assertJson(value: Any, label: str, depth: int = 0) -> None:
    if depth > 64:
        fail("CONTROL_INVALID_FRAME", f"{label} exceeds nesting limit")
    if value is None or isinstance(value, (str, bool)):
        return
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        if isinstance(value, float) and not math.isfinite(value):
            fail("CONTROL_INVALID_FRAME", f"{label} is not finite")
        return
    if isinstance(value, list):
        for index, child in enumerate(value):
            assertJson(child, f"{label}[{index}]", depth + 1)
        return
    if isinstance(value, dict):
        if any(not isinstance(key, str) for key in value):
            fail("CONTROL_INVALID_FRAME", f"{label} has a non-string key")
        for key, child in value.items():
            assertJson(child, f"{label}.{key}", depth + 1)
        return
    fail("CONTROL_INVALID_FRAME", f"{label} is not a JSON value")


def assertCapabilities(value: Any) -> None:
    capabilities = assertObject(value, "hello.capabilities")
    assertExact(capabilities, {"cancel", "events", "attachments"},
                {"cancel", "events", "attachments"}, "hello.capabilities")
    if not isinstance(capabilities["cancel"], bool) or not isinstance(capabilities["events"], bool):
        fail("CONTROL_INVALID_FRAME", "hello capabilities are invalid")
    attachments = assertObject(capabilities["attachments"], "hello.capabilities.attachments")
    assertExact(attachments, {"encoding", "maxChunkBytes"}, {"encoding", "maxChunkBytes"},
                "hello.capabilities.attachments")
    chunkBytes = attachments["maxChunkBytes"]
    if attachments["encoding"] != "base64" or not isinstance(chunkBytes, int) or isinstance(chunkBytes, bool) \
            or chunkBytes < 1 or chunkBytes > CONTROL_ATTACHMENT_CHUNK_BYTES:
        fail("CONTROL_INVALID_FRAME", "hello attachment capability is invalid")


def assertDescriptor(value: Any) -> None:
    descriptor = assertObject(value, "response.attachments[]")
    keys = {"attachmentId", "kind", "mimeType", "byteLength", "sha256"}
    assertExact(descriptor, keys, keys, "response.attachments[]")
    assertId(descriptor["attachmentId"], "response attachmentId")
    assertName(descriptor["kind"], "response attachment kind")
    if not isinstance(descriptor["mimeType"], str) or mimePattern.fullmatch(descriptor["mimeType"]) is None:
        fail("CONTROL_INVALID_FRAME", "response attachment mimeType is invalid")
    byteLength = descriptor["byteLength"]
    if not isinstance(byteLength, int) or isinstance(byteLength, bool) or byteLength < 0:
        fail("CONTROL_INVALID_FRAME", "response attachment byteLength is invalid")
    if not isinstance(descriptor["sha256"], str) or shaPattern.fullmatch(descriptor["sha256"]) is None:
        fail("CONTROL_INVALID_FRAME", "response attachment sha256 is invalid")


def assertError(value: Any) -> None:
    payload = assertObject(value, "error.error")
    assertExact(payload, {"code", "message", "retryable", "outcome", "details"},
                {"code", "message", "retryable", "outcome"}, "error.error")
    if not isinstance(payload["code"], str) or codePattern.fullmatch(payload["code"]) is None:
        fail("CONTROL_INVALID_FRAME", "error code is invalid")
    if not isinstance(payload["message"], str) or not 1 <= len(payload["message"]) <= 2000:
        fail("CONTROL_INVALID_FRAME", "error message is invalid")
    if not isinstance(payload["retryable"], bool) or payload["outcome"] not in errorOutcomes:
        fail("CONTROL_INVALID_FRAME", "error metadata is invalid")
    if payload["outcome"] in {"applied", "outcomeUnknown"} and payload["retryable"]:
        fail("CONTROL_INVALID_FRAME", "uncertain or applied error cannot be retryable")
    if "details" in payload:
        assertJson(payload["details"], "error.error.details")


def validateFrame(frame: Any) -> dict[str, Any]:
    value = assertObject(frame, "control frame")
    if value.get("protocol") != CONTROL_PROTOCOL:
        fail("CONTROL_INVALID_FRAME", "control protocol name is invalid")
    if value.get("version") != CONTROL_VERSION:
        fail("CONTROL_VERSION_UNSUPPORTED", f"control protocol version is unsupported: {value.get('version')}")
    frameType = value.get("type")
    if frameType not in frameTypes:
        fail("CONTROL_INVALID_FRAME", f"control frame type is invalid: {frameType}")
    common = {"protocol", "version", "type"}
    if frameType == "hello":
        assertExact(value, common | {"requestId", "role", "peer", "capabilities", "operations"},
                    common | {"requestId", "role", "peer", "capabilities"}, "hello")
        assertId(value["requestId"], "hello.requestId")
        if value["role"] not in {"client", "server"}:
            fail("CONTROL_INVALID_FRAME", "hello.role is invalid")
        peer = assertObject(value["peer"], "hello.peer")
        assertExact(peer, {"name", "version"}, {"name", "version"}, "hello.peer")
        if not isinstance(peer["name"], str) or not 1 <= len(peer["name"]) <= 80 \
                or not isinstance(peer["version"], str) or not 1 <= len(peer["version"]) <= 40:
            fail("CONTROL_INVALID_FRAME", "hello.peer is invalid")
        assertCapabilities(value["capabilities"])
        if value["role"] == "client" and "operations" in value:
            fail("CONTROL_INVALID_FRAME", "client hello cannot declare operations")
        if value["role"] == "server":
            operations = value.get("operations")
            if not isinstance(operations, list) or len(set(operations)) != len(operations):
                fail("CONTROL_INVALID_FRAME", "server hello operations are invalid")
            for operation in operations:
                assertName(operation, "hello operation")
    elif frameType == "request":
        assertExact(value, common | {"requestId", "operation", "input", "spaceId"},
                    common | {"requestId", "operation", "input"}, "request")
        assertId(value["requestId"], "request.requestId")
        assertName(value["operation"], "request.operation")
        assertObject(value["input"], "request.input")
        assertJson(value["input"], "request.input")
        if "spaceId" in value:
            assertId(value["spaceId"], "request.spaceId")
    elif frameType == "cancel":
        assertExact(value, common | {"requestId", "reason"}, common | {"requestId"}, "cancel")
        assertId(value["requestId"], "cancel.requestId")
        if "reason" in value and (not isinstance(value["reason"], str) or len(value["reason"]) > 200):
            fail("CONTROL_INVALID_FRAME", "cancel.reason is invalid")
    elif frameType == "event":
        assertExact(value, common | {"eventId", "requestId", "name", "data"},
                    common | {"eventId", "name", "data"}, "event")
        assertId(value["eventId"], "event.eventId")
        if "requestId" in value:
            assertId(value["requestId"], "event.requestId")
        assertName(value["name"], "event.name")
        assertJson(value["data"], "event.data")
    elif frameType == "attachment":
        allowed = common | {"requestId", "attachmentId", "mimeType", "offset", "dataBase64", "eof",
                            "byteLength", "sha256"}
        required = common | {"requestId", "attachmentId", "mimeType", "offset", "dataBase64", "eof"}
        assertExact(value, allowed, required, "attachment")
        assertId(value["requestId"], "attachment.requestId")
        assertId(value["attachmentId"], "attachment.attachmentId")
        if not isinstance(value["mimeType"], str) or mimePattern.fullmatch(value["mimeType"]) is None:
            fail("CONTROL_ATTACHMENT_INVALID", "attachment mimeType is invalid")
        if not isinstance(value["offset"], int) or isinstance(value["offset"], bool) or value["offset"] < 0 \
                or not isinstance(value["dataBase64"], str) or not isinstance(value["eof"], bool):
            fail("CONTROL_ATTACHMENT_INVALID", "attachment chunk metadata is invalid")
        if value["eof"]:
            if not isinstance(value.get("byteLength"), int) or isinstance(value.get("byteLength"), bool) \
                    or value["byteLength"] < 0 or not isinstance(value.get("sha256"), str) \
                    or shaPattern.fullmatch(value["sha256"]) is None:
                fail("CONTROL_ATTACHMENT_INVALID", "final attachment metadata is invalid")
        elif "byteLength" in value or "sha256" in value:
            fail("CONTROL_ATTACHMENT_INVALID", "non-final attachment cannot carry terminal metadata")
    elif frameType == "response":
        assertExact(value, common | {"requestId", "output", "outcome", "attachments"},
                    common | {"requestId", "output", "outcome"}, "response")
        assertId(value["requestId"], "response.requestId")
        if value["outcome"] not in successOutcomes:
            fail("CONTROL_INVALID_FRAME", "response outcome is invalid")
        assertJson(value["output"], "response.output")
        assertDescriptors(value.get("attachments"))
    elif frameType == "error":
        assertExact(value, common | {"requestId", "fatal", "error", "attachments"},
                    common | {"error"}, "error")
        fatal = value.get("fatal") is True
        if fatal:
            if "requestId" in value or "attachments" in value:
                fail("CONTROL_INVALID_FRAME", "fatal error cannot belong to a request or carry attachments")
        else:
            if "fatal" in value:
                fail("CONTROL_INVALID_FRAME", "error.fatal must be true when present")
            assertId(value.get("requestId"), "error.requestId")
        assertError(value["error"])
        assertDescriptors(value.get("attachments"))
    return value


def assertDescriptors(descriptors: Any) -> None:
    if descriptors is None:
        return
    if not isinstance(descriptors, list):
        fail("CONTROL_INVALID_FRAME", "response.attachments must be an array")
    seen: set[str] = set()
    for descriptor in descriptors:
        assertDescriptor(descriptor)
        if descriptor["attachmentId"] in seen:
            fail("CONTROL_INVALID_FRAME", f"duplicate response attachment: {descriptor['attachmentId']}")
        seen.add(descriptor["attachmentId"])


def controlBase(frameType: str) -> dict[str, Any]:
    return {"protocol": CONTROL_PROTOCOL, "version": CONTROL_VERSION, "type": frameType}


def encodeFrame(frame: dict[str, Any]) -> str:
    validateFrame(frame)
    try:
        text = json.dumps(frame, ensure_ascii=False, allow_nan=False, separators=(",", ":"))
    except (TypeError, ValueError) as error:
        fail("CONTROL_INVALID_FRAME", f"control frame is not JSON: {error}")
    if len(text.encode("utf-8")) > CONTROL_MAX_FRAME_BYTES:
        fail("CONTROL_FRAME_TOO_LARGE", "control frame exceeds the byte limit")
    return text + "\n"


def decodeFrame(line: str) -> dict[str, Any]:
    if not isinstance(line, str):
        fail("CONTROL_INVALID_FRAME", "control frame must be text")
    if len(line.encode("utf-8")) > CONTROL_MAX_FRAME_BYTES:
        fail("CONTROL_FRAME_TOO_LARGE", "control frame exceeds the byte limit")
    try:
        frame = json.loads(line, parse_constant=lambda value: fail(
            "CONTROL_INVALID_FRAME", f"control frame contains {value}"))
    except json.JSONDecodeError as error:
        fail("CONTROL_INVALID_FRAME", f"control frame is not valid JSON: {error.msg}")
    return validateFrame(frame)
