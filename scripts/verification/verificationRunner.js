// verificationRunner.js - strict contract를 existing AutomationSpace 위에서 실행한다.
import { setTimeout as delay } from "node:timers/promises";
import { loadExperienceContract } from "./experienceContract.js";
import {
  createEvidencePack,
  evidencePackAttachment,
  publishEvidencePack,
} from "./evidencePack.js";
import { verificationBytesDigest, verificationDigest, verificationError } from "./verificationCanonical.js";
import {
  evaluateVerificationCheckpoint,
  redactVerificationEvidence,
  verificationScenarioTerminal,
} from "./verificationOracle.js";
import { projectMotorJourneyEvidence } from "./motorJourneyEvidence.js";

function fail(code, message) { throw verificationError(code, message); }
function sessionValue(attached) { return attached?.sessionRef || attached; }
function browserIdentity(inspection) {
  const compatibility = inspection.compatibility || {};
  const product = String(compatibility.product || compatibility.browser || "unknown");
  const slash = product.lastIndexOf("/");
  return Object.freeze({ family: String(compatibility.family || product.slice(0, slash > 0 ? slash : undefined)).toLowerCase(),
    version: String(compatibility.version || (slash > 0 ? product.slice(slash + 1) : "unknown")) });
}
function viewportMatches(actual, expected) {
  if (!actual) return false;
  return actual.width === expected.width && actual.height === expected.height
    && actual.deviceScaleFactor === expected.deviceScaleFactor
    && !!actual.mobile === expected.mobile && !!actual.touch === expected.touch;
}
function exactStringSet(actual, expected) {
  return Array.isArray(actual) && actual.length === expected.length
    && [...actual].sort().every((value, index) => value === [...expected].sort()[index]);
}
function observedOrigins(inspection) {
  return inspection.policy?.targetOrigins || inspection.targetOrigins || null;
}
function environmentMatches(actual, expected) {
  return !!actual && actual.locale === expected.locale && actual.timezoneId === expected.timezoneId
    && actual.colorScheme === expected.colorScheme && actual.reducedMotion === expected.reducedMotion
    && actual.fontFingerprint === expected.fontFingerprint;
}
function abortCheck(signal) {
  if (signal?.aborted) fail("CONTROL_CANCELLED", String(signal.reason || "verification cancelled"));
}
function readinessSatisfied(situation) {
  return situation.requirements.every((entry) => entry.state === "satisfied");
}
function retainArtifact(artifact, bytes, artifactBytes, artifacts, quota) {
  if (artifactBytes.has(artifact.sha256)) return;
  const totalBytes = [...artifactBytes.values()].reduce((total, entry) => total + entry.byteLength, 0);
  if (bytes.byteLength > quota.maxArtifactBytes || artifacts.length >= quota.maxArtifacts
    || totalBytes + bytes.byteLength > quota.maxTotalBytes) {
    fail("EYES_ARTIFACT_QUOTA", "evidence exceeds the Experience Contract artifact quota");
  }
  artifactBytes.set(artifact.sha256, bytes);
  artifacts.push(artifact);
}
function strongerTerminal(left, right) {
  const rank = { verified: 0, rejected: 1, incomplete: 2 };
  return rank[right] > rank[left] ? right : left;
}
function extractArtifacts(value, artifactBytes, artifacts, quota) {
  if (Array.isArray(value)) return value.map((entry) => extractArtifacts(entry, artifactBytes, artifacts, quota));
  if (!value || typeof value !== "object") return value;
  if (value.kind === "screenshot" && typeof value.dataBase64 === "string"
    && typeof value.sha256 === "string" && typeof value.mimeType === "string") {
    const bytes = Buffer.from(value.dataBase64, "base64");
    if (bytes.toString("base64") !== value.dataBase64 || bytes.byteLength !== value.byteLength
      || verificationBytesDigest(bytes) !== value.sha256) fail("EYES_ARTIFACT_INVALID", "visual evidence metadata mismatch");
    if (!artifactBytes.has(value.sha256)) {
      retainArtifact(Object.freeze({ artifactRef: `artifact:sha_${value.sha256}`, sha256: value.sha256,
        byteLength: bytes.byteLength, mimeType: value.mimeType, purpose: "unresolved visual claim" }),
      bytes, artifactBytes, artifacts, quota);
    }
    const { dataBase64, ...descriptor } = value;
    return { ...descriptor, artifactRef: `artifact:sha_${value.sha256}` };
  }
  return Object.fromEntries(Object.entries(value).map(([key, child]) =>
    [key, extractArtifacts(child, artifactBytes, artifacts, quota)]));
}

export class VerificationRunner {
  constructor({ automation, producerVersion = "0.0.0", now = () => new Date().toISOString(),
    motorJourneyResolver = null } = {}) {
    if (!automation || typeof automation.invoke !== "function") throw new TypeError("verification runner requires AutomationSpace");
    if (motorJourneyResolver !== null && typeof motorJourneyResolver !== "function") {
      throw new TypeError("motorJourneyResolver must be a function");
    }
    this.automation = automation;
    this.producerVersion = producerVersion;
    this.now = now;
    this.motorJourneyResolver = motorJourneyResolver;
  }

  async audit({ contractRoot, repositoryRoot, outputDir, environmentId, repository,
    motorJourneys = [] }, { signal } = {}) {
    abortCheck(signal);
    const contract = await loadExperienceContract(contractRoot);
    const environment = contract.experience.environments.find((entry) => entry.environmentId === environmentId);
    if (!environment) fail("EYES_ENVIRONMENT_UNKNOWN", `environment is not declared: ${environmentId}`);
    const inspection = await this.automation.invoke("automation.space.inspect", {}, { signal });
    const browser = browserIdentity(inspection);
    const manifestBase = Object.freeze({ producerVersion: this.producerVersion,
      projectId: contract.experience.project.id, contractSha256: contract.identity.experienceSha256,
      scenarioCatalogSha256: contract.identity.scenarioCatalogSha256,
      baselineCatalogSha256: contract.identity.baselineCatalogSha256, eyesSha256: contract.identity.eyesSha256,
      fixtureSha256: `sha256:${verificationDigest(contract.scenarios.scenarios.map((entry) => entry.fixtureSha256))}`,
      browserFamily: browser.family, browserVersion: browser.version, environmentId,
      viewportSha256: `sha256:${verificationDigest(environment.viewport)}`,
      locale: environment.locale, timezoneId: environment.timezoneId,
      fontFingerprint: environment.fontFingerprint, providerKind: inspection.space?.providerKind || "unknown",
      perception: "apx.situation/1.0", repository: Object.freeze(structuredClone(repository || {})),
      policySha256: `sha256:${verificationDigest(contract.experience.policy)}` });
    const scenarioRuns = [];
    const findings = [];
    const artifactBytes = new Map();
    const artifacts = [];
    if (!viewportMatches(inspection.viewport, environment.viewport)) {
      scenarioRuns.push(Object.freeze({ scenarioId: "environment", required: true, terminal: "incomplete",
        reason: "viewportMismatch", expectedViewport: environment.viewport, actualViewport: inspection.viewport || null,
        checkpoints: Object.freeze([]), actions: Object.freeze([]) }));
    } else if (!exactStringSet(observedOrigins(inspection), contract.experience.target.allowedOrigins)) {
      scenarioRuns.push(Object.freeze({ scenarioId: "authority", required: true, terminal: "incomplete",
        reason: "originAuthorityMismatch", expectedOrigins: contract.experience.target.allowedOrigins,
        actualOrigins: observedOrigins(inspection), checkpoints: Object.freeze([]), actions: Object.freeze([]) }));
    } else {
      for (const scenario of contract.scenarios.scenarios) {
        abortCheck(signal);
        const result = await this._runScenario(contract, scenario, environment, { signal, artifactBytes, artifacts });
        scenarioRuns.push(result);
        findings.push(...result.findings);
      }
    }
    if (!Array.isArray(motorJourneys)) fail("EYES_MOTOR_JOURNEY_INVALID", "motorJourneys must be an array");
    if (motorJourneys.length && !this.motorJourneyResolver) {
      fail("EYES_MOTOR_JOURNEY_UNAVAILABLE", "Motor journey evidence requires an enabled Motor store");
    }
    for (const reference of motorJourneys) {
      abortCheck(signal);
      if (!reference || typeof reference !== "object" || typeof reference.receiptSha256 !== "string"
        || typeof reference.scenarioId !== "string" || typeof reference.checkpointId !== "string") {
        fail("EYES_MOTOR_JOURNEY_INVALID", "Motor journey reference is invalid");
      }
      const scenarioIndex = scenarioRuns.findIndex((run) => run.scenarioId === reference.scenarioId);
      if (scenarioIndex < 0) fail("EYES_MOTOR_SCENARIO_UNKNOWN",
        `Motor journey scenario is not declared: ${reference.scenarioId}`);
      const journey = await this.motorJourneyResolver(reference.receiptSha256);
      const projected = projectMotorJourneyEvidence({ ...journey,
        projectId: contract.experience.project.id, scenarioId: reference.scenarioId,
        checkpointId: reference.checkpointId, environmentClass: environmentId });
      retainArtifact(projected.artifact, projected.bytes, artifactBytes, artifacts,
        contract.experience.policy.artifactQuota);
      if (projected.finding) findings.push(projected.finding);
      const scenarioRun = scenarioRuns[scenarioIndex];
      scenarioRuns[scenarioIndex] = Object.freeze({ ...scenarioRun,
        terminal: strongerTerminal(scenarioRun.terminal, projected.verdict),
        motorJourneys: Object.freeze([...(scenarioRun.motorJourneys || []), projected.summary]) });
    }
    const verdict = scenarioRuns.some((run) => run.terminal === "incomplete") ? "incomplete"
      : scenarioRuns.some((run) => run.terminal === "rejected") ? "rejected" : "verified";
    const pack = createEvidencePack({ manifest: manifestBase,
      scenarioRuns: redactVerificationEvidence(scenarioRuns, contract.experience.policy.redactions),
      findings: redactVerificationEvidence(findings, contract.experience.policy.redactions),
      artifacts, verdict, generatedAt: this.now() });
    const publication = await publishEvidencePack({ repositoryRoot, outputDir, pack, artifactBytes });
    return Object.freeze({ verdict, contentSha256: pack.contentSha256, publication,
      packAttachment: evidencePackAttachment(pack) });
  }

  async _runScenario(contract, scenario, environment, { signal, artifactBytes, artifacts }) {
    let sessionRef = null;
    const actions = [];
    const checkpoints = [];
    const situations = [];
    const findings = [];
    const quota = contract.experience.policy.artifactQuota;
    let cleanup = "completed";
    let reason = null;
    try {
      const opened = await this.automation.invoke("automation.target.open", {
        url: new URL(scenario.route, contract.experience.target.baseUrl).href,
        expectedRisk: "externalEffect", waitUntil: "load",
      }, { signal });
      const attached = await this.automation.invoke("automation.session.attach", { targetRef: opened.targetRef }, { signal });
      sessionRef = sessionValue(attached);
      const environmentObservation = await this.automation.invoke("automation.observe", { sessionRef,
        expectedRisk: "read", representation: "apx.graph", channels: ["semantic", "environment"],
        visual: { mode: "off" } }, { signal });
      situations.push(extractArtifacts(environmentObservation, artifactBytes, artifacts, quota));
      if (!environmentMatches(environmentObservation.page?.environment, environment)) {
        reason = "environmentMismatch";
      }
      const deadline = Date.now() + contract.experience.readiness.timeoutMs;
      let ready = null;
      while (!reason && Date.now() <= deadline) {
        abortCheck(signal);
        ready = await this.automation.invoke("automation.observe", { sessionRef, expectedRisk: "read",
          representation: "apx.situation", focus: { requirements: scenario.readiness.requirements,
            freshness: { mode: "live", maxAgeMs: 1000 } }, visual: { mode: "off" } }, { signal });
        if (readinessSatisfied(ready)) break;
        await delay(50, undefined, { signal });
      }
      if (!ready || !readinessSatisfied(ready)) reason = "readinessTimeout";
      else {
        situations.push(extractArtifacts(ready, artifactBytes, artifacts, quota));
        let lastEvidence = null;
        for (const step of scenario.steps) {
          const requirementRef = `requirement:${step.stepId}`;
          const stepSituation = await this.automation.invoke("automation.observe", { sessionRef,
            expectedRisk: "read", representation: "apx.situation", focus: { requirements: [{
              requirementRef, select: step.target, need: ["fact", "affordance"], cardinality: "one",
            }], freshness: { mode: "live", maxAgeMs: 1000 } }, visual: { mode: "off" } }, { signal });
          situations.push(extractArtifacts(stepSituation, artifactBytes, artifacts, quota));
          const affordance = stepSituation.affordances.find((entry) => entry.kind === "authorized"
            && entry.requirementRef === requirementRef && entry.action === step.action.kind);
          if (!affordance) { reason = "authorizedAffordanceMissing"; break; }
          if (affordance.risk !== step.action.expectedRisk) { reason = "authorizedRiskMismatch"; break; }
          const { kind: declaredKind, expectedRisk: declaredRisk, ...actionParameters } = step.action;
          const action = { kind: affordance.action, locatorRef: affordance.locatorRef,
            expectedRisk: affordance.risk, actionContext: { situationRef: stepSituation.situationRef,
              worldRef: stepSituation.worldRef, capabilityRef: affordance.capabilityRef,
              expectedTransition: step.expectedTransition || affordance.expectedTransition },
            ...actionParameters,
            ...(step.verify ? { verify: step.verify } : {}) };
          const applied = await this.automation.invoke("automation.act", { sessionRef, actions: [action] }, { signal });
          const actionResult = applied.actions?.[0] || applied.results?.[0];
          lastEvidence = actionResult?.result?.evidence || null;
          actions.push(Object.freeze({ stepId: step.stepId, terminal: lastEvidence?.effectOutcome || "applied",
            evidence: lastEvidence }));
        }
        if (!reason) for (const checkpoint of scenario.checkpoints) {
          const visualRequired = checkpoint.rules.some((rule) => rule.kind === "perceptual");
          const situation = await this.automation.invoke("automation.observe", { sessionRef, expectedRisk: "read",
            representation: "apx.situation", focus: { requirements: checkpoint.focus.requirements,
              freshness: { mode: "live", maxAgeMs: 1000 } },
            visual: visualRequired ? { mode: "full", overview: "lowResolution" } : { mode: "off" } }, { signal });
          const recordedSituation = extractArtifacts(situation, artifactBytes, artifacts, quota);
          situations.push(recordedSituation);
          let diagnostics = { console: [], network: [] };
          if (checkpoint.rules.some((rule) => rule.check === "diagnosticsClean")) {
            const diagnosticObservation = await this.automation.invoke("automation.observe", { sessionRef,
              expectedRisk: "read", representation: "apx.graph",
              channels: ["semantic", "events", "networkMetadata"], visual: { mode: "off" } }, { signal });
            situations.push(extractArtifacts(diagnosticObservation, artifactBytes, artifacts, quota));
            diagnostics = {
              console: (diagnosticObservation.events || []).filter((event) => event.kind === "console"
                && ["error", "assert"].includes(event.level)),
              network: (diagnosticObservation.events || []).filter((event) => event.kind === "network"
                && (event.phase === "failed" || (event.phase === "response" && event.status >= 400))),
            };
          }
          const visualArtifact = recordedSituation.visualProbes?.[0]?.artifact;
          const inference = visualArtifact ? Object.freeze({ inputSha256: visualArtifact.sha256,
            evidenceRefs: Object.freeze([visualArtifact.artifactRef]) }) : null;
          const evaluated = evaluateVerificationCheckpoint({ projectId: contract.experience.project.id,
            scenarioId: scenario.scenarioId, checkpoint, environmentId: environment.environmentId,
            situation: recordedSituation, actionEvidence: actions.at(-1)?.evidence || null, diagnostics, inference });
          checkpoints.push(Object.freeze({ checkpointId: checkpoint.checkpointId,
            situationRef: situation.situationRef, worldRef: situation.worldRef,
            evaluations: evaluated.evaluations, incomplete: evaluated.incomplete }));
          findings.push(...evaluated.findings);
        }
      }
    } catch (error) {
      if (signal?.aborted) throw error;
      reason = error?.code || "scenarioFailure";
      if (["outcomeUnknown", "applied"].includes(error?.outcome)) actions.push(Object.freeze({
        stepId: "unknown", terminal: error.outcome, error: error?.code || "SCENARIO_FAILED" }));
    } finally {
      if (sessionRef) {
        try { await this.automation.invoke("automation.session.detach", { sessionRef }, {}); }
        catch (error) { cleanup = "failed"; }
      }
    }
    const terminal = reason ? "incomplete" : verificationScenarioTerminal({ required: scenario.required,
      checkpointResults: checkpoints, actionTerminals: actions.map((entry) => entry.terminal), cleanup,
      rejectSeverities: contract.experience.policy.rejectSeverities });
    return Object.freeze({ scenarioId: scenario.scenarioId, required: scenario.required, terminal,
      ...(reason ? { reason } : {}), cleanup, actions: Object.freeze(actions), checkpoints: Object.freeze(checkpoints),
      situations: Object.freeze(situations), findings: Object.freeze(findings) });
  }
}
