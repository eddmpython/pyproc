import { createHash } from "node:crypto";

const FORMAT = "pyproc.automationRecording";

function canonical(value) {
  if (value === null || typeof value === "boolean" || typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number" && Number.isFinite(value)) return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object" && Object.getPrototypeOf(value) === Object.prototype) {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
  }
  throw new TypeError("recording value must be JSON");
}

const digest = (value) => createHash("sha256").update(canonical(value)).digest("hex");

export function sealRecording({ recordingId, provider, entries, artifacts = {} }) {
  let previousSha256 = "0".repeat(64);
  const sealedEntries = entries.map((entry, index) => {
    const body = { sequence: index, previousSha256, operation: entry.operation,
      input: entry.input, terminal: entry.terminal, inlineArtifacts: entry.inlineArtifacts || [] };
    const sha256 = digest(body);
    previousSha256 = sha256;
    return Object.freeze({ ...body, sha256 });
  });
  const artifactManifest = Object.fromEntries(Object.entries(artifacts).map(([ref, artifact]) => [ref, {
    ...artifact, sha256: createHash("sha256").update(Buffer.from(artifact.dataBase64, "base64")).digest("hex"),
  }]));
  return Object.freeze({ format: FORMAT, version: 1, recordingId, provider,
    entries: Object.freeze(sealedEntries), artifacts: Object.freeze(artifactManifest), finalSha256: previousSha256 });
}

export function verifyRecording(recording) {
  if (recording?.format !== FORMAT || recording?.version !== 1) throw new Error("recording format is invalid");
  let previousSha256 = "0".repeat(64);
  for (let index = 0; index < recording.entries.length; index += 1) {
    const entry = recording.entries[index];
    const body = { sequence: index, previousSha256, operation: entry.operation,
      input: entry.input, terminal: entry.terminal, inlineArtifacts: entry.inlineArtifacts || [] };
    if (entry.sequence !== index || entry.previousSha256 !== previousSha256 || entry.sha256 !== digest(body)) {
      throw new Error(`recording entry ${index} digest mismatch`);
    }
    for (const ref of entry.inlineArtifacts || []) if (!recording.artifacts[ref]) throw new Error(`artifact missing: ${ref}`);
    previousSha256 = entry.sha256;
  }
  if (recording.finalSha256 !== previousSha256) throw new Error("recording final digest mismatch");
  for (const [ref, artifact] of Object.entries(recording.artifacts)) {
    const bytes = Buffer.from(artifact.dataBase64, "base64");
    if (bytes.toString("base64") !== artifact.dataBase64 || bytes.byteLength !== artifact.byteLength
      || createHash("sha256").update(bytes).digest("hex") !== artifact.sha256) throw new Error(`artifact invalid: ${ref}`);
  }
  return recording;
}

export class ReplaySpaceDraft {
  constructor(recording, { cursor = 0, prefixSha256 = cursor ? recording.entries[cursor - 1]?.sha256 : "0".repeat(64) } = {}) {
    this.recording = verifyRecording(recording);
    if (!Number.isInteger(cursor) || cursor < 0 || cursor > recording.entries.length
      || prefixSha256 !== (cursor ? recording.entries[cursor - 1].sha256 : "0".repeat(64))) {
      throw new Error("replay cursor is invalid");
    }
    this.cursor = cursor;
  }

  checkpoint() {
    return Object.freeze({ recordingId: this.recording.recordingId, cursor: this.cursor,
      prefixSha256: this.cursor ? this.recording.entries[this.cursor - 1].sha256 : "0".repeat(64) });
  }

  invoke(operation, input) {
    const entry = this.recording.entries[this.cursor];
    if (!entry || entry.operation !== operation || digest(entry.input) !== digest(input)) {
      const error = new Error("replay command does not match the next recorded entry");
      error.code = "REPLAY_DIVERGED";
      throw error;
    }
    this.cursor += 1;
    if (!entry.terminal.ok) throw Object.assign(new Error(entry.terminal.error.message), entry.terminal.error);
    const output = structuredClone(entry.terminal.output);
    const inject = (value) => {
      if (Array.isArray(value)) return value.forEach(inject);
      if (!value || typeof value !== "object") return;
      if (entry.inlineArtifacts.includes(value.artifactRef)) value.dataBase64 = this.recording.artifacts[value.artifactRef].dataBase64;
      Object.values(value).forEach(inject);
    };
    inject(output);
    return output;
  }
}
