// windowsControlLease.js - one-shot physical input authority bound to one installed application and intent.
import { randomBytes } from "node:crypto";
import { ACTUATION_ERROR_CODES, actuationError, assertActuationIntent,
  createActuationIntent } from "./actuationCanonical.js";

const REF = /^application:[A-Za-z0-9._:-]{1,192}$/;

function intentScope(intent) {
  const input = structuredClone(intent);
  delete input.protocol;
  delete input.version;
  delete input.intentSha256;
  input.authority.controlLeaseRef = null;
  return createActuationIntent(input);
}

function canonicalIntent(intent) {
  return intent?.protocol === "pyproc.actuationIntent" ? assertActuationIntent(intent)
    : createActuationIntent(intent);
}

export class WindowsControlLeaseRegistry {
  constructor({ nativeHost, now = () => Date.now() } = {}) {
    if (!nativeHost || typeof nativeHost.inspect !== "function") {
      throw new TypeError("WindowsControlLeaseRegistry requires a native host");
    }
    this.nativeHost = nativeHost;
    this.now = now;
    this.records = new Map();
  }

  async acquire({ applicationId, intent, expiresInMs = 5000 } = {}) {
    const scopeIntent = canonicalIntent(intent);
    if (!REF.test(applicationId || "") || scopeIntent.authority.controlLeaseRef !== null
      || !scopeIntent.policy.allowedActuatorKinds.includes("osInput")
      || !Number.isInteger(expiresInMs) || expiresInMs < 100 || expiresInMs > 30000) {
      throw actuationError(ACTUATION_ERROR_CODES.authorityRequired, "Windows ControlLease scope is invalid");
    }
    if (!this.nativeHost.native.applications.some((entry) => entry.applicationId === applicationId)) {
      throw actuationError(ACTUATION_ERROR_CODES.authorityRequired,
        "Windows ControlLease application is outside the native allowlist");
    }
    const inspection = await this.nativeHost.inspect();
    if (!inspection.physicalUserInputObserver) {
      throw actuationError(ACTUATION_ERROR_CODES.actuatorUnavailable,
        "Windows physical input observer is unavailable");
    }
    const leaseRef = `controlLease:${randomBytes(24).toString("hex")}`;
    const surfaceEpoch = scopeIntent.target.surfaceEpoch.replace(/^document:/, "surface:");
    const record = Object.freeze({ leaseRef, applicationId, intentScopeSha256: scopeIntent.intentSha256, surfaceEpoch,
      expiresAt: this.now() + expiresInMs, userInputEpoch: inspection.inputEpoch, cancelOnUserInput: true });
    this.records.set(leaseRef, record);
    return Object.freeze({ leaseRef, applicationId, intentScopeSha256: scopeIntent.intentSha256, surfaceEpoch,
      expiresAt: record.expiresAt, cancelOnUserInput: true, state: "active" });
  }

  consume(leaseRef, { applicationId, intent, surfaceEpoch } = {}) {
    const record = this.assert(leaseRef, { applicationId, intent, surfaceEpoch });
    this.records.delete(leaseRef);
    return record;
  }

  assert(leaseRef, { applicationId, intent, surfaceEpoch } = {}) {
    const record = this.records.get(leaseRef);
    const scoped = intentScope(intent);
    if (!record || record.expiresAt <= this.now() || record.applicationId !== applicationId
      || record.intentScopeSha256 !== scoped.intentSha256 || record.surfaceEpoch !== surfaceEpoch) {
      throw actuationError(ACTUATION_ERROR_CODES.controlRevoked,
        "Windows ControlLease is unavailable, expired, or outside the exact plan scope");
    }
    return record;
  }

  revoke(leaseRef) {
    const revoked = this.records.delete(leaseRef);
    return Object.freeze({ leaseRef, revoked, state: "revoked" });
  }

  close() { this.records.clear(); }
}
