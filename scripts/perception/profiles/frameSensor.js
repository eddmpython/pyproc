// frameSensor.js - cooperative frame의 DOM facts를 PerceptionSpace sensor 계약으로 가져온다.

function sensorError(message) {
  const error = new Error(message);
  error.code = "APX_SCHEMA_INVALID";
  error.outcome = "notSent";
  error.retryable = false;
  return error;
}

function redactedUrl(value) {
  try {
    const url = new URL(value);
    url.username = "";
    url.password = "";
    url.search = "";
    url.hash = "";
    return url.href;
  } catch (error) {
    return "[redacted-url]";
  }
}

export class FrameSensor {
  constructor({ dispatch, idFactory = () => crypto.randomUUID() } = {}) {
    if (typeof dispatch !== "function") throw new TypeError("FrameSensor dispatch is required");
    if (typeof idFactory !== "function") throw new TypeError("FrameSensor idFactory is invalid");
    this.dispatch = dispatch;
    this.idFactory = idFactory;
  }

  async capture(sessionRef, options, context = {}) {
    const facts = await this.dispatch("frame.perception.capture", {
      sessionRef,
      maxEntities: options.budget.maxEntities,
      issueLocators: context.issueLocators !== false,
      includeEnvironment: options.channels.includes("environment"),
    }, { signal: context.signal, requestId: `framePerception:${this.idFactory()}` });
    if (!facts || typeof facts !== "object" || !Number.isInteger(facts.documentEpoch)
      || !Array.isArray(facts.entities) || !Array.isArray(facts.relations)
      || !Array.isArray(facts.events) || !facts.page || typeof facts.page !== "object") {
      throw sensorError("FrameSpace returned an invalid APX sensor payload");
    }
    return Object.freeze({
      ...facts,
      page: Object.freeze({ ...facts.page, url: redactedUrl(facts.page.url) }),
    });
  }
}
