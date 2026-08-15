"""Installed Python codec positive and negative contract fixtures."""

import threading
from concurrent.futures import Future

from pyprocControl import ActionConvergenceReceipt, ControlError, ControlProtocolError, ControlResult, PerceptionClient, PerceptionQueryResult, controlBase, decodeFrame, encodeFrame, validateFrame
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
assert ControlResult({"value": "42"}, "applied").terminal == "completed"
convergence = ActionConvergenceReceipt.fromMapping({
    "protocol": "pyproc.actionConvergence", "version": 1, "state": "converged", "reason": "staleTarget",
    "attempts": 2, "maxAttempts": 2, "reobservations": 1, "maxReobservations": 1,
    "effectAttempts": 1, "effectRetries": 0, "effectOutcome": "applied",
    "maxPreEffectDurationMs": 30000, "preEffectDurationMs": 100, "durationMs": 125,
    "actionabilityPolls": 4,
    "actionabilityReasonsSeen": ["notAttached"],
})
assert convergence.maxAttempts == 2 and convergence.effectRetries == 0
assert ControlError({"code": "CONTROL_CANCELLED", "message": "cancelled",
                     "retryable": False, "outcome": "notSent"}).terminal == "cancelled"
assert ControlError({"code": "CONTROL_FAILED", "message": "partial",
                     "retryable": False, "outcome": "rejected",
                     "details": {"completed": [{"index": 0}]}}).terminal == "partial"
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


class ToggleWritable:
    def __init__(self):
        self.failed = False

    def write(self, text):
        if self.failed:
            raise BrokenPipeError("cancel pipe closed")
        return len(text)

    def flush(self):
        if self.failed:
            raise BrokenPipeError("cancel flush closed")


cancelClient = object.__new__(PyProcClient)
cancelClient._stateLock = threading.RLock()
cancelClient._writeLock = threading.Lock()
cancelClient._helloEvent = threading.Event()
cancelClient._helloEvent.set()
cancelClient._connectionError = None
cancelClient._closed = False
cancelClient._sequence = 0
cancelClient._used = set()
cancelClient._pending = {}
cancelClient.writable = ToggleWritable()
pendingRequest = cancelClient.requestAsync("machine.run", {"code": "cancelEffect = True"})
cancelClient.writable.failed = True
cancelWriteError = None
try:
    cancelClient.cancel(pendingRequest.requestId)
except ControlError as error:
    cancelWriteError = error
pendingError = None
try:
    pendingRequest.future.result(1)
except ControlError as error:
    pendingError = error
assert cancelWriteError is not None and cancelWriteError.code == "CONTROL_CONNECTION_LOST"
assert cancelWriteError.outcome == "outcomeUnknown" and cancelWriteError.retryable is False
assert pendingError is not None and pendingError.code == "CONTROL_CONNECTION_LOST"
assert pendingError.outcome == "outcomeUnknown" and pendingError.retryable is False


class PerceptionFixtureClient:
    def __init__(self):
        self.calls = []

    def observe(self, sessionRef, options, timeout=None):
        self.calls.append(("observe", sessionRef, options, timeout))
        if options.get("representation") == "apx.situation":
            return ControlResult({"protocol": "apx", "representation": "apx.situation",
                                  "situationRef": "situation:" + "a" * 64,
                                  "worldRef": "world:" + "b" * 64,
                                  "facts": [], "unknowns": [],
                                  "requirements": [{"requirementRef": "requirement:save", "state": "satisfied",
                                                    "claimRefs": []}],
                                  "affordances": [{"kind": "authorized", "action": "click",
                                                   "requirementRef": "requirement:save",
                                                   "locatorRef": "locator:save", "risk": "externalEffect",
                                                   "capabilityRef": "capability:" + "c" * 64,
                                                   "situationRef": "situation:" + "a" * 64,
                                                   "worldRef": "world:" + "b" * 64,
                                                   "expectedTransition": {}}]}, "observed")
        return ControlResult({"protocol": "apx", "entities": [{"entityRef": "entity:save",
                              "kind": "ui.control", "semantic": {"role": "button", "name": "Save"},
                              "interaction": {"actionable": True}, "locatorRef": "locator:save"}]}, "observed")

    def act(self, sessionRef, actions, timeout=None):
        self.calls.append(("act", sessionRef, actions, timeout))
        return ControlResult({"actions": [{"result": {"evidence": {"verification": {"state": "confirmed"}}}}]},
                             "applied")


perceptionFixture = PerceptionFixtureClient()
eyes = PerceptionClient(perceptionFixture, {"sessionId": "session:eyes"})
saveEntity = eyes.query(role="button", name="Save", actionable=True).one()
assert saveEntity.entityRef == "entity:save" and saveEntity.locatorRef == "locator:save"
evidenced = eyes.act("click", saveEntity.locatorRef, verify={"entityAppeared": {"role": "status"}})
assert evidenced.output["actions"][0]["result"]["evidence"]["verification"]["state"] == "confirmed"
assert perceptionFixture.calls[0][2]["representation"] == "apx.graph"
assert perceptionFixture.calls[0][2]["expectedRisk"] == "read"
assert perceptionFixture.calls[1][2][0]["verify"]["entityAppeared"]["role"] == "status"
situation = eyes.situate({"requirements": [{"requirementRef": "requirement:save",
                                            "select": {"role": "button"},
                                            "need": ["fact", "affordance"]}]})
saveAffordance = situation.requirement("requirement:save").oneAffordance("click")
eyes.actAffordance(saveAffordance, intent="Save the document")
assert perceptionFixture.calls[2][2]["representation"] == "apx.situation"
assert perceptionFixture.calls[3][2][0]["actionContext"]["capabilityRef"].startswith("capability:")

truncatedAmbiguous = None
try:
    PerceptionQueryResult(ControlResult({
        "protocol": "apx",
        "entities": [{"entityRef": "entity:only-returned", "kind": "ui.control"}],
        "query": {"matched": 2, "total": 10},
    }, "observed")).one()
except LookupError as error:
    truncatedAmbiguous = error
assert truncatedAmbiguous is not None and "received 2" in str(truncatedAmbiguous)

unboundError = None
try:
    PerceptionClient(perceptionFixture).observe()
except ValueError as error:
    unboundError = error
assert unboundError is not None


class VerificationFixtureClient(PyProcClient):
    def __init__(self):
        self.calls = []

    def request(self, operation, input=None, **options):
        self.calls.append((operation, input, options))
        return ControlResult({"verdict": "verified", "contentSha256": "a" * 64}, "observed")


verificationFixture = VerificationFixtureClient()
repository = {"commit": "abc123", "treeSha256": "sha256:" + "1" * 64,
              "diffSha256": "sha256:" + "2" * 64, "untracked": False}
verificationFixture.auditExperience("qa/eyes", repositoryRoot=".", outputDir=".eyes/current",
                                    environmentId="desktop", repository=repository)
verificationFixture.verifyExperience(".eyes/reference", ".eyes/current")
verificationFixture.replayEvidencePack(".eyes/current")
assert [call[0] for call in verificationFixture.calls] == [
    "verification.audit", "verification.verify", "verification.replay"]
assert all(call[1][key].startswith(("/", "\\")) or ":\\" in call[1][key]
           for call in verificationFixture.calls
           for key in call[1] if key in {"contractRoot", "repositoryRoot", "referenceDir", "currentDir", "packDir"})

print("python sdk protocol contract green: 22 fixtures")
