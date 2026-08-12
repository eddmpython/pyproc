"""Installed Python codec positive and negative contract fixtures."""

import threading
from concurrent.futures import Future

from pyprocControl import ControlError, ControlProtocolError, controlBase, decodeFrame, encodeFrame, validateFrame
from pyprocControl.client import ControlRequest, PyProcClient


def errorCode(operation):
    try:
        operation()
    except ControlProtocolError as error:
        return error.code
    return None


request = {**controlBase("request"), "requestId": "python:contract",
           "operation": "machine.run", "input": {"code": "1 + 1"}}
assert decodeFrame(encodeFrame(request))["input"]["code"] == "1 + 1"
assert errorCode(lambda: validateFrame({**request, "version": 2})) == "CONTROL_VERSION_UNSUPPORTED"
assert errorCode(lambda: validateFrame({**request, "extra": True})) == "CONTROL_INVALID_FRAME"
assert errorCode(lambda: validateFrame({**request, "requestId": 1})) == "CONTROL_INVALID_FRAME"
assert errorCode(lambda: validateFrame({**request, "operation": "Machine.Run"})) == "CONTROL_INVALID_FRAME"
assert errorCode(lambda: validateFrame({**request, "input": []})) == "CONTROL_INVALID_FRAME"
assert errorCode(lambda: decodeFrame('{"protocol":"pyproc-control","version":1,"type":"request","requestId":"x","operation":"machine.run","input":{"value":NaN}}')) == "CONTROL_INVALID_FRAME"

fatal = {**controlBase("error"), "fatal": True,
         "error": {"code": "CONTROL_CONNECTION_FAILED", "message": "closed",
                   "retryable": False, "outcome": "notSent"}}
assert decodeFrame(encodeFrame(fatal))["fatal"] is True
assert errorCode(lambda: validateFrame({**fatal, "requestId": "bad:fatal"})) == "CONTROL_INVALID_FRAME"
assert errorCode(lambda: validateFrame({**controlBase("error"), "requestId": "bad:retry",
                                        "error": {"code": "CONTROL_FAILED", "message": "unknown",
                                                  "retryable": True, "outcome": "outcomeUnknown"}})) == "CONTROL_INVALID_FRAME"

attachment = {**controlBase("attachment"), "requestId": "python:contract", "attachmentId": "attachment:1",
              "mimeType": "image/png", "offset": 0, "dataBase64": "", "eof": False,
              "byteLength": 0, "sha256": "0" * 64}
assert errorCode(lambda: validateFrame(attachment)) == "CONTROL_ATTACHMENT_INVALID"


class BrokenCancelClient:
    cancelSettleTimeout = 0.01

    def __init__(self):
        self.closed = False

    def cancel(self, requestId, reason):
        raise BrokenPipeError("cancel pipe closed")

    def close(self):
        self.closed = True
        raise RuntimeError("close raced with transport exit")


brokenClient = BrokenCancelClient()
brokenRequest = ControlRequest(brokenClient, "python:broken-cancel", Future())
deadlineError = None
try:
    brokenRequest.result(0)
except ControlError as error:
    deadlineError = error
assert brokenClient.closed is True
assert deadlineError is not None and deadlineError.code == "CONTROL_TIMEOUT"
assert deadlineError.outcome == "outcomeUnknown" and deadlineError.retryable is False


class EofCancelClient:
    cancelSettleTimeout = 0.01

    def __init__(self, future):
        self.future = future
        self.closed = False

    def cancel(self, requestId, reason):
        self.future.set_exception(EOFError("control transport closed"))
        return False

    def close(self):
        self.closed = True


eofFuture = Future()
eofClient = EofCancelClient(eofFuture)
eofRequest = ControlRequest(eofClient, "python:eof-at-deadline", eofFuture)
eofError = None
try:
    eofRequest.result(0)
except ControlError as error:
    eofError = error
assert eofClient.closed is True
assert eofError is not None and eofError.code == "CONTROL_TIMEOUT"
assert eofError.outcome == "outcomeUnknown" and eofError.retryable is False


failedFuture = Future()
failedClient = object.__new__(PyProcClient)
failedClient._stateLock = threading.RLock()
failedClient._helloEvent = threading.Event()
failedClient._helloEvent.set()
failedClient._connectionError = None
failedClient._pending = {"python:reader-eof": {"future": failedFuture, "attachments": {}}}
failedClient._failAll(EOFError("control transport closed"))
connectionError = None
try:
    failedFuture.result(1)
except ControlError as error:
    connectionError = error
assert connectionError is not None and connectionError.code == "CONTROL_CONNECTION_LOST"
assert connectionError.outcome == "outcomeUnknown" and connectionError.retryable is False


class BrokenWritable:
    def write(self, text):
        raise BrokenPipeError("request pipe closed")

    def flush(self):
        raise AssertionError("flush must not run after failed write")


writeClient = object.__new__(PyProcClient)
writeClient._stateLock = threading.RLock()
writeClient._writeLock = threading.Lock()
writeClient._helloEvent = threading.Event()
writeClient._helloEvent.set()
writeClient._connectionError = None
writeClient._closed = False
writeClient._sequence = 0
writeClient._used = set()
writeClient._pending = {}
writeClient.writable = BrokenWritable()
writeError = None
try:
    writeClient.requestAsync("machine.run", {"code": "writeEffect = True"})
except ControlError as error:
    writeError = error
assert writeError is not None and writeError.code == "CONTROL_CONNECTION_LOST"
assert writeError.outcome == "outcomeUnknown" and writeError.retryable is False
assert writeClient._pending == {}

print("python sdk protocol contract green: 15 fixtures")
