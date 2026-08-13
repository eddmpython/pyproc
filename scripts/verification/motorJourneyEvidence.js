// motorJourneyEvidence.js - sealed Motor journey를 기존 Evidence Pack artifact와 finding으로 투영한다.
import { createHash } from "node:crypto";
import {
  assertActuationEpisode,
  assertActuationReceipt,
} from "../actuation/actuationCanonical.js";
import { canonicalVerificationJson } from "./verificationCanonical.js";
import { findingIdentity } from "./verificationOracle.js";

export const MOTOR_JOURNEY_MIME = "application/vnd.pyproc.motor-journey+json";

function terminalState(receipt, episode) {
  if (receipt.cleanup.state === "incomplete" || episode.experienceState === "incomplete") {
    return Object.freeze({ verdict: "incomplete", state: "needsReview", severity: "major" });
  }
  if (["confirmed", "alreadySatisfied"].includes(receipt.terminal)) {
    return Object.freeze({ verdict: "verified", state: "pass", severity: "advisory" });
  }
  if (["contradicted", "rejected"].includes(receipt.terminal)) {
    return Object.freeze({ verdict: "rejected", state: "fail", severity: "blocker" });
  }
  return Object.freeze({ verdict: "incomplete", state: "needsReview", severity: "major" });
}

export function projectMotorJourneyEvidence({ receipt, episode, projectId, scenarioId,
  checkpointId = "motor-journey", environmentClass } = {}) {
  assertActuationReceipt(receipt);
  assertActuationEpisode(episode);
  if (episode.receiptSha256 !== receipt.receiptSha256) {
    throw new TypeError("Motor journey episode must reference the exact receipt");
  }
  for (const [value, label] of [[projectId, "projectId"], [scenarioId, "scenarioId"],
    [checkpointId, "checkpointId"], [environmentClass, "environmentClass"]]) {
    if (typeof value !== "string" || !value) throw new TypeError(`Motor journey ${label} is required`);
  }
  const journey = Object.freeze({ format: "pyproc.motorJourney", version: 1, receipt, episode });
  const bytes = Buffer.from(`${canonicalVerificationJson(journey)}\n`, "utf8");
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const artifact = Object.freeze({ artifactRef: `artifact:sha_${sha256}`, sha256,
    byteLength: bytes.byteLength, mimeType: MOTOR_JOURNEY_MIME,
    purpose: `sealed Motor journey ${receipt.terminal}` });
  const terminal = terminalState(receipt, episode);
  const finding = terminal.verdict === "verified" ? null : Object.freeze({
    findingRef: findingIdentity({ projectId, scenarioId, checkpointId,
      ruleId: "motor.journeyTerminal", entityLineage: receipt.intentSha256, environmentClass }),
    severity: terminal.severity,
    state: terminal.state,
    kind: "behavioral",
    ruleId: "motor.journeyTerminal",
    terminal: receipt.terminal,
    evidenceRefs: Object.freeze([artifact.artifactRef]),
  });
  return Object.freeze({ artifact, bytes, finding, verdict: terminal.verdict,
    summary: Object.freeze({ receiptSha256: receipt.receiptSha256,
      episodeSha256: episode.episodeSha256, terminal: receipt.terminal,
      artifactRef: artifact.artifactRef }) });
}
