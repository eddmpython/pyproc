import { createHash } from "node:crypto";

const FORBIDDEN_KEYS = /^(password|passwd|token|cookie|authorization|secret|dom|html|javascriptHeap)$/i;
const APP_ID = /^[a-z0-9]+(?:[.-][a-z0-9]+){1,15}$/;
const REVISION = /^apprev:[A-Za-z0-9._:-]{1,96}$/;
const DIGEST = /^[0-9a-f]{64}$/;

export function canonicalJson(value, depth = 0) {
  if (depth > 24) throw new Error("state exceeds the depth limit");
  if (value === null || typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "number" && Number.isFinite(value)) return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((entry) => canonicalJson(entry, depth + 1)).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.keys(value).sort().map((key) => {
    if (FORBIDDEN_KEYS.test(key)) throw new Error(`forbidden state field: ${key}`);
    return `${JSON.stringify(key)}:${canonicalJson(value[key], depth + 1)}`;
  }).join(",")}}`;
  throw new Error("state contains an unsupported value");
}

export function digest(value) {
  return createHash("sha256").update(canonicalJson(value)).digest("hex");
}

export function appIdentity(input) {
  const value = structuredClone(input);
  if (!APP_ID.test(String(value.appId || "")) || value.adapterVersion !== "1"
    || typeof value.stateSchema !== "string" || !value.stateSchema || value.stateSchema.length > 128) {
    throw new Error("app identity is invalid");
  }
  const url = new URL(value.origin);
  if (!['http:', 'https:'].includes(url.protocol) || url.origin !== value.origin) throw new Error("app origin is invalid");
  return Object.freeze(value);
}

export function stateEnvelope({ identity, revision, state, outbox = [] }) {
  const normalizedIdentity = appIdentity(identity);
  if (!REVISION.test(String(revision || ""))) throw new Error("app revision is invalid");
  if (!Array.isArray(outbox) || outbox.length > 64 || outbox.some((entry) => !DIGEST.test(entry.intentSha256))) {
    throw new Error("effect outbox is invalid");
  }
  const stateBytes = Buffer.from(canonicalJson(state));
  if (stateBytes.byteLength > 1024 * 1024) throw new Error("app state exceeds the byte limit");
  const content = { format: "pyproc.appStateEnvelope", version: 1, identity: normalizedIdentity,
    revision, state: structuredClone(state), outbox: structuredClone(outbox), stateSha256: digest(state) };
  return Object.freeze({ ...content, contentSha256: digest(content) });
}

export class PairedGenerationPrototype {
  constructor() {
    this.candidates = new Map();
    this.markers = new Map();
    this.head = null;
  }

  prepare({ pairId, parent = this.head, app, machine }) {
    if (this.candidates.has(pairId) || this.markers.has(pairId)) throw new Error("pair already exists");
    if (!DIGEST.test(String(machine?.imageSha256 || "")) || !/^sha256:[0-9a-f]{64}$/.test(String(machine?.generation || ""))) {
      throw new Error("machine link is invalid");
    }
    const candidate = Object.freeze({ pairId, parent, app: stateEnvelope(app), machine: structuredClone(machine) });
    this.candidates.set(pairId, candidate);
    return candidate;
  }

  publish(pairId, { expectedAppRevision }) {
    const candidate = this.candidates.get(pairId);
    if (!candidate || candidate.app.revision !== expectedAppRevision) throw new Error("stale or missing pair candidate");
    if (candidate.parent !== this.head) throw new Error("paired HEAD changed");
    const marker = Object.freeze({ format: "pyproc.pairedGenerationMarker", version: 1, pairId,
      parent: candidate.parent, appSha256: candidate.app.contentSha256,
      machineImageSha256: candidate.machine.imageSha256,
      contentSha256: digest({ pairId, parent: candidate.parent, appSha256: candidate.app.contentSha256,
        machineImageSha256: candidate.machine.imageSha256 }) });
    this.markers.set(pairId, marker);
    this.head = pairId;
    return marker;
  }

  recover() {
    if (this.head === null) return null;
    const marker = this.markers.get(this.head);
    const candidate = this.candidates.get(this.head);
    if (!marker || !candidate || marker.appSha256 !== candidate.app.contentSha256
      || marker.machineImageSha256 !== candidate.machine.imageSha256) throw new Error("paired marker is incomplete");
    return Object.freeze({ marker, candidate: structuredClone(candidate) });
  }

  branch(sourcePairId, pairId, appPatch) {
    const source = this.candidates.get(sourcePairId);
    if (!source || !this.markers.has(sourcePairId)) throw new Error("branch source is not committed");
    return this.prepare({ pairId, parent: this.head,
      app: { identity: source.app.identity, revision: appPatch.revision,
        state: appPatch.state, outbox: appPatch.outbox || source.app.outbox },
      machine: source.machine });
  }
}
