// Secret bindings live only in one control host. Consumed values stay solely in its bounded output redactor until
// close, because a page may echo a credential later. Nothing here is a persistent credential store.
export function secretInputError(message) {
  const error = new Error(message);
  error.code = "BROWSER_SECRET_INPUT_DENIED";
  error.outcome = "notSent";
  error.retryable = false;
  return error;
}

// Provider-issued references and finite protocol classifications are not page text. A short password must not
// corrupt a session handle or a result's kind. Page labels, values, URLs and error text are scrubbed.
const PROTOCOL_FIELDS = new Set(["secretRef", "locatorRef", "targetRef", "sessionId", "brokerId", "runId", "traceId",
  "actionId", "eventId", "artifactRef", "kind", "state", "risk", "outcome", "code", "method", "role", "type",
  "expectedRisk", "inputMode", "expiresAt", "protocolVersion"]);

export class BrowserSecretInput {
  constructor({ now, idFactory }) {
    this.now = now;
    this.idFactory = idFactory;
    this.pending = new Map();
    this.values = new Set();
  }

  remember(value) {
    if (typeof value !== "string" || !value || !value.isWellFormed() || value.length > 100000) {
      throw secretInputError("secret input exceeds the supported fill size");
    }
    if (!this.values.has(value) && this.values.size >= 64) {
      throw secretInputError("the secret input limit was reached; start a new control host");
    }
    this.values.add(value);
  }

  bind({ value, sessionKey, locatorRef, origin, field }) {
    if (typeof value !== "string" || !value || value.length > 4096) {
      throw secretInputError("a secret binding must contain 1 to 4096 characters");
    }
    for (const [ref, binding] of this.pending) if (binding.expiresAt <= this.now()) this.pending.delete(ref);
    if (this.pending.size >= 32) throw secretInputError("too many unused secret bindings");
    this.remember(value);
    const secretRef = `secret:${this.idFactory()}`;
    const expiresAt = this.now() + 30000;
    this.pending.set(secretRef, { value, sessionKey, locatorRef, origin, field, expiresAt });
    return Object.freeze({ secretRef, expiresAt: new Date(expiresAt).toISOString() });
  }

  consume(secretRef, sessionKey, locatorRef) {
    const binding = this.pending.get(secretRef);
    this.pending.delete(secretRef);
    if (!binding || binding.expiresAt <= this.now() || binding.sessionKey !== sessionKey
      || binding.locatorRef !== locatorRef) throw secretInputError("secret binding is expired, consumed, or for another field");
    return binding;
  }

  get sensitive() { return this.values.size > 0; }

  clean(value, field = "") {
    if (!this.sensitive) return value;
    if (PROTOCOL_FIELDS.has(field)) return value;
    if (typeof value === "string") {
      let cleaned = value;
      for (const secret of this.values) {
        for (const variant of new Set([secret, encodeURIComponent(secret)])) cleaned = cleaned.split(variant).join("[redacted]");
      }
      return cleaned;
    }
    if (Array.isArray(value)) return value.map((item) => this.clean(item));
    if (value && typeof value === "object") {
      return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, this.clean(item, key)]));
    }
    return value;
  }

  cleanError(error) {
    if (!this.sensitive || !error || typeof error !== "object") return error;
    error.message = this.clean(error.message);
    if (error.stack) error.stack = this.clean(error.stack);
    delete error.cause;
    for (const key of Object.keys(error)) error[key] = this.clean(error[key], key);
    return error;
  }

  dropSession(sessionKey) {
    for (const [ref, binding] of this.pending) if (binding.sessionKey === sessionKey) this.pending.delete(ref);
  }

  close() { this.pending.clear(); this.values.clear(); }
}
