import { readFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { CapabilityProjector } from "../../scripts/perception/capabilityProjector.js";
import { PerceptionSpace } from "../../scripts/perception/perceptionSpace.js";
import { SituationCompiler } from "../../scripts/perception/situationCompiler.js";
import {
  APX_SITUATION_REPRESENTATION,
  assertSituationCapsule,
  validateSituationFocus,
} from "../../scripts/perception/situationCatalog.js";
import { createTransitionProof } from "../../scripts/perception/transitionLedger.js";
import { WorldModel } from "../../scripts/perception/worldModel.js";
import { validatePerceptionOptions } from "../../scripts/perception/apxCatalog.js";
import { apxDigest, canonicalApxJson } from "../../scripts/perception/apxCanonical.js";
import { assertCandidateContinuation, evaluateRequirementCandidates, projectCandidateEvidence }
  from "../../scripts/perception/requirementCandidateEvaluator.js";
import { inspectReportedCapabilitySupport, normalizeReportedCapabilities }
  from "../../scripts/perception/profiles/reportedCapabilitySensor.js";
import { verifyPostcondition } from "../../scripts/perception/postconditionVerifier.js";

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function errorOf(operation) {
  try { await operation(); return null; }
  catch (error) { return error; }
}

function sensorEntity(nativeRef, { role, name, value, sensitivity = "public", actions = [], actionable = false,
  unresolved = null } = {}) {
  return {
    nativeRef,
    locatorData: { backendNodeId: Number(nativeRef.split(":").at(-1)) },
    kind: role === "status" ? "ui.status" : "ui.control",
    semantic: { role, name, ...(value === undefined ? {} : { value }), sensitivity, states: {} },
    structure: { frameNativeRef: "frame:main", nodeName: role === "canvas" ? "CANVAS" : "BUTTON" },
    geometry: { rect: { x: 10, y: 10, width: 100, height: 30 }, viewportRatio: 1,
      paintOrder: 1, visible: true, occluded: false },
    interaction: { supportedActions: actions, actionable, reasons: [] },
    provenance: {
      semantic: { mode: "observed", source: "fixture.semantic", trust: "browser" },
      structure: { mode: "observed", source: "fixture.dom", trust: "browser" },
      geometry: { mode: "observed", source: "fixture.layout", trust: "browser" },
      interaction: { mode: "derived", source: "fixture.actionability", trust: "broker" },
    },
    ...(unresolved ? { unresolved: { reason: unresolved } } : {}),
  };
}

function observationEntity(id, { name = "Submit order", role = "button" } = {}) {
  return Object.freeze({ entityRef: `entity:${id}`, kind: "ui.control",
    semantic: Object.freeze({ role, name, states: Object.freeze({}), sensitivity: "public" }),
    interaction: Object.freeze({ supportedActions: Object.freeze(["click"]), actionable: true,
      reasons: Object.freeze([]) }), locatorRef: `locator:${id}`,
    provenance: Object.freeze({ semantic: Object.freeze({ mode: "observed", source: "fixture", trust: "browser" }),
      interaction: Object.freeze({ mode: "derived", source: "fixture", trust: "broker" }) }) });
}

function graphObservation(entity) {
  return Object.freeze({ protocol: "apx", version: "1.0", representation: "apx.graph", kind: "full",
    observationRef: "observation:pure_1", documentEpoch: 1, capturedAt: "2026-08-13T00:00:00.000Z",
    entities: Object.freeze([entity]), relations: Object.freeze([]), events: Object.freeze([]),
    completeness: Object.freeze({ semantic: "complete", interaction: "complete" }),
    integrity: Object.freeze({ canonicalSha256: "a".repeat(64), graphSha256: "b".repeat(64) }) });
}

function redigest(capsule) {
  capsule.integrity.canonicalSha256 = null;
  capsule.integrity.canonicalSha256 = apxDigest(capsule);
  return capsule;
}

export async function assertPerceptionComputerContract() {
  const schemas = await Promise.all(["apxFocus", "apxSituation"].map(async (name) =>
    JSON.parse(await readFile(new URL(`../../scripts/perception/schemas/${name}Schema.json`, import.meta.url), "utf8"))));
  assert(schemas.every((schema) => schema.$schema === "https://json-schema.org/draft/2020-12/schema"
    && schema.$id.includes("/schemas/apx/1/")), "situation public schemas are not pinned to JSON Schema 2020-12");
  validatePerceptionOptions({ representation: APX_SITUATION_REPRESENTATION, focus: { requirements: [{
    requirementRef: "requirement:submit", select: { role: "button" }, need: ["fact", "affordance"],
  }] } });
  assert((await errorOf(() => Promise.resolve(validatePerceptionOptions({ representation: "apx.graph",
    focus: { requirements: [] } }))))?.code === "APX_SCHEMA_INVALID",
  "apx.graph silently accepted situation focus");
  const reported = normalizeReportedCapabilities([{ reportedCapabilityRef: "reported:save",
    subjectNativeRef: "native:1", name: "Save", action: "delete" }], { origin: "https://allowed.test",
    revision: "fixture-1" });
  assert(reported[0].provenance.trust === "page" && reported[0].capability.action === "delete"
    && inspectReportedCapabilitySupport().nativeWebMcp === "unsupported",
  "reported capability adapter widened page content or overstated native WebMCP support");

  let epoch = 1;
  let observationId = 0;
  let visualCalls = 0;
  const entities = [
    sensorEntity("native:1", { role: "button", name: "Submit order", actions: ["click"], actionable: true }),
    sensorEntity("native:2", { role: "status", name: "Ready" }),
    sensorEntity("native:3", { role: "textbox", name: "Password", value: "never-export-this",
      sensitivity: "credential" }),
  ];
  for (let index = 0; index < 120; index += 1) {
    entities.push(sensorEntity(`native:${index + 10}`, { role: "paragraph", name: `Archive ${index}` }));
  }
  const sensor = { capture: async () => ({ documentEpoch: epoch,
    page: { url: "https://allowed.test/orders", title: "Orders",
      viewport: { width: 1280, height: 800, scale: 1 }, scroll: { x: 0, y: 0 } },
    entities, relations: [], events: [], completeness: { semantic: "complete", structure: "complete",
      geometry: "complete", interaction: "complete", subscriptions: false },
    reportedClaims: [{ subjectNativeRef: "native:1", predicate: "capability.action", value: "delete",
      provenance: { mode: "reported", source: "fixture.page", trust: "page" }, capability: {
        reportedCapabilityRef: "reported:submit", name: "Submit order", action: "delete",
        source: "fixture.page", origin: "https://allowed.test", revision: "fixture-1",
      } }],
  }), dropSession() {}, close() {} };
  const now = Date.parse("2026-08-13T00:00:00.000Z");
  const perception = new PerceptionSpace({ sensor, now: () => now,
    idFactory: () => `situation_${++observationId}`,
    locatorIssuer: (sessionRef, documentEpoch, locator) =>
      `locator:${documentEpoch}:${locator.backendNodeId}:${observationId}`,
    visualProbe: async () => { visualCalls += 1; throw new Error("semantic fixture requested pixels"); },
    capabilityPolicy: ({ action }) => action === "click" ? { risk: "externalEffect" } : null });
  const sessionRef = { protocolVersion: "1", spaceId: "space:native", sessionId: "session:one",
    targetRef: "target:one" };
  const focus = { objective: "Submit and prove acceptance", requirements: [
    { requirementRef: "requirement:submit", select: { role: "button", name: "Submit order" },
      need: ["fact", "affordance"], cardinality: "one" },
    { requirementRef: "requirement:status", select: { role: "status" }, need: ["fact"], cardinality: "one" },
    { requirementRef: "requirement:secret", select: { role: "textbox" }, need: ["fact"], cardinality: "one" },
  ] };
  const capsule = await perception.observe(sessionRef, { representation: APX_SITUATION_REPRESENTATION,
    focus, visual: { mode: "auto" }, budget: { maxEntities: 120, maxRelations: 300, maxBytes: 32768 } });
  assertSituationCapsule(capsule);
  const serialized = canonicalApxJson(capsule);
  assert(capsule.requirements.every((requirement) => requirement.state === "satisfied")
    && capsule.affordances.some((item) => item.kind === "authorized" && item.action === "click")
    && capsule.affordances.some((item) => item.kind === "reported" && item.action === "delete")
    && !capsule.affordances.some((item) => item.kind === "authorized" && item.action === "delete"),
  "situation lost required facts or widened reported authority");
  assert(!serialized.includes("never-export-this") && !serialized.includes("native:1")
    && !serialized.includes("backendNodeId") && visualCalls === 0,
  "situation leaked a secret, raw provider id, or semantic visual artifact");
  assert(serialized.length < JSON.stringify(entities).length, "situation was not smaller than its full semantic state");
  const missingFact = structuredClone(capsule);
  missingFact.facts.shift();
  missingFact.budget.used.facts = missingFact.facts.length;
  assert((await errorOf(() => Promise.resolve(assertSituationCapsule(redigest(missingFact)))))?.code
    === "APX_SCHEMA_INVALID", "required fact deletion passed situation validation");
  const secretFact = structuredClone(capsule);
  const secretAttestation = secretFact.facts.flatMap((fact) => fact.attestations)
    .find((item) => item.sensitivity === "credential");
  secretAttestation.value = "injected-secret";
  assert((await errorOf(() => Promise.resolve(assertSituationCapsule(redigest(secretFact)))))?.code
    === "APX_SCHEMA_INVALID", "secret value insertion passed situation validation");
  const rawDriver = structuredClone(capsule);
  rawDriver.completeness.backendNodeId = 77;
  assert((await errorOf(() => Promise.resolve(assertSituationCapsule(redigest(rawDriver)))))?.code
    === "APX_SCHEMA_INVALID", "raw provider id insertion passed situation validation");
  const widened = structuredClone(capsule);
  widened.affordances.find((item) => item.kind === "reported").risk = "externalEffect";
  assert((await errorOf(() => Promise.resolve(assertSituationCapsule(redigest(widened)))))?.code
    === "APX_SCHEMA_INVALID", "reported capability accepted broker risk widening");
  const reordered = structuredClone(capsule);
  reordered.affordances.reverse();
  assert((await errorOf(() => Promise.resolve(assertSituationCapsule(redigest(reordered)))))?.code
    === "APX_SCHEMA_INVALID", "noncanonical affordance order passed situation validation");
  const missingOmitted = structuredClone(capsule);
  delete missingOmitted.budget.omitted;
  assert((await errorOf(() => Promise.resolve(assertSituationCapsule(redigest(missingOmitted)))))?.code
    === "APX_SCHEMA_INVALID", "missing budget omission report passed situation validation");
  const repeated = await perception.observe(sessionRef, { representation: APX_SITUATION_REPRESENTATION,
    focus, visual: { mode: "auto" }, budget: { maxEntities: 120, maxRelations: 300, maxBytes: 32768 } });
  const repeatedAuthorized = repeated.affordances.find((item) => item.kind === "authorized" && item.action === "click");
  const originalAuthorized = capsule.affordances.find((item) => item.kind === "authorized" && item.action === "click");
  assert(repeated.worldRef === capsule.worldRef && repeatedAuthorized.capabilityRef !== originalAuthorized.capabilityRef
    && repeatedAuthorized.locatorRef !== originalAuthorized.locatorRef,
  "same logical world did not refresh observation evidence and rotated locator authority");

  const authorized = capsule.affordances.find((item) => item.kind === "authorized" && item.action === "click");
  const action = { kind: "click", locatorRef: authorized.locatorRef, expectedRisk: "externalEffect" };
  const actionContext = { situationRef: capsule.situationRef, worldRef: capsule.worldRef,
    capabilityRef: authorized.capabilityRef };
  const rotated = await errorOf(() => Promise.resolve(perception.assertActionContext(sessionRef, actionContext, action)));
  assert(rotated?.code === "APX_CAPABILITY_STALE" && rotated.outcome === "notSent",
    "re-observation left the prior locator capability live");
  const repeatedAction = { kind: "click", locatorRef: repeatedAuthorized.locatorRef, expectedRisk: "externalEffect" };
  const repeatedContext = { situationRef: repeated.situationRef, worldRef: repeated.worldRef,
    capabilityRef: repeatedAuthorized.capabilityRef };
  perception.assertActionContext(sessionRef, repeatedContext, repeatedAction);
  epoch = 2;
  const replacement = await perception.observe(sessionRef, { representation: APX_SITUATION_REPRESENTATION,
    focus, visual: { mode: "off" }, budget: { maxEntities: 120, maxRelations: 300, maxBytes: 32768 } });
  assert(replacement.worldRef !== capsule.worldRef, "document replacement reused an old world");
  const stale = await errorOf(() => Promise.resolve(perception.assertActionContext(sessionRef, repeatedContext, repeatedAction)));
  assert(stale?.code === "APX_CAPABILITY_STALE" && stale.outcome === "notSent",
    "old epoch capability reached the provider boundary");

  const pureWorld = new WorldModel().prepare("pure", graphObservation(observationEntity("submit")), {
    reportedClaims: [{ subjectRef: "entity:submit", predicate: "semantic.name", value: "Delete everything",
      provenance: { mode: "reported", source: "fixture.page", trust: "page" } }],
  }).world;
  assert(pureWorld.claims.find((claim) => claim.predicate === "semantic.name")?.state === "conflicted",
    "world collapsed conflicting attestations to known");
  const canonicalWorld = new WorldModel().prepare("canonical", graphObservation(observationEntity("canonical")), {
    reportedClaims: [{ subjectRef: "entity:canonical", predicate: "geometry.rect",
      value: { height: 4, width: 3, y: 2, x: 1 },
      provenance: { mode: "reported", source: "fixture.page", trust: "page" } },
    { subjectRef: "entity:canonical", predicate: "geometry.rect",
      value: { x: 1, y: 2, width: 3, height: 4 },
      provenance: { mode: "reported", source: "fixture.browser", trust: "browser" } }],
  }).world;
  assert(canonicalWorld.claims.find((claim) => claim.predicate === "geometry.rect")?.state === "known",
    "property insertion order changed canonical claim equality");
  const distinctWorld = new WorldModel().prepare("canonical-distinct",
    graphObservation(observationEntity("canonical")), { reportedClaims: [
      { subjectRef: "entity:canonical", predicate: "geometry.rect", value: { x: 1, y: 2, width: 3, height: 4 },
        provenance: { mode: "reported", source: "fixture.browser", trust: "browser" } },
      { subjectRef: "entity:canonical", predicate: "geometry.rect", value: { x: 1, y: 2, width: 4, height: 4 },
        provenance: { mode: "reported", source: "fixture.page", trust: "page" } },
    ] }).world;
  assert(distinctWorld.claims.find((claim) => claim.predicate === "geometry.rect")?.state === "conflicted",
    "different canonical claim values were falsely merged");
  const invalidCanonical = await errorOf(() => Promise.resolve(new WorldModel().prepare("canonical-invalid",
    graphObservation(observationEntity("canonical")), { reportedClaims: [{ subjectRef: "entity:canonical",
      predicate: "geometry.rect", value: Number.NaN,
      provenance: { mode: "reported", source: "fixture.page", trust: "page" } }] })));
  assert(invalidCanonical instanceof TypeError, "nonfinite claim value silently entered the world");

  const pythonCanonical = spawnSync("python", [fileURLToPath(new URL("../support/apxCanonical.py", import.meta.url))], {
    encoding: "utf8", env: { ...process.env, PYTHONIOENCODING: "utf-8" },
  });
  assert(pythonCanonical.status === 0, `Python canonical parity fixture failed: ${pythonCanonical.stderr}`);
  const pythonVectors = JSON.parse(pythonCanonical.stdout);
  assert(pythonVectors.rejected === 3 && pythonVectors.vectors.every((vector, index) =>
    canonicalApxJson(vector) === pythonVectors.output[index].canonical
      && apxDigest(vector) === pythonVectors.output[index].sha256),
  "JavaScript and Python APX custom canonical vectors diverged");

  const interopUrl = new URL("../../skills/verify-browser-experience/assets/apx/golden-vectors.json", import.meta.url);
  const interopVectors = JSON.parse(await readFile(interopUrl, "utf8"));
  const independentValidatorUrl = new URL("../support/apxIndependentValidator.py", import.meta.url);
  const independentSource = await readFile(independentValidatorUrl, "utf8");
  assert(!/(?:from|import)\s+pyproc|scripts\/perception/iu.test(independentSource),
    "independent validator가 PyProc package 또는 product source를 import한다");
  const independentRun = spawnSync("python", [fileURLToPath(independentValidatorUrl), fileURLToPath(interopUrl)], {
    encoding: "utf8", env: { ...process.env, PYTHONIOENCODING: "utf-8" },
  });
  assert(independentRun.status === 0,
    `independent APX validator failed: ${independentRun.stderr}`);
  const independent = JSON.parse(independentRun.stdout);
  const canonicalDigests = interopVectors.canonicalVectors.map((vector) => {
    assert(canonicalApxJson(vector.value) === vector.canonical && apxDigest(vector.value) === vector.sha256,
      `JavaScript canonical interop vector failed: ${vector.id}`);
    return vector.sha256;
  });
  const candidateTerminals = interopVectors.candidateVectors.map((vector) => {
    const entities = Array.from({ length: vector.matched }, (_, index) =>
      observationEntity(`${vector.id}_${index}`, { role: "button", name: "Target" }));
    const evaluation = evaluateRequirementCandidates({ requirements: [{
      requirementRef: `requirement:${vector.id}`, select: { role: "button", name: "Target" },
      need: ["fact"], cardinality: vector.cardinality,
    }] }, entities, { enumeration: vector.enumeration,
      droppedCount: vector.enumeration === "incomplete" ? 1 : 0 })[0];
    return { id: vector.id, state: evaluation.state, authorized: evaluation.state === "satisfied" };
  });
  const verificationTerminals = interopVectors.verificationVectors.map((vector) => {
    const events = vector.directMatch || vector.directMismatch ? [
      { eventId: `event:${vector.id}_request`, kind: "network", phase: "request",
        method: "POST", url: "https://interop.example/result", requestRef: `request:${vector.id}` },
      { eventId: `event:${vector.id}_response`, kind: "network", phase: "response",
        status: vector.directMatch ? 201 : 500, url: "https://interop.example/result",
        requestRef: `request:${vector.id}` },
    ] : [];
    const result = verifyPostcondition({ networkResponse: {
      method: "POST", urlPath: "/result", status: 201,
    } }, { observation: { entities: [], delta: { added: [], removed: [], changed: [] } }, events,
      coverage: { completeness: vector.windowComplete ? "complete" : "incomplete" }, final: true });
    return { id: vector.id, state: result.state };
  });
  const core = { canonicalDigests, candidateTerminals, verificationTerminals };
  assert(apxDigest(core) === independent.coreDigest
    && JSON.stringify(candidateTerminals) === JSON.stringify(independent.candidateTerminals)
    && JSON.stringify(verificationTerminals) === JSON.stringify(independent.verificationTerminals)
    && independent.negativeVerdicts.every((entry) => entry.rejected),
  "PyProc와 independent validator의 canonical core 또는 terminal verdict가 다르다");

  const denseEntities = Array.from({ length: 10000 }, (_, index) => sensorEntity(`native:${index + 1000}`, {
    role: "button", name: "Save", actions: ["click"], actionable: true,
  }));
  const incompleteEvaluation = evaluateRequirementCandidates({ requirements: [{
    requirementRef: "requirement:paged", select: { role: "button" }, need: ["fact"], cardinality: "one",
  }] }, [observationEntity("page-one")], { documentEpoch: 4, enumeration: "incomplete", droppedCount: 1,
    continuationSeed: "provider-page-two", expiresAt: "2026-08-14T01:00:00.000Z" })[0];
  const incompleteEvidence = projectCandidateEvidence(incompleteEvaluation, ["entity:page-one"]);
  assert(incompleteEvidence.enumeration === "incomplete" && incompleteEvidence.matchedLowerBound === 1
    && incompleteEvidence.continuationRef?.startsWith("continuation:")
    && incompleteEvidence.continuationRef.length === 77
    && incompleteEvaluation.state === "unknown",
  "incomplete candidate enumeration이 lower bound와 opaque continuation을 보존하지 않았다");
  const continuationBinding = { continuationSeed: "provider-page-two",
    worldRef: `world:${apxDigest(["entity:page-one"])}`, surfaceEpoch: "document:4",
    requirementRef: "requirement:paged", selectorSha256: apxDigest({ role: "button" }),
    orderingSha256: apxDigest({ order: "entityRefLexicographic", entityRefs: ["entity:page-one"] }),
    nextOffset: 1, expiresAt: "2026-08-14T01:00:00.000Z" };
  assert(assertCandidateContinuation(incompleteEvidence.continuationRef, continuationBinding,
    { now: Date.parse("2026-08-14T00:59:59.000Z") }).nextOffset === 1,
  "candidate continuation의 exact read binding이 검증되지 않았다");
  for (const mutation of [
    { worldRef: `world:${"f".repeat(64)}` },
    { surfaceEpoch: "document:5" },
    { requirementRef: "requirement:other" },
    { orderingSha256: "f".repeat(64) },
  ]) {
    const mismatch = await errorOf(() => Promise.resolve(assertCandidateContinuation(
      incompleteEvidence.continuationRef, { ...continuationBinding, ...mutation },
      { now: Date.parse("2026-08-14T00:59:59.000Z") })));
    assert(mismatch instanceof TypeError, "candidate continuation binding mismatch가 수락됐다");
  }
  const expiredContinuation = await errorOf(() => Promise.resolve(assertCandidateContinuation(
    incompleteEvidence.continuationRef, continuationBinding,
    { now: Date.parse("2026-08-14T01:00:00.000Z") })));
  assert(expiredContinuation instanceof TypeError, "만료된 candidate continuation이 수락됐다");
  let denseId = 0;
  const densePerception = new PerceptionSpace({ sensor: { capture: async () => ({ documentEpoch: 3, page: {},
    entities: denseEntities, relations: [], events: [], completeness: { semantic: "complete",
      structure: "complete", geometry: "complete", interaction: "complete" } }) },
  idFactory: () => `candidate_${++denseId}`,
  locatorIssuer: () => `locator:candidate_${denseId}`,
  capabilityPolicy: () => ({ risk: "externalEffect" }), now: () => now });
  const denseFocus = { requirements: [{ requirementRef: "requirement:denseSave",
    select: { role: "button", name: "Save" }, need: ["affordance"], cardinality: "one" }] };
  const denseSmall = await densePerception.observe({ ...sessionRef, sessionId: "session:dense-small" }, {
    representation: APX_SITUATION_REPRESENTATION, focus: denseFocus,
    budget: { maxEntities: 1, maxRelations: 0, maxBytes: 65536 },
  });
  const denseWide = await densePerception.observe({ ...sessionRef, sessionId: "session:dense-small" }, {
    representation: APX_SITUATION_REPRESENTATION, focus: denseFocus,
    budget: { maxEntities: 2, maxRelations: 0, maxBytes: 65536 },
  });
  const smallRequirement = denseSmall.requirements[0];
  const wideRequirement = denseWide.requirements[0];
  assert(smallRequirement.state === "conflicted" && smallRequirement.matched === 10000
    && smallRequirement.candidateEvidence.matchedCount === 10000
    && smallRequirement.candidateEvidence.projectedCount === 1
    && smallRequirement.candidateEvidence.omittedMatchedCount === 9999
    && denseSmall.affordances.every((entry) => entry.kind !== "authorized")
    && wideRequirement.state === smallRequirement.state
    && wideRequirement.candidateEvidence.matchSetSha256 === smallRequirement.candidateEvidence.matchSetSha256,
  "candidate truth changed across output budgets or authorized a hidden duplicate");
  densePerception.close();
  const projector = new CapabilityProjector({ authorize: ({ action: kind }) =>
    kind === "click" ? { risk: "externalEffect" } : null, now: () => now });
  const compiler = new SituationCompiler({ capabilityProjector: projector, now: () => now });
  const pureFocus = validateSituationFocus({ requirements: [{ requirementRef: "requirement:submit",
    select: { role: "button" }, need: ["fact", "affordance"] }] });
  const conflicted = compiler.compile(pureWorld, pureFocus, { sessionRef, budget: { maxBytes: 32768 } });
  assert(conflicted.requirements[0].state === "conflicted"
    && !conflicted.affordances.some((item) => item.kind === "authorized"),
  "conflicted target emitted an authorized effect");
  const falseKnown = structuredClone(conflicted);
  const conflictedFact = falseKnown.facts.find((fact) => fact.state === "conflicted");
  conflictedFact.state = "known";
  conflictedFact.value = conflictedFact.attestations[0].value;
  assert((await errorOf(() => Promise.resolve(assertSituationCapsule(redigest(falseKnown)))))?.code
    === "APX_SCHEMA_INVALID", "conflicted attestations were mutated to a known fact");
  const budgetFailure = await errorOf(() => Promise.resolve(compiler.compile(pureWorld, pureFocus,
    { sessionRef, budget: { maxBytes: 100 } })));
  assert(budgetFailure?.code === "APX_BUDGET_EXCEEDED", "required facts were silently omitted by budget");

  const direct = createTransitionProof({ beforeWorldRef: capsule.worldRef, afterWorldRef: replacement.worldRef,
    actionRef: "action:submit", effectOutcome: "applied", correlatedEvents: [{ actionRef: "action:submit" }],
    postcondition: { state: "confirmed", evidenceRefs: ["evidence:accepted"] } });
  const weak = createTransitionProof({ beforeWorldRef: capsule.worldRef, afterWorldRef: replacement.worldRef,
    actionRef: "action:submit", effectOutcome: "applied", correlatedEvents: [{ actionRef: "action:other" }],
    postcondition: { state: "confirmed", evidenceRefs: ["evidence:a", "evidence:b"] } });
  assert(direct.causality === "direct" && direct.businessState === "confirmed"
    && weak.causality === "weak" && weak.businessState === "ambiguous",
  "transition causality falsely confirmed unrelated evidence");
  perception.close();
}
