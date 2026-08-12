// automationSpace.js - provider를 바꿔도 operation 의미론을 고정하는 내부 제품 계약.
export const AUTOMATION_SPACE_OPERATIONS = Object.freeze([
  "automation.space.inspect",
  "automation.target.list",
  "automation.target.open",
  "automation.session.attach",
  "automation.command",
  "automation.session.detach",
  "automation.observe",
  "automation.act",
  "artifact.read",
  "artifact.delete",
]);

const OPERATION_SET = new Set(AUTOMATION_SPACE_OPERATIONS);
const ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const PROVIDER_RE = /^[a-z][A-Za-z0-9]{0,63}$/;

function spaceError(code, message, outcome = "notSent") {
  const error = new Error(message);
  error.code = code;
  error.outcome = outcome;
  error.retryable = false;
  return error;
}

export function assertAutomationSpace(provider) {
  if (!provider || typeof provider !== "object") throw new TypeError("automation space provider is required");
  if (typeof provider.spaceId !== "string" || !ID_RE.test(provider.spaceId)) {
    throw new TypeError("automation spaceId is invalid");
  }
  if (typeof provider.providerKind !== "string" || !PROVIDER_RE.test(provider.providerKind)) {
    throw new TypeError("automation providerKind is invalid");
  }
  for (const method of ["authorize", "execute", "close"]) {
    if (typeof provider[method] !== "function") throw new TypeError(`automation space requires ${method}()`);
  }
  if (!Array.isArray(provider.operations) || provider.operations.length < 1) {
    throw new TypeError("automation space operations are required");
  }
  const operations = new Set();
  for (const operation of provider.operations) {
    if (!OPERATION_SET.has(operation) || operations.has(operation)) {
      throw new TypeError(`automation space operation is invalid: ${operation}`);
    }
    operations.add(operation);
  }
  return provider;
}

export class AutomationSpaceRouter {
  constructor(provider) {
    this.provider = assertAutomationSpace(provider);
    this.spaceId = provider.spaceId;
    this.providerKind = provider.providerKind;
    this.operations = Object.freeze([...provider.operations]);
    this._operations = new Set(this.operations);
    this._closed = false;
  }

  async invoke(operation, input = {}, { signal, requestId = null } = {}) {
    if (this._closed) throw spaceError("AUTOMATION_SPACE_CLOSED", "automation space is closed");
    if (!this._operations.has(operation)) {
      throw spaceError("AUTOMATION_SPACE_OPERATION_UNSUPPORTED", `automation space operation is unsupported: ${operation}`);
    }
    if (!input || typeof input !== "object" || Array.isArray(input)) {
      throw new TypeError("automation space input must be an object");
    }
    if (signal?.aborted) throw spaceError("CONTROL_CANCELLED", String(signal.reason || "control request cancelled"));
    const authority = await this.provider.authorize(operation, input, { signal, requestId });
    if (signal?.aborted) throw spaceError("CONTROL_CANCELLED", String(signal.reason || "control request cancelled"));
    const output = await this.provider.execute(operation, input, { signal, requestId, authority });
    if (operation !== "automation.space.inspect") return output;
    return Object.freeze({
      space: Object.freeze({
        spaceId: this.spaceId,
        providerKind: this.providerKind,
        operations: this.operations,
        restoreBoundary: "externalEffectsRemain",
        replayBoundary: String(this.provider.replayBoundary || "unsupported"),
      }),
      ...output,
    });
  }

  async close() {
    if (this._closed) return;
    this._closed = true;
    await this.provider.close();
  }
}
