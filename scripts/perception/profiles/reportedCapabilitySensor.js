// reportedCapabilitySensor.js - cooperative page capability를 content provenance의 claim으로 정규화한다.
const REPORTED_REF = /^reported:[A-Za-z0-9._:-]{1,128}$/;
const NATIVE_SUBJECT = /^[A-Za-z][A-Za-z0-9._:-]{1,256}$/;

function invalid(message) {
  const error = new TypeError(message);
  error.code = "APX_SCHEMA_INVALID";
  error.outcome = "notSent";
  error.retryable = false;
  throw error;
}

export function normalizeReportedCapabilities(values = [], { source = "cooperative.capability",
  origin = null, revision = null } = {}) {
  if (!Array.isArray(values) || values.length > 64) invalid("reported capabilities must be a bounded array");
  return Object.freeze(values.map((value, index) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) invalid(`reported capability ${index} is invalid`);
    const allowed = new Set(["reportedCapabilityRef", "subjectNativeRef", "name", "action", "destination"]);
    for (const key of Object.keys(value)) if (!allowed.has(key)) invalid(`reported capability does not accept ${key}`);
    if (!REPORTED_REF.test(String(value.reportedCapabilityRef || ""))
      || !NATIVE_SUBJECT.test(String(value.subjectNativeRef || ""))
      || typeof value.name !== "string" || !value.name || value.name.length > 300
      || typeof value.action !== "string" || !value.action || value.action.length > 80
      || (value.destination !== undefined && typeof value.destination !== "string")) {
      invalid(`reported capability ${index} is invalid`);
    }
    return Object.freeze({ subjectNativeRef: value.subjectNativeRef, predicate: "capability.action",
      value: value.action, provenance: Object.freeze({ mode: "reported", source, trust: "page" }),
      capability: Object.freeze({ reportedCapabilityRef: value.reportedCapabilityRef, name: value.name,
        action: value.action, destination: value.destination || null, origin, revision, source }) });
  }));
}

export function inspectReportedCapabilitySupport({ cooperative = false, nativeWebMcp = null } = {}) {
  return Object.freeze({ cooperative, nativeWebMcp: nativeWebMcp || "unsupported",
    authority: "reported-content-only" });
}
