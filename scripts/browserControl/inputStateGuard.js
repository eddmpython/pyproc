// inputStateGuard.js - input down 가능성과 bounded safety release만 소유한다.
export const BROWSER_INPUT_RELEASE_DEFAULT_BUDGET_MS = 500;

function inputRef(kind, name) {
  return `${kind}:${name}`;
}

function errorCode(error) {
  return String(error?.code || "PYPROC_INTERNAL");
}

function freezeEvidence(value) {
  return Object.freeze({
    required: value.required,
    attempted: value.attempted,
    state: value.state,
    releasedInputs: Object.freeze([...value.releasedInputs]),
    residualInputs: Object.freeze([...value.residualInputs]),
    startedAt: value.startedAt,
    endedAt: value.endedAt,
    errorCodes: Object.freeze([...value.errorCodes]),
  });
}

export class InputStateGuard {
  constructor({ releasePointer, releaseKey, releaseDragIntercept,
    releaseBudgetMs = BROWSER_INPUT_RELEASE_DEFAULT_BUDGET_MS, now = () => Date.now() } = {}) {
    if (![releasePointer, releaseKey, releaseDragIntercept, now].every((entry) => typeof entry === "function")) {
      throw new TypeError("input state guard adapters are required");
    }
    if (!Number.isInteger(releaseBudgetMs) || releaseBudgetMs < 1 || releaseBudgetMs > 5000) {
      throw new TypeError("input state guard release budget is invalid");
    }
    this.releasePointer = releasePointer;
    this.releaseKey = releaseKey;
    this.releaseDragIntercept = releaseDragIntercept;
    this.releaseBudgetMs = releaseBudgetMs;
    this.now = now;
    this.pointerButtons = new Map();
    this.keys = new Map();
    this.keyOrder = [];
    this.dragIntercept = "off";
    this.lastPointerPoint = null;
    this.releaseAttempts = [];
  }

  pointerPossiblyDown(button, point) {
    this.pointerButtons.set(button, "possiblyDown");
    this.lastPointerPoint = point ? Object.freeze({ x: point.x, y: point.y }) : this.lastPointerPoint;
  }

  pointerDown(button) {
    if (this.pointerButtons.get(button) !== "up") this.pointerButtons.set(button, "down");
  }

  pointerUp(button) {
    this.pointerButtons.set(button, "up");
  }

  keyPossiblyDown(key) {
    const code = String(key?.code || key?.key || "unknown");
    if (!this.keys.has(code)) this.keyOrder.push(code);
    this.keys.set(code, { state: "possiblyDown", key: Object.freeze({ ...key, code }) });
  }

  keyDown(code) {
    const entry = this.keys.get(code);
    if (entry) this.keys.set(code, { ...entry, state: "down" });
  }

  keyUp(code) {
    const entry = this.keys.get(code);
    if (entry) this.keys.set(code, { ...entry, state: "up" });
  }

  dragInterceptPossiblyOn() {
    this.dragIntercept = "possiblyOn";
  }

  dragInterceptOn() {
    this.dragIntercept = "on";
  }

  dragInterceptOff() {
    this.dragIntercept = "off";
  }

  residualInputs() {
    const output = [];
    for (const [button, state] of this.pointerButtons) {
      if (state !== "up") output.push(inputRef("pointer", button));
    }
    for (const [code, entry] of this.keys) {
      if (entry.state !== "up") output.push(inputRef("key", code));
    }
    if (this.dragIntercept !== "off") output.push("dragIntercept");
    return output;
  }

  evidence() {
    const residualInputs = this.residualInputs();
    return freezeEvidence({
      required: false,
      attempted: false,
      state: "notRequired",
      releasedInputs: [],
      residualInputs,
      startedAt: null,
      endedAt: null,
      errorCodes: [],
    });
  }

  async safetyRelease() {
    const residualBefore = this.residualInputs();
    if (!residualBefore.length) return this.evidence();
    const startedAt = new Date(this.now()).toISOString();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.releaseBudgetMs);
    const releasedInputs = [];
    const errorCodes = [];
    const attempt = async (input, operation, onReleased) => {
      const record = { input, startedAt: new Date(this.now()).toISOString(), state: "attempted" };
      this.releaseAttempts.push(record);
      try {
        await operation(controller.signal);
        onReleased();
        record.state = "released";
        releasedInputs.push(input);
      } catch (error) {
        record.state = "failed";
        record.code = errorCode(error);
        errorCodes.push(record.code);
      }
      record.endedAt = new Date(this.now()).toISOString();
    };
    try {
      for (const code of [...this.keyOrder].reverse()) {
        const entry = this.keys.get(code);
        if (!entry || entry.state === "up") continue;
        await attempt(inputRef("key", code),
          (releaseSignal) => this.releaseKey(entry.key, releaseSignal), () => this.keyUp(code));
      }
      for (const [button, state] of this.pointerButtons) {
        if (state === "up") continue;
        await attempt(inputRef("pointer", button),
          (releaseSignal) => this.releasePointer({ button, point: this.lastPointerPoint }, releaseSignal),
          () => this.pointerUp(button));
      }
      if (this.dragIntercept !== "off") {
        await attempt("dragIntercept", (releaseSignal) => this.releaseDragIntercept(releaseSignal),
          () => this.dragInterceptOff());
      }
    } finally {
      clearTimeout(timer);
    }
    const residualInputs = this.residualInputs();
    const state = residualInputs.length === 0 ? "released"
      : releasedInputs.length > 0 ? "partiallyReleased" : "unknown";
    return freezeEvidence({
      required: true,
      attempted: true,
      state,
      releasedInputs,
      residualInputs,
      startedAt,
      endedAt: new Date(this.now()).toISOString(),
      errorCodes: [...new Set(errorCodes)],
    });
  }
}
