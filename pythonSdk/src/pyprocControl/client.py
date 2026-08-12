"""Synchronous and cancellable Python client for the installed pyproc product."""

from __future__ import annotations

import base64
import hashlib
import json
import os
import shutil
import subprocess
import threading
from collections import deque
from concurrent.futures import Future
from pathlib import Path
from typing import Any, BinaryIO, Callable, Sequence, TextIO

from .models import Attachment, ControlError, ControlResult
from .protocol import (
    CONTROL_ATTACHMENT_CHUNK_BYTES,
    CONTROL_MAX_ATTACHMENT_BYTES,
    controlBase,
    decodeFrame,
    encodeFrame,
)


def resolvedCommand(command: str | os.PathLike[str] | Sequence[str | os.PathLike[str]] | None) -> list[str]:
    if command is None:
        found = shutil.which("pyproc-control")
        if not found:
            raise FileNotFoundError("pyproc-control was not found on PATH; install the pyproc npm package or pass command")
        return [found]
    if isinstance(command, (str, os.PathLike)):
        return [os.fspath(command)]
    values = [os.fspath(value) for value in command]
    if not values:
        raise ValueError("command must not be empty")
    return values


class ControlRequest:
    def __init__(self, client: "PyProcClient", requestId: str, future: Future[ControlResult]) -> None:
        self.client = client
        self.requestId = requestId
        self.future = future

    def result(self, timeout: float | None = None) -> ControlResult:
        return self.future.result(timeout)

    def cancel(self, reason: str = "Python client cancelled the request") -> bool:
        return self.client.cancel(self.requestId, reason)

    def done(self) -> bool:
        return self.future.done()


class PyProcClient:
    def __init__(self, readable: TextIO, writable: TextIO, *, process: subprocess.Popen[str] | None = None,
                 stderr: TextIO | None = None, startupTimeout: float = 30.0,
                 eventHandler: Callable[[dict[str, Any]], None] | None = None) -> None:
        self.readable = readable
        self.writable = writable
        self.process = process
        self.eventHandler = eventHandler
        self.operations: tuple[str, ...] = ()
        self._pending: dict[str, dict[str, Any]] = {}
        self._used: set[str] = set()
        self._events: set[str] = set()
        self._sequence = 0
        self._writeLock = threading.Lock()
        self._stateLock = threading.RLock()
        self._helloEvent = threading.Event()
        self._helloError: BaseException | None = None
        self._helloId = "hello:python"
        self._closed = False
        self._diagnostics: deque[str] = deque(maxlen=200)
        self._readerThread = threading.Thread(target=self._readerLoop, name="pyprocControlReader", daemon=True)
        self._readerThread.start()
        self._stderrThread: threading.Thread | None = None
        if stderr is not None:
            self._stderrThread = threading.Thread(target=self._stderrLoop, args=(stderr,),
                                                  name="pyprocControlStderr", daemon=True)
            self._stderrThread.start()
        self._sendFrame({
            **controlBase("hello"), "requestId": self._helloId, "role": "client",
            "peer": {"name": "pyproc-python", "version": "1"},
            "capabilities": {"cancel": True, "events": True,
                             "attachments": {"encoding": "base64",
                                             "maxChunkBytes": CONTROL_ATTACHMENT_CHUNK_BYTES}},
        })
        if not self._helloEvent.wait(startupTimeout):
            self.close()
            raise TimeoutError(f"pyproc-control hello timed out\n{self.diagnostics}")
        if self._helloError is not None:
            self.close()
            raise self._helloError

    @classmethod
    def start(cls, configPath: str | os.PathLike[str], *,
              command: str | os.PathLike[str] | Sequence[str | os.PathLike[str]] | None = None,
              startupTimeout: float = 30.0,
              eventHandler: Callable[[dict[str, Any]], None] | None = None,
              environment: dict[str, str] | None = None) -> "PyProcClient":
        args = [*resolvedCommand(command), "--config", str(Path(configPath).resolve())]
        process = subprocess.Popen(
            args,
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            encoding="utf-8",
            errors="strict",
            bufsize=1,
            env=environment,
        )
        if process.stdin is None or process.stdout is None or process.stderr is None:
            process.kill()
            raise RuntimeError("pyproc-control stdio pipes were not created")
        try:
            return cls(process.stdout, process.stdin, process=process, stderr=process.stderr,
                       startupTimeout=startupTimeout, eventHandler=eventHandler)
        except BaseException:
            if process.poll() is None:
                process.terminate()
            raise

    @classmethod
    def check(cls, configPath: str | os.PathLike[str], *,
              command: str | os.PathLike[str] | Sequence[str | os.PathLike[str]] | None = None,
              timeout: float = 30.0) -> dict[str, Any]:
        args = [*resolvedCommand(command), "--config", str(Path(configPath).resolve()), "--check"]
        completed = subprocess.run(args, text=True, encoding="utf-8", errors="strict",
                                   capture_output=True, timeout=timeout, check=True)
        report = json.loads(completed.stdout)
        if not isinstance(report, dict) or report.get("ok") is not True:
            raise RuntimeError("pyproc-control preflight did not return an ok report")
        return report

    @property
    def diagnostics(self) -> str:
        with self._stateLock:
            return "".join(self._diagnostics)

    def _stderrLoop(self, stderr: TextIO) -> None:
        try:
            for line in stderr:
                with self._stateLock:
                    self._diagnostics.append(line)
        except BaseException:
            return

    def _sendFrame(self, frame: dict[str, Any]) -> None:
        text = encodeFrame(frame)
        with self._writeLock:
            if self._closed:
                raise RuntimeError("pyproc control client is closed")
            self.writable.write(text)
            self.writable.flush()

    def _readerLoop(self) -> None:
        try:
            while True:
                line = self.readable.readline()
                if line == "":
                    raise EOFError("pyproc-control closed stdout")
                self._acceptFrame(decodeFrame(line))
        except BaseException as error:
            self._failAll(error)

    def _acceptFrame(self, frame: dict[str, Any]) -> None:
        if frame["type"] == "error" and frame.get("fatal") is True:
            raise ControlError(frame["error"], fatal=True)
        with self._stateLock:
            if not self._helloEvent.is_set():
                if frame["type"] != "hello" or frame["role"] != "server" \
                        or frame["requestId"] != self._helloId:
                    raise RuntimeError("control server did not answer with the matching hello")
                self.operations = tuple(frame["operations"])
                self._helloEvent.set()
                return
            frameType = frame["type"]
            if frameType == "event":
                if frame["eventId"] in self._events:
                    raise RuntimeError(f"duplicate control event: {frame['eventId']}")
                self._events.add(frame["eventId"])
                handler = self.eventHandler
                if handler is not None:
                    handler(frame)
                return
            if frameType not in {"attachment", "response", "error"}:
                raise RuntimeError(f"control server sent an invalid frame direction: {frameType}")
            requestId = frame["requestId"]
            pending = self._pending.get(requestId)
            if pending is None:
                raise RuntimeError(f"control server completed an unknown request: {requestId}")
            if frameType == "attachment":
                self._acceptAttachment(pending, frame)
                return
            attachments = self._terminalAttachments(pending, frame.get("attachments", []))
            self._pending.pop(requestId)
            future: Future[ControlResult] = pending["future"]
            if frameType == "error":
                future.set_exception(ControlError(frame["error"]))
            else:
                future.set_result(ControlResult(frame["output"], frame["outcome"], attachments))

    def _acceptAttachment(self, pending: dict[str, Any], frame: dict[str, Any]) -> None:
        try:
            chunk = base64.b64decode(frame["dataBase64"], validate=True)
        except (ValueError, TypeError) as error:
            raise RuntimeError("control attachment is not canonical base64") from error
        if base64.b64encode(chunk).decode("ascii") != frame["dataBase64"]:
            raise RuntimeError("control attachment is not canonical base64")
        if len(chunk) > CONTROL_ATTACHMENT_CHUNK_BYTES:
            raise RuntimeError("control attachment chunk exceeds the byte limit")
        states: dict[str, dict[str, Any]] = pending["attachments"]
        attachmentId = frame["attachmentId"]
        state = states.setdefault(attachmentId, {"mimeType": frame["mimeType"], "bytes": bytearray(),
                                                  "complete": False})
        if state["complete"] or state["mimeType"] != frame["mimeType"] \
                or len(state["bytes"]) != frame["offset"]:
            raise RuntimeError(f"control attachment chunk is out of order: {attachmentId}")
        state["bytes"].extend(chunk)
        if len(state["bytes"]) > CONTROL_MAX_ATTACHMENT_BYTES:
            raise RuntimeError(f"control attachment exceeds the byte limit: {attachmentId}")
        if frame["eof"]:
            actual = bytes(state["bytes"])
            digest = hashlib.sha256(actual).hexdigest()
            if frame["byteLength"] != len(actual) or frame["sha256"] != digest:
                raise RuntimeError(f"control attachment digest mismatch: {attachmentId}")
            state["complete"] = True
            state["sha256"] = digest

    def _terminalAttachments(self, pending: dict[str, Any], descriptors: list[dict[str, Any]]) -> tuple[Attachment, ...]:
        states: dict[str, dict[str, Any]] = pending["attachments"]
        declared: set[str] = set()
        values: list[Attachment] = []
        for descriptor in descriptors:
            attachmentId = descriptor["attachmentId"]
            state = states.get(attachmentId)
            if not state or not state["complete"] or state["mimeType"] != descriptor["mimeType"] \
                    or len(state["bytes"]) != descriptor["byteLength"] or state["sha256"] != descriptor["sha256"]:
                raise RuntimeError(f"control response attachment is incomplete: {attachmentId}")
            declared.add(attachmentId)
            values.append(Attachment(attachmentId, descriptor["kind"], descriptor["mimeType"],
                                     descriptor["byteLength"], descriptor["sha256"], bytes(state["bytes"])))
        if set(states) != declared:
            raise RuntimeError("control response omitted a received attachment")
        return tuple(values)

    def _failAll(self, error: BaseException) -> None:
        with self._stateLock:
            if not self._helloEvent.is_set():
                self._helloError = error
                self._helloEvent.set()
            for pending in self._pending.values():
                future: Future[ControlResult] = pending["future"]
                if not future.done():
                    future.set_exception(error)
            self._pending.clear()

    def requestAsync(self, operation: str, input: dict[str, Any] | None = None, *,
                     requestId: str | None = None, spaceId: str | None = None) -> ControlRequest:
        with self._stateLock:
            if self._closed:
                raise RuntimeError("pyproc control client is closed")
            self._sequence += 1
            currentId = requestId or f"request:{self._sequence}"
            if currentId in self._used:
                error = ControlError({"code": "CONTROL_REQUEST_DUPLICATE",
                                      "message": f"control request ID was already used: {currentId}",
                                      "retryable": False, "outcome": "notSent"})
                raise error
            self._used.add(currentId)
            future: Future[ControlResult] = Future()
            self._pending[currentId] = {"future": future, "attachments": {}}
        frame = {**controlBase("request"), "requestId": currentId, "operation": operation,
                 "input": input if input is not None else {}}
        if spaceId is not None:
            frame["spaceId"] = spaceId
        try:
            self._sendFrame(frame)
        except BaseException:
            with self._stateLock:
                self._pending.pop(currentId, None)
            raise
        return ControlRequest(self, currentId, future)

    def request(self, operation: str, input: dict[str, Any] | None = None, *,
                requestId: str | None = None, spaceId: str | None = None,
                timeout: float | None = None) -> ControlResult:
        return self.requestAsync(operation, input, requestId=requestId, spaceId=spaceId).result(timeout)

    def cancel(self, requestId: str, reason: str = "Python client cancelled the request") -> bool:
        with self._stateLock:
            if requestId not in self._pending:
                return False
        self._sendFrame({**controlBase("cancel"), "requestId": requestId, "reason": reason})
        return True

    def runPython(self, code: str, *, timeout: float | None = None) -> ControlResult:
        return self.request("machine.run", {"code": code}, timeout=timeout)

    def saveCheckpoint(self, *, timeout: float | None = None) -> ControlResult:
        return self.request("machine.checkpoint.save", timeout=timeout)

    def restoreCheckpoint(self, index: int | None = None, *, timeout: float | None = None) -> ControlResult:
        return self.request("machine.checkpoint.restore", {} if index is None else {"index": index}, timeout=timeout)

    def reset(self, *, timeout: float | None = None) -> ControlResult:
        return self.request("machine.reset", timeout=timeout)

    def inspectSpace(self, *, timeout: float | None = None) -> ControlResult:
        return self.request("automation.space.inspect", timeout=timeout)

    def listTargets(self, *, timeout: float | None = None) -> ControlResult:
        return self.request("automation.target.list", timeout=timeout)

    def openTarget(self, url: str, *, expectedRisk: str, waitUntil: str = "commit",
                   timeout: float | None = None) -> ControlResult:
        return self.request("automation.target.open", {"url": url, "expectedRisk": expectedRisk,
                                                       "waitUntil": waitUntil}, timeout=timeout)

    def attachSession(self, targetRef: str, *, timeout: float | None = None) -> ControlResult:
        return self.request("automation.session.attach", {"targetRef": targetRef}, timeout=timeout)

    def observe(self, sessionRef: str, options: dict[str, Any] | None = None, *,
                timeout: float | None = None) -> ControlResult:
        return self.request("automation.observe", {"sessionRef": sessionRef, **(options or {})}, timeout=timeout)

    def act(self, sessionRef: str, actions: list[dict[str, Any]], *,
            timeout: float | None = None) -> ControlResult:
        return self.request("automation.act", {"sessionRef": sessionRef, "actions": actions}, timeout=timeout)

    def command(self, sessionRef: str, method: str, params: dict[str, Any], *, expectedRisk: str,
                timeout: float | None = None) -> ControlResult:
        return self.request("automation.command", {"sessionRef": sessionRef, "method": method,
                                                    "params": params, "expectedRisk": expectedRisk}, timeout=timeout)

    def detachSession(self, sessionRef: str, *, timeout: float | None = None) -> ControlResult:
        return self.request("automation.session.detach", {"sessionRef": sessionRef}, timeout=timeout)

    def readArtifact(self, artifactRef: str, *, offset: int | None = None, maxBytes: int | None = None,
                     timeout: float | None = None) -> ControlResult:
        input: dict[str, Any] = {"artifactRef": artifactRef}
        if offset is not None:
            input["offset"] = offset
        if maxBytes is not None:
            input["maxBytes"] = maxBytes
        return self.request("artifact.read", input, timeout=timeout)

    def deleteArtifact(self, artifactRef: str, *, timeout: float | None = None) -> ControlResult:
        return self.request("artifact.delete", {"artifactRef": artifactRef}, timeout=timeout)

    def close(self, timeout: float = 5.0) -> None:
        with self._stateLock:
            if self._closed:
                return
            self._closed = True
        try:
            self.writable.close()
        except BaseException:
            pass
        process = self.process
        if process is not None and process.poll() is None:
            try:
                process.wait(timeout=timeout)
            except subprocess.TimeoutExpired:
                process.terminate()
                try:
                    process.wait(timeout=timeout)
                except subprocess.TimeoutExpired:
                    process.kill()
                    process.wait(timeout=timeout)

    def __enter__(self) -> "PyProcClient":
        return self

    def __exit__(self, exceptionType: type[BaseException] | None, exception: BaseException | None,
                 traceback: Any) -> None:
        self.close()
