// effectWindow.js - preContact, committedGesture, postContact 구역과 safety release 상태기계.
import { ACTUATION_ERROR_CODES, actuationError } from "./actuationCanonical.js";

const clone = (value) => Object.freeze(structuredClone(value));

export class ActuationEffectWindow {
  constructor() {
    this.phase = "preContact";
    this.boundary = null;
    this.providerCalls = 0;
    this.completedSegments = [];
    this.safetyRelease = null;
  }

  approach(segment) {
    if (this.phase !== "preContact") throw actuationError(ACTUATION_ERROR_CODES.gestureAborted,
      "approach is unavailable after the effect boundary", null, "outcomeUnknown");
    this.completedSegments.push(clone({ phase: "preContact", segment }));
    return this.inspect();
  }

  cross(boundary) {
    if (this.phase !== "preContact" || typeof boundary !== "string" || !boundary) {
      throw actuationError(ACTUATION_ERROR_CODES.gestureAborted,
        "effect boundary is invalid or already crossed", null, "outcomeUnknown");
    }
    this.phase = "committedGesture";
    this.boundary = boundary;
    return this.inspect();
  }

  sent(segment) {
    if (this.phase !== "committedGesture") throw actuationError(ACTUATION_ERROR_CODES.gestureAborted,
      "provider effect is outside the committed gesture", null,
      this.phase === "preContact" ? "notSent" : "outcomeUnknown");
    this.providerCalls += 1;
    this.completedSegments.push(clone({ phase: "committedGesture", segment }));
    return this.inspect();
  }

  release(segment) {
    if (this.phase !== "committedGesture" || this.safetyRelease) return false;
    this.safetyRelease = clone({ sent: true, segment });
    this.completedSegments.push(clone({ phase: "committedGesture", segment, safetyRelease: true }));
    return true;
  }

  finish({ boundaryCrossed = this.boundary !== null, providerCalls = this.providerCalls } = {}) {
    if (this.phase === "postContact") return this.inspect();
    if (!boundaryCrossed) {
      this.boundary = "notCrossed";
      this.providerCalls = 0;
    } else this.providerCalls = providerCalls;
    this.phase = "postContact";
    return this.inspect();
  }

  inspect() {
    return clone({ phase: this.phase, boundary: this.boundary || "notCrossed",
      crossed: this.boundary !== null && this.boundary !== "notCrossed", providerCalls: this.providerCalls,
      completedSegments: this.completedSegments, safetyRelease: this.safetyRelease || { sent: false } });
  }
}
