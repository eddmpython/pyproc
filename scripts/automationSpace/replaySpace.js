// replaySpace.js - 검증된 기록을 외부 provider 호출 0회로 결정적으로 재생한다.
import {
  automationRecordingDigest,
  automationRecordingZeroDigest,
  readAutomationRecordingArtifact,
  verifyAutomationRecording,
} from "./automationRecording.js";

function replayError(code, message, outcome = "notSent", details = null) {
  const error = new Error(message);
  error.code = code;
  error.outcome = outcome;
  error.retryable = false;
  if (details) error.details = details;
  return error;
}

function expectedPrefix(recording, cursor) {
  return cursor === 0 ? automationRecordingZeroDigest() : recording.entries[cursor - 1]?.sha256;
}

async function rehydrateRecordedArtifacts(operation, output, inlineArtifacts, recording) {
  const inline = new Set(inlineArtifacts);
  const visit = async (value) => {
    if (Array.isArray(value)) return Promise.all(value.map(visit));
    if (!value || typeof value !== "object") return value;
    const copy = {};
    for (const [key, child] of Object.entries(value)) copy[key] = await visit(child);
    if (inline.has(copy.artifactRef)) {
      copy.dataBase64 = (await readAutomationRecordingArtifact(recording, copy.artifactRef)).toString("base64");
    } else if (operation === "artifact.read" && Number.isInteger(copy.offset)
      && Number.isInteger(copy.nextOffset) && copy.nextOffset >= copy.offset) {
      copy.dataBase64 = (await readAutomationRecordingArtifact(recording, copy.artifactRef,
        { offset: copy.offset, length: copy.nextOffset - copy.offset })).toString("base64");
    }
    return copy;
  };
  return visit(output);
}

export class ReplaySpace {
  constructor({ recording, cursor = 0, prefixSha256 = null, spaceId = null } = {}) {
    this.recording = verifyAutomationRecording(recording);
    this.spaceId = spaceId || `space:replay:${recording.recordingId.replace(/[^A-Za-z0-9._:-]/g, "_")}`;
    this.providerKind = "replay";
    this.operations = Object.freeze([...recording.provider.operations]);
    this.capabilities = Object.freeze([...(recording.provider.capabilities || [])]);
    this.replayBoundary = "deterministic";
    this.linearizeInvocations = true;
    this._authorities = new WeakSet();
    this._closed = false;
    this._setCursor(cursor, prefixSha256);
  }

  authorize(operation, input) {
    if (this._closed) throw replayError("AUTOMATION_SPACE_CLOSED", "ReplaySpace is closed");
    if (operation === "automation.space.inspect") {
      const authority = Object.freeze({ operation, sequence: null });
      this._authorities.add(authority);
      return authority;
    }
    const entry = this.recording.entries[this.cursor];
    if (!entry) throw replayError("AUTOMATION_REPLAY_EXHAUSTED", "automation recording has no next entry");
    if (entry.operation !== operation || automationRecordingDigest(entry.input) !== automationRecordingDigest(input)) {
      throw replayError("AUTOMATION_REPLAY_DIVERGED", "operation or input does not match the next recorded entry", "notSent", {
        cursor: this.cursor,
        expectedOperation: entry.operation,
        receivedOperation: operation,
        expectedInputSha256: automationRecordingDigest(entry.input),
        receivedInputSha256: automationRecordingDigest(input),
      });
    }
    const authority = Object.freeze({ operation, sequence: entry.sequence, entrySha256: entry.sha256 });
    this._authorities.add(authority);
    return authority;
  }

  async execute(operation, input, { authority } = {}) {
    if (!authority || !this._authorities.has(authority) || authority.operation !== operation) {
      throw replayError("AUTOMATION_REPLAY_AUTHORITY_INVALID", "ReplaySpace requires a current authorization token");
    }
    this._authorities.delete(authority);
    if (operation === "automation.space.inspect") return this.inspect();
    const entry = this.recording.entries[this.cursor];
    if (!entry || authority.sequence !== this.cursor || authority.entrySha256 !== entry.sha256) {
      throw replayError("AUTOMATION_REPLAY_CURSOR_STALE", "ReplaySpace cursor changed after authorization");
    }
    if (entry.terminal.ok === true) {
      const output = await rehydrateRecordedArtifacts(operation, entry.terminal.output,
        entry.inlineArtifacts, this.recording);
      this.cursor += 1;
      return output;
    }
    this.cursor += 1;
    const recorded = entry.terminal.error;
    const error = replayError(recorded.code, recorded.message, recorded.outcome, recorded.details || null);
    error.retryable = recorded.retryable === true && !["applied", "outcomeUnknown"].includes(recorded.outcome);
    throw error;
  }

  inspect() {
    return Object.freeze({
      transport: "recording",
      sourceProviderKind: this.recording.provider.providerKind,
      recording: Object.freeze({ mode: "replay", recordingId: this.recording.recordingId,
        cursor: this.cursor, entryCount: this.recording.entries.length,
        remaining: this.recording.entries.length - this.cursor,
        prefixSha256: expectedPrefix(this.recording, this.cursor),
        finalSha256: this.recording.finalSha256 }),
    });
  }

  checkpoint() {
    return Object.freeze({ recordingId: this.recording.recordingId, cursor: this.cursor,
      prefixSha256: expectedPrefix(this.recording, this.cursor) });
  }

  restore(checkpoint) {
    if (!checkpoint || checkpoint.recordingId !== this.recording.recordingId) {
      throw replayError("AUTOMATION_REPLAY_CHECKPOINT_INVALID", "replay checkpoint belongs to another recording");
    }
    this._setCursor(checkpoint.cursor, checkpoint.prefixSha256);
    return this.checkpoint();
  }

  async close() {
    this._closed = true;
  }

  _setCursor(cursor, prefixSha256) {
    const expected = expectedPrefix(this.recording, cursor);
    if (!Number.isInteger(cursor) || cursor < 0 || cursor > this.recording.entries.length || !expected
      || (cursor > 0 && !prefixSha256) || (prefixSha256 !== null && prefixSha256 !== undefined && prefixSha256 !== expected)) {
      throw replayError("AUTOMATION_REPLAY_CURSOR_INVALID", "replay cursor or prefix digest is invalid");
    }
    this.cursor = cursor;
  }
}
