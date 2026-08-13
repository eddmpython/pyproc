// delegatedTabAuthority.js - two-gesture host and active-tab lease state without browser implementation details.
import { createHash, randomBytes } from "node:crypto";
import { actuationDigest } from "../actuationCanonical.js";

const CAPABILITY = /^[A-Za-z0-9_-]{32,256}$/;
const OPERATIONS = new Set(["observe", "act"]);

function delegatedError(code, message) {
  const error = new Error(message);
  error.code = code;
  error.outcome = "notSent";
  error.retryable = false;
  return error;
}

function exactOrigin(value) {
  let url;
  try { url = new URL(value); } catch (error) { return null; }
  return ["http:", "https:"].includes(url.protocol) && !url.username && !url.password ? url.origin : null;
}

function capabilitySha256(value) { return createHash("sha256").update(value).digest("hex"); }

export class DelegatedTabAuthority {
  constructor({ now = () => Date.now(), idFactory = () => randomBytes(24).toString("base64url") } = {}) {
    if (typeof now !== "function" || typeof idFactory !== "function") {
      throw new TypeError("DelegatedTab authority requires clock and identity providers");
    }
    this.now = now;
    this.idFactory = idFactory;
    this.pendingHosts = new Map();
    this.host = null;
    this.lease = null;
    this.epoch = 0;
  }

  requestHost({ tabId, url, bootstrapCapability } = {}) {
    const origin = exactOrigin(url);
    if (!Number.isInteger(tabId) || !origin?.startsWith("http://127.0.0.1:")
      || !CAPABILITY.test(bootstrapCapability || "")) {
      throw delegatedError("DELEGATED_HOST_INVALID", "delegated host request is invalid");
    }
    const requestRef = `delegationRequest:${this.idFactory()}`;
    this.pendingHosts.set(tabId, Object.freeze({ requestRef, tabId, origin,
      capabilitySha256: capabilitySha256(bootstrapCapability), requestedAt: this.now() }));
    return Object.freeze({ requestRef, state: "awaitingHostGesture", hostOrigin: origin });
  }

  grantGesture({ tabId, url } = {}) {
    const origin = exactOrigin(url);
    const pending = this.pendingHosts.get(tabId);
    if (!this.host && pending?.origin === origin) {
      this.host = Object.freeze({ ...pending, boundAt: this.now() });
      this.pendingHosts.clear();
      return Object.freeze({ state: "hostBound", hostOrigin: origin });
    }
    if (!this.host || !Number.isInteger(tabId) || tabId === this.host.tabId || !origin
      || origin.startsWith("http://127.0.0.1:")) {
      throw delegatedError("DELEGATED_GESTURE_INVALID", "delegated target gesture is invalid");
    }
    this.epoch += 1;
    const leaseRef = `delegatedTabLease:${this.idFactory()}`;
    this.lease = Object.freeze({ leaseRef, tabId, origin, tabEpoch: this.epoch, grantedAt: this.now(),
      authoritySha256: actuationDigest({ hostOrigin: this.host.origin, targetOrigin: origin,
        tabEpoch: this.epoch, requestRef: this.host.requestRef }) });
    return Object.freeze({ state: "targetGranted", leaseRef, origin, tabEpoch: this.epoch,
      authoritySha256: this.lease.authoritySha256 });
  }

  authorize({ bootstrapCapability, leaseRef, tabId, url, tabEpoch, operation } = {}) {
    const origin = exactOrigin(url);
    if (!this.host || !this.lease || !OPERATIONS.has(operation)
      || capabilitySha256(String(bootstrapCapability || "")) !== this.host.capabilitySha256
      || leaseRef !== this.lease.leaseRef || tabId !== this.lease.tabId || origin !== this.lease.origin
      || tabEpoch !== this.lease.tabEpoch) {
      throw delegatedError("DELEGATED_AUTHORITY_REVOKED", "delegated tab authority is absent, stale, or out of scope");
    }
    return Object.freeze({ leaseRef, operation, origin, tabEpoch,
      authoritySha256: this.lease.authoritySha256 });
  }

  navigation({ tabId, url } = {}) {
    const origin = exactOrigin(url);
    if (this.lease?.tabId === tabId) {
      if (this.lease.origin !== origin) this.lease = null;
      else {
        this.epoch += 1;
        this.lease = Object.freeze({ ...this.lease, tabEpoch: this.epoch,
          authoritySha256: actuationDigest({ hostOrigin: this.host.origin, targetOrigin: origin,
            tabEpoch: this.epoch, requestRef: this.host.requestRef }) });
      }
    }
    if (this.host?.tabId === tabId && this.host.origin !== origin) { this.host = null; this.lease = null; }
  }

  closeTab(tabId) {
    if (this.lease?.tabId === tabId) this.lease = null;
    if (this.host?.tabId === tabId) { this.host = null; this.lease = null; }
    this.pendingHosts.delete(tabId);
  }

  inspect() {
    return Object.freeze({ hostBound: !!this.host, targetGranted: !!this.lease,
      hostOrigin: this.host?.origin || null,
      target: this.lease ? Object.freeze({ leaseRef: this.lease.leaseRef, origin: this.lease.origin,
        tabEpoch: this.lease.tabEpoch, authoritySha256: this.lease.authoritySha256 }) : null });
  }

  close() { this.pendingHosts.clear(); this.host = null; this.lease = null; }
}
