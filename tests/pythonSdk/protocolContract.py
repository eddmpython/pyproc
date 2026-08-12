"""Installed Python codec positive and negative contract fixtures."""

from pyprocControl import ControlProtocolError, controlBase, decodeFrame, encodeFrame, validateFrame


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
print("python sdk protocol contract green: 11 fixtures")
