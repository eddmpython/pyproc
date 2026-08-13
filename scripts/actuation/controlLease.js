// controlLease.js - shared physical input ownership without effect or business authority.
import { randomBytes } from "node:crypto";
import { ACTUATION_ERROR_CODES, actuationError } from "./actuationCanonical.js";

const REF_RE = /^[a-z][A-Za-z0-9.]*:[A-Za-z0-9._:-]{1,192}$/;
const DIGEST_RE = /^[0-9a-f]{64}$/;
const clone = (value) => Object.freeze(structuredClone(value));

export class ControlLease {
  constructor(scope, { now = () => Date.now(), idFactory = () => randomBytes(16).toString("hex") } = {}) {
    const keys = ["spaceRef", "applicationRef", "processRef", "windowRef", "surfaceEpoch", "intentSha256",
      "devices", "foregroundRequired", "expiresAt", "cancelOnUserInput", "sessionRevisionSha256"];
    if (!scope || typeof scope !== "object" || Array.isArray(scope)
      || Object.keys(scope).some((key) => !keys.includes(key)) || keys.some((key) => !Object.hasOwn(scope, key))
      || [scope.spaceRef, scope.applicationRef, scope.processRef, scope.windowRef, scope.surfaceEpoch]
        .some((value) => !REF_RE.test(String(value || "")))
      || !DIGEST_RE.test(String(scope.intentSha256 || "")) || !DIGEST_RE.test(String(scope.sessionRevisionSha256 || ""))
      || !Array.isArray(scope.devices) || !scope.devices.length || !Number.isFinite(scope.expiresAt)
      || typeof scope.foregroundRequired !== "boolean" || scope.cancelOnUserInput !== true) {
      throw actuationError(ACTUATION_ERROR_CODES.authorityRequired, "ControlLease scope is invalid");
    }
    this.scope = clone(scope);
    this.now = now;
    this.leaseRef = `controlLease:${idFactory()}`;
    this.state = "requested";
    this.reason = null;
  }

  activate(live) {
    if (this.state !== "requested" || this.now() >= this.scope.expiresAt
      || (this.scope.foregroundRequired && live.windowRef !== this.scope.windowRef)
      || live.surfaceEpoch !== this.scope.surfaceEpoch) {
      throw actuationError(ACTUATION_ERROR_CODES.controlRevoked, "ControlLease preflight failed");
    }
    this.state = "active";
    return this.inspect();
  }

  assert(segmentScope) {
    if (this.now() >= this.scope.expiresAt) { this.state = "expired"; this.reason = "expired"; }
    if (this.state !== "active" || segmentScope.windowRef !== this.scope.windowRef
      || segmentScope.surfaceEpoch !== this.scope.surfaceEpoch) {
      throw actuationError(ACTUATION_ERROR_CODES.controlRevoked,
        "ControlLease is not active for this effect segment");
    }
    return this.inspect();
  }

  suspend(reason = "surfaceChanged") {
    if (this.state === "active") { this.state = "suspended"; this.reason = reason; }
    return this.inspect();
  }

  userInput() {
    if (this.scope.cancelOnUserInput && ["requested", "active", "suspended"].includes(this.state)) {
      this.state = "revoked";
      this.reason = "physicalUserInput";
    }
    return this.inspect();
  }

  inspect() { return clone({ leaseRef: this.leaseRef, state: this.state, reason: this.reason, scope: this.scope }); }
}
