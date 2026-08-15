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
from concurrent.futures import Future, TimeoutError as FutureTimeoutError
from pathlib import Path
from typing import Any, BinaryIO, Callable, Sequence, TextIO

from .models import Attachment, ControlError, ControlResult
from .perception import PerceptionClient
from .protocol import (
    CONTROL_ATTACHMENT_CHUNK_BYTES,
    CONTROL_MAX_ATTACHMENT_BYTES,
    ControlProtocolError,
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
        if timeout is None:
            return self.future.result()
        try:
            return self.future.result(timeout)
        except FutureTimeoutError:
            if self.future.done():
                try:
                    return self.future.result()
                except ControlError:
                    raise
                except BaseException as error:
                    self._raiseDeadlineFailure("control connection ended at the request deadline", error)
            try:
                self.client.cancel(self.requestId, "Python client request deadline reached")
            except BaseException as error:
                self._raiseDeadlineFailure("control request cancellation could not be sent", error)
            try:
                return self.future.result(self.client.cancelSettleTimeout)
            except FutureTimeoutError as error:
                self._raiseDeadlineFailure("control request did not settle after cancellation", error)
            except ControlError:
                raise
            except BaseException as error:
                self._raiseDeadlineFailure("control connection ended while cancellation was settling", error)

    def _raiseDeadlineFailure(self, message: str, cause: BaseException) -> None:
        try:
            self.client.close()
        except BaseException:
            pass
        raise ControlError({
            "code": "CONTROL_TIMEOUT",
            "message": message,
            "retryable": False,
            "outcome": "outcomeUnknown",
        }) from cause

    def cancel(self, reason: str = "Python client cancelled the request") -> bool:
        return self.client.cancel(self.requestId, reason)

    def done(self) -> bool:
        return self.future.done()


class PyProcClient:
    def __init__(self, readable: TextIO, writable: TextIO, *, process: subprocess.Popen[str] | None = None,
                 stderr: TextIO | None = None, startupTimeout: float = 30.0,
                 cancelSettleTimeout: float = 5.0,
                 eventHandler: Callable[[dict[str, Any]], None] | None = None) -> None:
        if cancelSettleTimeout <= 0:
            raise ValueError("cancelSettleTimeout must be positive")
        self.readable = readable
        self.writable = writable
        self.process = process
        self.eventHandler = eventHandler
        self.cancelSettleTimeout = cancelSettleTimeout
        self._stderr = stderr
        self._serverEvents = False
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
        self._connectionError: ControlError | None = None
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
            "capabilities": {"cancel": True, "events": False,
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
              cancelSettleTimeout: float = 5.0,
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
                       startupTimeout=startupTimeout, cancelSettleTimeout=cancelSettleTimeout,
                       eventHandler=eventHandler)
        except BaseException:
            if process.poll() is None:
                process.terminate()
                try:
                    process.wait(timeout=5.0)
                except subprocess.TimeoutExpired:
                    process.kill()
                    process.wait(timeout=5.0)
            raise

    @classmethod
    def check(cls, configPath: str | os.PathLike[str], *,
              command: str | os.PathLike[str] | Sequence[str | os.PathLike[str]] | None = None,
              timeout: float = 30.0) -> dict[str, Any]:
        return cls._entranceReport(configPath, command=command, timeout=timeout, mode="check")

    @classmethod
    def doctor(cls, configPath: str | os.PathLike[str], *,
               command: str | os.PathLike[str] | Sequence[str | os.PathLike[str]] | None = None,
               timeout: float = 30.0) -> dict[str, Any]:
        return cls._entranceReport(configPath, command=command, timeout=timeout, mode="doctor")

    @classmethod
    def _entranceReport(cls, configPath: str | os.PathLike[str], *,
                        command: str | os.PathLike[str] | Sequence[str | os.PathLike[str]] | None,
                        timeout: float, mode: str) -> dict[str, Any]:
        config = str(Path(configPath).resolve())
        entrance = ["doctor", "--config", config] if mode == "doctor" else ["--config", config, "--check"]
        completed = subprocess.run([*resolvedCommand(command), *entrance], text=True, encoding="utf-8",
                                   errors="strict", capture_output=True, timeout=timeout, check=False)
        try:
            report = json.loads(completed.stdout)
        except json.JSONDecodeError as error:
            completed.check_returncode()
            raise RuntimeError(f"pyproc-control {mode} did not return JSON") from error
        if mode == "doctor" and isinstance(report, dict) and isinstance(report.get("ok"), bool):
            if report["ok"] != (completed.returncode == 0):
                raise RuntimeError("pyproc-control doctor exit and report disagree")
            return report
        completed.check_returncode()
        if not isinstance(report, dict) or report.get("ok") is not True:
            raise RuntimeError(f"pyproc-control {mode} did not return an ok report")
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
                self._serverEvents = frame["capabilities"]["events"] is True
                self._helloEvent.set()
                return
            frameType = frame["type"]
            if frameType == "event":
                if not self._serverEvents:
                    raise RuntimeError("control server emitted an event without advertising event support")
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
            connectionError = self._connectionFailure("control connection ended before the request terminal")
            self._connectionError = connectionError
            for pending in self._pending.values():
                future: Future[ControlResult] = pending["future"]
                if not future.done():
                    future.set_exception(connectionError)
            self._pending.clear()

    @staticmethod
    def _connectionFailure(message: str, *, outcome: str = "outcomeUnknown") -> ControlError:
        return ControlError({
            "code": "CONTROL_CONNECTION_LOST",
            "message": message,
            "retryable": False,
            "outcome": outcome,
        })

    def requestAsync(self, operation: str, input: dict[str, Any] | None = None, *,
                     requestId: str | None = None, spaceId: str | None = None) -> ControlRequest:
        with self._stateLock:
            if self._closed:
                raise RuntimeError("pyproc control client is closed")
            if self._connectionError is not None:
                raise self._connectionFailure("control connection is unavailable", outcome="notSent")
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
        except ControlProtocolError:
            with self._stateLock:
                self._pending.pop(currentId, None)
            raise
        except BaseException as error:
            connectionError = self._connectionFailure("control request frame could not be sent")
            self._failAll(error)
            raise connectionError from error
        return ControlRequest(self, currentId, future)

    def request(self, operation: str, input: dict[str, Any] | None = None, *,
                requestId: str | None = None, spaceId: str | None = None,
                timeout: float | None = None) -> ControlResult:
        return self.requestAsync(operation, input, requestId=requestId, spaceId=spaceId).result(timeout)

    def cancel(self, requestId: str, reason: str = "Python client cancelled the request") -> bool:
        with self._stateLock:
            if requestId not in self._pending:
                return False
        try:
            self._sendFrame({**controlBase("cancel"), "requestId": requestId, "reason": reason})
        except ControlProtocolError:
            raise
        except BaseException as error:
            connectionError = self._connectionFailure("control cancel frame could not be sent")
            self._failAll(error)
            raise connectionError from error
        return True

    def runPython(self, code: str, *, timeout: float | None = None) -> ControlResult:
        return self.request("machine.run", {"code": code}, timeout=timeout)

    def exportMachineImage(self, *, timeout: float | None = None) -> ControlResult:
        return self.request("machine.image.export", timeout=timeout)

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

    def closeTarget(self, targetRef: str, *, expectedRisk: str = "externalEffect",
                    timeout: float | None = None) -> ControlResult:
        return self.request("automation.target.close", {"targetRef": targetRef,
                                                         "expectedRisk": expectedRisk}, timeout=timeout)

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

    def auditExperience(self, contractRoot: str | os.PathLike[str], *,
                        repositoryRoot: str | os.PathLike[str], outputDir: str,
                        environmentId: str, repository: dict[str, Any],
                        motorJourneys: list[dict[str, Any]] | None = None,
                        timeout: float | None = None) -> ControlResult:
        input: dict[str, Any] = {
            "contractRoot": str(Path(contractRoot).resolve()),
            "repositoryRoot": str(Path(repositoryRoot).resolve()),
            "outputDir": outputDir,
            "environmentId": environmentId,
            "repository": repository,
        }
        if motorJourneys is not None:
            input["motorJourneys"] = motorJourneys
        return self.request("verification.audit", input, timeout=timeout)

    def verifyExperience(self, referenceDir: str | os.PathLike[str],
                         currentDir: str | os.PathLike[str], *,
                         timeout: float | None = None) -> ControlResult:
        return self.request("verification.verify", {
            "referenceDir": str(Path(referenceDir).resolve()),
            "currentDir": str(Path(currentDir).resolve()),
        }, timeout=timeout)

    def replayEvidencePack(self, packDir: str | os.PathLike[str], *,
                           timeout: float | None = None) -> ControlResult:
        return self.request("verification.replay", {
            "packDir": str(Path(packDir).resolve()),
        }, timeout=timeout)

    def createExecutionSession(self, executionSessionId: str, project: dict[str, Any], *,
                               machineId: str | None = None,
                               browser: dict[str, Any] | None = None,
                               timeout: float | None = None) -> ControlResult:
        input: dict[str, Any] = {"executionSessionId": executionSessionId, "project": project}
        if machineId is not None:
            input["machineId"] = machineId
        if browser is not None:
            input["browser"] = browser
        return self.request("memory.create", input, timeout=timeout)

    def checkpointExecutionSession(self, executionSessionId: str, expectedRevisionSha256: str,
                                   work: dict[str, Any], *, browser: dict[str, Any] | None = None,
                                   timeout: float | None = None) -> ControlResult:
        input: dict[str, Any] = {"executionSessionId": executionSessionId,
                                 "expectedRevisionSha256": expectedRevisionSha256, "work": work}
        if browser is not None:
            input["browser"] = browser
        return self.request("memory.checkpoint", input, timeout=timeout)

    def completeExecutionSession(self, executionSessionId: str, expectedRevisionSha256: str,
                                 evidencePackDir: str | os.PathLike[str], *,
                                 timeout: float | None = None) -> ControlResult:
        return self.request("memory.complete", {
            "executionSessionId": executionSessionId,
            "expectedRevisionSha256": expectedRevisionSha256,
            "evidencePackDir": str(Path(evidencePackDir).resolve()),
        }, timeout=timeout)

    def openExecutionSession(self, executionSessionId: str, *,
                             timeout: float | None = None) -> ControlResult:
        return self.request("memory.open", {"executionSessionId": executionSessionId}, timeout=timeout)

    def listExecutionSessions(self, *, timeout: float | None = None) -> ControlResult:
        return self.request("memory.list", timeout=timeout)

    def inspectExecutionSession(self, executionSessionId: str, *,
                                timeout: float | None = None) -> ControlResult:
        return self.request("memory.inspect", {"executionSessionId": executionSessionId}, timeout=timeout)

    def exportExecutionHandoff(self, executionSessionId: str, outputPath: str, *,
                               timeout: float | None = None) -> ControlResult:
        return self.request("memory.export", {
            "executionSessionId": executionSessionId, "outputPath": outputPath,
        }, timeout=timeout)

    def importExecutionHandoff(self, handoffDir: str | os.PathLike[str], *,
                               trustedPublicKeyFile: str | os.PathLike[str],
                               approvedPermissionManifestSha256: str,
                               timeout: float | None = None) -> ControlResult:
        return self.request("memory.import", {
            "handoffDir": str(Path(handoffDir).resolve()),
            "trustedPublicKeyFile": str(Path(trustedPublicKeyFile).resolve()),
            "approvedPermissionManifestSha256": approvedPermissionManifestSha256,
        }, timeout=timeout)

    def prepareEffectTransaction(self, input: dict[str, Any], *,
                                 timeout: float | None = None) -> ControlResult:
        return self.request("effect.prepare", input, timeout=timeout)

    def rehearseEffectTransaction(self, transactionId: str, expectedRevisionSha256: str,
                                   rehearsal: dict[str, Any], *,
                                   timeout: float | None = None) -> ControlResult:
        return self.request("effect.rehearse", {
            "transactionId": transactionId,
            "expectedRevisionSha256": expectedRevisionSha256,
            **rehearsal,
        }, timeout=timeout)

    def approveEffectTransaction(self, transactionId: str, expectedRevisionSha256: str,
                                  grant: dict[str, Any], *,
                                  timeout: float | None = None) -> ControlResult:
        return self.request("effect.approve", {
            "transactionId": transactionId,
            "expectedRevisionSha256": expectedRevisionSha256,
            "grant": grant,
        }, timeout=timeout)

    def commitEffectTransaction(self, transactionId: str, expectedRevisionSha256: str, *,
                                 timeout: float | None = None) -> ControlResult:
        return self.request("effect.commit", {
            "transactionId": transactionId,
            "expectedRevisionSha256": expectedRevisionSha256,
        }, timeout=timeout)

    def inspectEffectTransaction(self, transactionId: str, *,
                                 timeout: float | None = None) -> ControlResult:
        return self.request("effect.inspect", {"transactionId": transactionId}, timeout=timeout)

    def listEffectTransactions(self, *, timeout: float | None = None) -> ControlResult:
        return self.request("effect.list", timeout=timeout)

    def sealEffectTransaction(self, transactionId: str, expectedRevisionSha256: str,
                              evidencePackDir: str | os.PathLike[str], *,
                              timeout: float | None = None) -> ControlResult:
        return self.request("effect.seal", {
            "transactionId": transactionId,
            "expectedRevisionSha256": expectedRevisionSha256,
            "evidencePackDir": str(Path(evidencePackDir).resolve()),
        }, timeout=timeout)

    def attachApp(self, sessionRef: dict[str, Any], *,
                  timeout: float | None = None) -> ControlResult:
        return self.request("app.attach", {"sessionRef": sessionRef}, timeout=timeout)

    def checkpointApp(self, input: dict[str, Any], *,
                      timeout: float | None = None) -> ControlResult:
        return self.request("app.checkpoint", input, timeout=timeout)

    def branchApp(self, input: dict[str, Any], *,
                  timeout: float | None = None) -> ControlResult:
        return self.request("app.branch", input, timeout=timeout)

    def restoreApp(self, appRef: str, pairId: str, *,
                   timeout: float | None = None) -> ControlResult:
        return self.request("app.restore", {"appRef": appRef, "pairId": pairId}, timeout=timeout)

    def adoptApp(self, appRef: str, pairId: str,
                 expectedActivePairSha256: str | None, *,
                 timeout: float | None = None) -> ControlResult:
        return self.request("app.adopt", {
            "appRef": appRef,
            "pairId": pairId,
            "expectedActivePairSha256": expectedActivePairSha256,
        }, timeout=timeout)

    def inspectApp(self, appRef: str, *,
                   timeout: float | None = None) -> ControlResult:
        return self.request("app.inspect", {"appRef": appRef}, timeout=timeout)

    def listAppPairs(self, *, timeout: float | None = None) -> ControlResult:
        return self.request("app.list", timeout=timeout)

    def stageAppEffect(self, appRef: str, transactionId: str,
                       expectedTransactionRevisionSha256: str, *,
                       timeout: float | None = None) -> ControlResult:
        return self.request("app.effect.stage", {
            "appRef": appRef,
            "transactionId": transactionId,
            "expectedTransactionRevisionSha256": expectedTransactionRevisionSha256,
        }, timeout=timeout)

    def finalizeAppEffect(self, appRef: str, transactionId: str,
                          expectedTransactionRevisionSha256: str, *,
                          timeout: float | None = None) -> ControlResult:
        return self.request("app.effect.finalize", {
            "appRef": appRef,
            "transactionId": transactionId,
            "expectedTransactionRevisionSha256": expectedTransactionRevisionSha256,
        }, timeout=timeout)

    def importReplayGraphRecording(self, graphId: str, recordingFile: str | os.PathLike[str], *,
                                   timeout: float | None = None) -> ControlResult:
        return self.request("world.import.recording", {
            "graphId": graphId,
            "recordingFile": str(Path(recordingFile).resolve()),
        }, timeout=timeout)

    def createReplayGraphAppWorld(self, graphId: str, pairId: str, *,
                                  timeout: float | None = None) -> ControlResult:
        return self.request("world.create.app", {"graphId": graphId, "pairId": pairId}, timeout=timeout)

    def captureReplayGraphAppBranch(self, input: dict[str, Any], *,
                                    timeout: float | None = None) -> ControlResult:
        return self.request("world.capture.app.branch", input, timeout=timeout)

    def openReplayWorld(self, graphId: str, rootSha256: str, *, startNodeRef: str | None = None,
                        timeout: float | None = None) -> ControlResult:
        input: dict[str, Any] = {"graphId": graphId, "rootSha256": rootSha256}
        if startNodeRef is not None:
            input["startNodeRef"] = startNodeRef
        return self.request("world.open", input, timeout=timeout)

    def inspectReplayWorld(self, worldRef: str, *, timeout: float | None = None) -> ControlResult:
        return self.request("world.inspect", {"worldRef": worldRef}, timeout=timeout)

    def listReplayWorldEdges(self, worldRef: str, *, timeout: float | None = None) -> ControlResult:
        return self.request("world.edges", {"worldRef": worldRef}, timeout=timeout)

    def traverseReplayWorld(self, worldRef: str, capabilityRef: str, expectedNodeRef: str, *,
                            timeout: float | None = None) -> ControlResult:
        return self.request("world.traverse", {"worldRef": worldRef, "capabilityRef": capabilityRef,
                                                "expectedNodeRef": expectedNodeRef}, timeout=timeout)

    def checkpointReplayWorld(self, worldRef: str, *, timeout: float | None = None) -> ControlResult:
        return self.request("world.checkpoint", {"worldRef": worldRef}, timeout=timeout)

    def restoreReplayWorld(self, worldRef: str, checkpoint: dict[str, Any], *,
                           timeout: float | None = None) -> ControlResult:
        return self.request("world.restore", {"worldRef": worldRef, "checkpoint": checkpoint}, timeout=timeout)

    def evaluateReplayWorld(self, graphId: str, rootSha256: str, contract: dict[str, Any],
                            edgeRefs: list[str], *, timeout: float | None = None) -> ControlResult:
        return self.request("world.evaluate", {"graphId": graphId, "rootSha256": rootSha256,
                                                "contract": contract, "edgeRefs": edgeRefs}, timeout=timeout)

    def inspectReplayWorldCoverage(self, worldRef: str, *, timeout: float | None = None) -> ControlResult:
        return self.request("world.coverage", {"worldRef": worldRef}, timeout=timeout)

    def listReplayGraphs(self, *, timeout: float | None = None) -> ControlResult:
        return self.request("world.list", timeout=timeout)

    def executeMotor(self, input: dict[str, Any], *,
                     timeout: float | None = None) -> ControlResult:
        return self.request("motor.execute", input, timeout=timeout)

    def acquireMotorControl(self, input: dict[str, Any], *,
                            timeout: float | None = None) -> ControlResult:
        return self.request("motor.control.acquire", input, timeout=timeout)

    def revokeMotorControl(self, leaseRef: str, *,
                           timeout: float | None = None) -> ControlResult:
        return self.request("motor.control.revoke", {"leaseRef": leaseRef}, timeout=timeout)

    def inspectMotor(self, *, timeout: float | None = None) -> ControlResult:
        return self.request("motor.inspect", timeout=timeout)

    def listMotorRecords(self, *, timeout: float | None = None) -> ControlResult:
        return self.request("motor.list", timeout=timeout)

    def replayMotor(self, receiptSha256: str, worldRef: str, expectedNodeRef: str, *,
                    timeout: float | None = None) -> ControlResult:
        return self.request("motor.replay", {"receiptSha256": receiptSha256, "worldRef": worldRef,
                                               "expectedNodeRef": expectedNodeRef}, timeout=timeout)

    def evaluateMotorPolicy(self, input: dict[str, Any], *,
                            timeout: float | None = None) -> ControlResult:
        return self.request("motor.policy.evaluate", input, timeout=timeout)

    def promoteMotorPolicy(self, input: dict[str, Any], *,
                           timeout: float | None = None) -> ControlResult:
        return self.request("motor.policy.promote", input, timeout=timeout)

    def rollbackMotorPolicy(self, expectedPolicySha256: str, *,
                            timeout: float | None = None) -> ControlResult:
        return self.request("motor.policy.rollback", {"expectedPolicySha256": expectedPolicySha256},
                            timeout=timeout)

    def perception(self, sessionRef: dict[str, Any] | None = None) -> PerceptionClient:
        return PerceptionClient(self, sessionRef)

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
        for stream in (self.readable, self._stderr):
            try:
                stream.close() if stream is not None else None
            except BaseException:
                pass
        current = threading.current_thread()
        if self._readerThread is not current:
            self._readerThread.join(timeout)
        if self._stderrThread is not None and self._stderrThread is not current:
            self._stderrThread.join(timeout)

    def __enter__(self) -> "PyProcClient":
        return self

    def __exit__(self, exceptionType: type[BaseException] | None, exception: BaseException | None,
                 traceback: Any) -> None:
        self.close()
