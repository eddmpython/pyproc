// recordingSpace.js - 실제 provider terminal을 재생 가능한 순서와 보수적 실패 의미론으로 기록한다.
import { createHash } from "node:crypto";
import { canonicalControlError } from "../controlProtocol/controlError.js";
import {
  appendAutomationRecordingEntry,
  AUTOMATION_RECORDING_MAX_ARTIFACT_BYTES,
  AUTOMATION_RECORDING_MAX_TOTAL_ARTIFACT_BYTES,
  AutomationRecordingWriter,
  createAutomationRecording,
  putAutomationRecordingArtifact,
} from "./automationRecording.js";

function recordingWriteError(error, outcome = "outcomeUnknown") {
  const failure = new Error("automation terminal could not be committed to its recording", { cause: error });
  failure.code = "AUTOMATION_RECORDING_WRITE_FAILED";
  failure.outcome = outcome;
  failure.retryable = false;
  failure.details = Object.freeze({ causeCode: String(error?.code || "PYPROC_INTERNAL") });
  return failure;
}

function recordingUnavailable(error) {
  const failure = new Error("automation recording is unavailable after a prior write failure", { cause: error });
  failure.code = "AUTOMATION_RECORDING_UNAVAILABLE";
  failure.outcome = "notSent";
  failure.retryable = false;
  return failure;
}

function screenshotDescriptor(value) {
  return value && typeof value === "object" && !Array.isArray(value)
    && value.kind === "screenshot" && /^artifact:[A-Za-z0-9_-]+$/.test(String(value.artifactRef || ""))
    && String(value.mimeType || "").startsWith("image/") && !Object.hasOwn(value, "offset");
}

function artifactChunk(value) {
  return value && typeof value === "object" && !Array.isArray(value)
    && /^artifact:[A-Za-z0-9_-]+$/.test(String(value.artifactRef || ""))
    && Number.isInteger(value.offset) && Number.isInteger(value.nextOffset)
    && typeof value.dataBase64 === "string";
}

function recordingCopy(payload, recording) {
  const inlineArtifacts = [];
  const artifactRefs = [];
  const visit = (value) => {
    if (Array.isArray(value)) return value.map(visit);
    if (!value || typeof value !== "object") return value;
    const output = {};
    const screenshot = screenshotDescriptor(value);
    const chunk = artifactChunk(value);
    if (screenshot || chunk) artifactRefs.push(value.artifactRef);
    for (const [key, child] of Object.entries(value)) {
      if (screenshot && key === "dataBase64" && typeof child === "string") {
        const bytes = Buffer.from(child, "base64");
        putAutomationRecordingArtifact(recording, value.artifactRef, {
          kind: "screenshot",
          mimeType: value.mimeType,
          byteLength: value.byteLength,
          sha256: value.sha256,
          dataBase64: child,
        });
        inlineArtifacts.push(value.artifactRef);
        continue;
      }
      if (chunk && key === "dataBase64") continue;
      output[key] = visit(child);
    }
    return output;
  };
  return Object.freeze({ output: visit(payload), inlineArtifacts: Object.freeze([...new Set(inlineArtifacts)]),
    artifactRefs: Object.freeze([...new Set(artifactRefs)]) });
}

function providerDescriptor(provider) {
  const config = provider.config || provider.control?.config || {};
  return Object.freeze({
    spaceId: provider.spaceId,
    providerKind: provider.providerKind,
    operations: Object.freeze([...provider.operations]),
    capabilities: Object.freeze([...(provider.capabilities || [])]),
    restoreBoundary: "externalEffectsRemain",
    policy: Object.freeze({
      targetOrigins: Object.freeze([...(config.targetOrigins || [])]),
      actions: Object.freeze([...(config.actions || [])]),
      rawMethods: Object.freeze([...(config.rawMethods || [])]),
      maxRisk: String(config.maxRisk || ""),
    }),
  });
}

export class RecordingSpace {
  static async open({ provider, file, overwrite = false, writerFactory = AutomationRecordingWriter.open } = {}) {
    const space = new RecordingSpace({ provider, file });
    try {
      space.writer = await writerFactory(file, space.recording, { overwrite });
      space._ready = true;
      return space;
    } catch (error) {
      space._fatalError = error;
      throw error;
    }
  }

  constructor({ provider, file } = {}) {
    if (!provider || typeof provider !== "object") throw new TypeError("RecordingSpace provider is required");
    if (!file || typeof file !== "string") throw new TypeError("RecordingSpace file is required");
    this.provider = provider;
    this.file = file;
    this.spaceId = provider.spaceId;
    this.providerKind = provider.providerKind;
    this.operations = Object.freeze([...provider.operations]);
    this.capabilities = Object.freeze([...(provider.capabilities || [])]);
    this.replayBoundary = "deterministicRecording";
    this.linearizeInvocations = true;
    this.recording = createAutomationRecording({ provider: providerDescriptor(provider) });
    this.writer = null;
    this._chunks = new Map();
    this._pendingArtifactBytes = 0;
    this._closed = false;
    this._ready = false;
    this._fatalError = null;
  }

  authorize(operation, input, context) {
    this._assertWritable();
    return this.provider.authorize(operation, input, context);
  }

  async execute(operation, input, context) {
    this._assertWritable();
    if (operation === "automation.space.inspect") {
      const output = await this.provider.execute(operation, input, context);
      return Object.freeze({ ...output, recording: this._status() });
    }
    let output;
    try { output = await this.provider.execute(operation, input, context); }
    catch (providerError) {
      const terminalError = canonicalControlError(providerError);
      try {
        this._append(operation, input, { ok: false, error: terminalError }, [], []);
        await this._persist();
      } catch (recordingError) {
        this._fatalError = recordingError;
        throw recordingWriteError(recordingError, terminalError.outcome);
      }
      throw providerError;
    }
    try {
      if (operation === "artifact.read") this._collectArtifactChunk(output);
      const copied = recordingCopy(output, this.recording);
      this._append(operation, input, { ok: true, output: copied.output }, copied.inlineArtifacts, copied.artifactRefs);
      await this._persist();
    } catch (error) {
      this._fatalError = error;
      throw recordingWriteError(error, "outcomeUnknown");
    }
    return output;
  }

  async close() {
    if (this._closed) return;
    this._closed = true;
    let firstError = null;
    if (this._ready && !this._fatalError) {
      try { await this.writer.write(this.recording); } catch (error) { firstError = error; }
    }
    try { await this.provider.close(); } catch (error) { firstError ||= error; }
    try { await this.writer?.close(); } catch (error) { firstError ||= error; }
    if (firstError) throw firstError;
  }

  _append(operation, input, terminal, inlineArtifacts, artifactRefs) {
    appendAutomationRecordingEntry(this.recording, {
      operation,
      input: structuredClone(input),
      terminal,
      inlineArtifacts,
      artifactRefs,
    });
  }

  _collectArtifactChunk(output) {
    if (!artifactChunk(output) || typeof output.sha256 !== "string" || typeof output.mimeType !== "string"
      || !Number.isInteger(output.byteLength) || output.byteLength < 1
      || output.byteLength > AUTOMATION_RECORDING_MAX_ARTIFACT_BYTES
      || output.nextOffset > output.byteLength || typeof output.eof !== "boolean") {
      throw new TypeError("recorded artifact chunk is invalid");
    }
    const bytes = Buffer.from(output.dataBase64, "base64");
    if (bytes.toString("base64") !== output.dataBase64 || output.nextOffset !== output.offset + bytes.byteLength) {
      throw new TypeError("recorded artifact chunk encoding is invalid");
    }
    let record = this._chunks.get(output.artifactRef);
    if (!record || output.offset === 0) {
      if (record) this._pendingArtifactBytes -= record.nextOffset;
      record = { chunks: [], nextOffset: 0, byteLength: output.byteLength,
        sha256: output.sha256, mimeType: output.mimeType };
    }
    if (output.offset !== record.nextOffset) throw new TypeError("recorded artifact chunks are not contiguous");
    if (record.byteLength !== output.byteLength || record.sha256 !== output.sha256
      || record.mimeType !== output.mimeType) throw new TypeError("recorded artifact chunk identity changed");
    if (this._pendingArtifactBytes + bytes.byteLength > AUTOMATION_RECORDING_MAX_TOTAL_ARTIFACT_BYTES) {
      throw new TypeError("pending recorded artifacts exceed the total byte limit");
    }
    record.chunks.push(bytes);
    record.nextOffset += bytes.byteLength;
    this._pendingArtifactBytes += bytes.byteLength;
    this._chunks.set(output.artifactRef, record);
    if (!output.eof) return;
    const combined = Buffer.concat(record.chunks);
    this._chunks.delete(output.artifactRef);
    this._pendingArtifactBytes -= record.nextOffset;
    if (combined.byteLength !== output.byteLength
      || createHash("sha256").update(combined).digest("hex") !== output.sha256) {
      throw new TypeError("recorded artifact chunks do not converge");
    }
    putAutomationRecordingArtifact(this.recording, output.artifactRef, {
      kind: "screenshot",
      mimeType: output.mimeType,
      byteLength: combined.byteLength,
      sha256: output.sha256,
      dataBase64: combined.toString("base64"),
    });
  }

  async _persist() {
    this._assertWritable();
    await this.writer.write(this.recording);
  }

  _assertWritable() {
    if (this._closed) throw recordingUnavailable(new Error("recording space is closed"));
    if (!this._ready || !this.writer || this._fatalError) throw recordingUnavailable(this._fatalError);
  }

  _status() {
    return Object.freeze({ mode: "record", recordingId: this.recording.recordingId,
      entries: this.recording.entries.length, artifacts: Object.keys(this.recording.artifacts).length,
      complete: this.recording.complete, finalSha256: this.recording.finalSha256 });
  }
}
