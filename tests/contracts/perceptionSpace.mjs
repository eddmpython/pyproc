import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import {
  APX_ERROR_CODES,
  APX_REPRESENTATION,
  assertApxObservation,
  assertApxVisualProbe,
  inspectApxConformance,
  validatePerceptionOptions,
} from "../../scripts/perception/apxCatalog.js";
import { apxDigest, canonicalApxJson } from "../../scripts/perception/apxCanonical.js";
import { PerceptionSpace } from "../../scripts/perception/perceptionSpace.js";
import { ActionEvidenceLoop, assertActionEvidence } from "../../scripts/perception/actionEvidence.js";
import { validatePostcondition, verifyPostcondition } from "../../scripts/perception/postconditionVerifier.js";

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function errorOf(operation) {
  try { await operation(); return null; }
  catch (error) { return error; }
}

function sensorEntity(nativeRef, { role, name, kind = "ui.control", disabled = false,
  parentNativeRef = null, bounds = [10, 10, 100, 30], unresolved = null } = {}) {
  return {
    nativeRef,
    locatorData: { backendNodeId: Number(nativeRef.split(":").at(-1)) },
    kind,
    semantic: { role, name, states: { disabled } },
    structure: { parentNativeRef, frameNativeRef: "frame:main", nodeName: role === "canvas" ? "CANVAS" : "BUTTON" },
    geometry: { rect: { x: bounds[0], y: bounds[1], width: bounds[2], height: bounds[3] },
      viewportRatio: 1, paintOrder: 1, visible: true, occluded: false },
    interaction: { supportedActions: role === "canvas" ? [] : ["focus", "click"],
      actionable: !disabled, reasons: disabled ? ["disabled"] : [] },
    provenance: {
      semantic: { mode: "observed", source: "fixture.semantic", trust: "page" },
      geometry: { mode: "observed", source: "fixture.geometry", trust: "browser" },
      interaction: { mode: "derived", source: "fixture.actionability", trust: "broker" },
    },
    ...(unresolved ? { unresolved } : {}),
  };
}

export async function assertPerceptionSpaceContract() {
  const packageJson = JSON.parse(await readFile(new URL("../../package.json", import.meta.url), "utf8"));
  const workflow = await readFile(new URL("../../.github/workflows/ci.yml", import.meta.url), "utf8");
  assert(packageJson.scripts?.["test:apx"] === "node tests/browser/apxProduct.mjs"
    && packageJson.scripts?.["test:perception-computer"] === "node tests/browser/apxProduct.mjs",
    "APX 정식 제품 게이트 npm script가 고정되지 않았다");
  assert((workflow.match(/npm run test:perception-computer/g) || []).length === 2,
    "APX 정식 제품 게이트가 Chrome과 Edge CI에 모두 배선되지 않았다");
  const schemas = await Promise.all(["apxCore", "apxWeb", "apxAction", "apxVisual"].map(async (name) =>
    JSON.parse(await readFile(new URL(`../../scripts/perception/schemas/${name}Schema.json`, import.meta.url), "utf8"))));
  assert(schemas.every((schema) => schema.$schema === "https://json-schema.org/draft/2020-12/schema"
    && schema.$id?.includes("/schemas/apx/1/")),
  "APX 공개 schema가 JSON Schema 2020-12 정본이 아니다");
  const exampleRoot = new URL("../../docs/specs/apx/examples/", import.meta.url);
  const fullExample = JSON.parse(await readFile(new URL("fullObservation.json", exampleRoot), "utf8"));
  const deltaExample = JSON.parse(await readFile(new URL("deltaObservation.json", exampleRoot), "utf8"));
  const evidenceExample = JSON.parse(await readFile(new URL("actionEvidence.json", exampleRoot), "utf8"));
  const situationUnknown = JSON.parse(await readFile(new URL("situationUnknown.json", exampleRoot), "utf8"));
  const situationConflict = JSON.parse(await readFile(new URL("situationConflict.json", exampleRoot), "utf8"));
  assertApxObservation(fullExample);
  assertApxObservation(deltaExample);
  assertActionEvidence(evidenceExample);
  const { assertSituationCapsule } = await import("../../scripts/perception/situationCatalog.js");
  assertSituationCapsule(situationUnknown);
  assertSituationCapsule(situationConflict);
  const frames = [
    [
      sensorEntity("native:11", { role: "button", name: "저장" }),
      sensorEntity("native:12", { role: "status", name: "대기", kind: "ui.status", parentNativeRef: "native:11" }),
      sensorEntity("native:13", { role: "canvas", name: "", kind: "content.canvas",
        bounds: [20, 80, 240, 100], unresolved: { reason: "canvas" } }),
    ],
    [
      sensorEntity("native:11", { role: "button", name: "저장", disabled: true }),
      sensorEntity("native:12", { role: "status", name: "저장 완료", kind: "ui.status", parentNativeRef: "native:11" }),
      sensorEntity("native:13", { role: "canvas", name: "", kind: "content.canvas",
        bounds: [20, 80, 241, 100], unresolved: { reason: "canvas" } }),
    ],
  ];
  let captureIndex = 0;
  let locatorSequence = 0;
  let visualCalls = 0;
  let idSequence = 0;
  const visualBytes = Buffer.alloc(5000, 1);
  const releasedArtifacts = [];
  const sensor = {
    capture: async () => ({
      documentEpoch: 7,
      page: { url: "https://allowed.test/orders", title: "Orders",
        viewport: { width: 800, height: 600, scale: 1 }, scroll: { x: 0, y: 0 } },
      entities: frames[Math.min(captureIndex++, frames.length - 1)],
      relations: [{ type: "parentOf", fromNativeRef: "native:11", toNativeRef: "native:12",
        provenance: { mode: "observed", source: "fixture.semantic", trust: "page" } }],
      events: [],
      completeness: { semantic: "complete", structure: "complete", geometry: "complete",
        interaction: "complete", visual: "notRequested" },
    }),
    dropSession() {},
    close() {},
  };
  const perception = new PerceptionSpace({
    sensor,
    idFactory: () => `fixed_${++idSequence}`,
    locatorIssuer: (sessionRef, documentEpoch, locatorData) =>
      `locator:${documentEpoch}:${locatorData.backendNodeId}:${++locatorSequence}`,
    visualProbe: async (sessionRef, entity) => {
      visualCalls += 1;
      return { kind: "entityCrop", entityRef: entity.entityRef, reason: "canvas", artifact: {
        kind: "screenshot", mimeType: "image/png", artifactRef: `artifact:crop_${visualCalls}`,
        byteLength: visualBytes.byteLength, sha256: createHash("sha256").update(visualBytes).digest("hex"),
        dataBase64: visualBytes.toString("base64"),
      },
      provenance: { mode: "observed", source: "fixture.crop", trust: "browser" } };
    },
    visualRelease: async (probe) => releasedArtifacts.push(probe.artifact.artifactRef),
  });
  const sessionRef = { protocolVersion: "1", sessionId: "session-a", targetRef: "target-a" };

  const first = await perception.observe(sessionRef, {
    representation: APX_REPRESENTATION,
    visual: { mode: "off" },
  });
  assert(first.protocol === "apx" && first.version === "1.0" && first.kind === "full"
    && first.entities.length === 3 && first.relations.length === 1,
  "첫 APX observation이 bounded full graph가 아니다");
  const firstSave = first.entities.find((entity) => entity.semantic?.name === "저장");
  assert(firstSave?.entityRef.startsWith("entity:") && firstSave.locatorRef.startsWith("locator:")
    && firstSave.temporal?.firstSeen === first.observationRef
    && !JSON.stringify(first).includes("native:11") && !JSON.stringify(first).includes("backendNodeId"),
  "public graph가 identity와 capability를 분리하지 않았거나 raw ID를 노출했다");
  assertApxObservation(first);

  const second = await perception.observe(sessionRef, {
    representation: APX_REPRESENTATION,
    since: first.observationRef,
    visual: { mode: "auto", maxCrops: 2 },
  });
  const secondSave = second.entities.find((entity) => entity.entityRef === firstSave.entityRef);
  assert(second.kind === "delta" && second.baseObservationRef === first.observationRef
    && secondSave?.semantic.states.disabled === true && secondSave.locatorRef !== firstSave.locatorRef
    && second.delta.changed.some((entry) => entry.entityRef === firstSave.entityRef
      && entry.paths.some((change) => change.path === "/semantic/states/disabled"))
    && second.visualProbes.length === 1 && visualCalls === 1,
  "delta, stable entity, rotated capability, or pixel-on-demand contract diverged");
  assertApxObservation(second);

  const queried = await perception.observe(sessionRef, {
    representation: APX_REPRESENTATION,
    query: { role: "button", actionable: false },
    budget: { maxEntities: 1, maxRelations: 1, maxBytes: 16384 },
    visual: { mode: "auto", maxCrops: 1 },
  });
  assert(queried.entities.length === 1 && queried.entities[0].entityRef === firstSave.entityRef
    && queried.query?.matched === 1 && queried.visualProbes === undefined && visualCalls === 1,
  "attention query가 current graph와 pixel-on-demand를 bounded subset으로 만들지 않았다");

  const resynced = await perception.observe(sessionRef, {
    representation: APX_REPRESENTATION,
    since: "observation:missing",
    visual: { mode: "off" },
  });
  assert(resynced.kind === "full" && resynced.resyncRequired === true,
    "알 수 없는 base observation이 full resync로 수렴하지 않았다");

  const boundedVisual = await perception.observe(sessionRef, {
    representation: APX_REPRESENTATION,
    visual: { mode: "auto", maxCrops: 1 },
    budget: { maxEntities: 3, maxRelations: 1, maxBytes: 4096 },
  });
  assert(boundedVisual.visualProbes.length === 0 && boundedVisual.budget.omitted.visualProbes === 1
    && releasedArtifacts.length === 1,
  "byte budget에서 빠진 visual artifact가 즉시 회수되지 않았다");

  const unknown = await errorOf(() => Promise.resolve(validatePerceptionOptions({
    representation: APX_REPRESENTATION, surprise: true,
  })));
  assert(unknown?.code === APX_ERROR_CODES.schemaInvalid,
    "APX input unknown key가 sensor 호출 전에 fail closed가 아니다");
  const unsupportedProfileShape = await errorOf(() => Promise.resolve(validatePerceptionOptions({
    representation: APX_REPRESENTATION, profile: ["apx-core/1", "apx-action/1"],
  })));
  assert(unsupportedProfileShape?.code === APX_ERROR_CODES.schemaInvalid,
    "APX observe profile이 core와 web 기반을 강제하지 않는다");
  const invalidObservation = await errorOf(() => Promise.resolve(assertApxObservation({ ...first, protocol: "wrong" })));
  assert(invalidObservation?.code === APX_ERROR_CODES.schemaInvalid,
    "APX output schema 위반이 fail closed가 아니다");
  const leakedDriverId = await errorOf(() => Promise.resolve(assertApxObservation({
    ...first, entities: [{ ...first.entities[0], backendNodeId: 77 }],
  })));
  assert(leakedDriverId?.code === APX_ERROR_CODES.schemaInvalid,
    "APX public graph의 raw driver ID가 schema gate를 통과했다");
  const wrongRepresentationBody = { ...first, representation: "apx.other",
    integrity: { ...first.integrity, canonicalSha256: null } };
  const wrongRepresentationValue = {
    ...wrongRepresentationBody,
    integrity: { ...wrongRepresentationBody.integrity, canonicalSha256: apxDigest(wrongRepresentationBody) },
  };
  assert(wrongRepresentationValue.representation === "apx.other", "APX 음성 fixture 자체가 오염됐다");
  const wrongRepresentation = await errorOf(() => assertApxObservation(wrongRepresentationValue));
  assert(wrongRepresentation?.code === APX_ERROR_CODES.schemaInvalid,
    `digest를 다시 계산한 APX envelope schema 위반을 놓쳤다: ${wrongRepresentation?.code || "none"}`);
  const unsafeRegex = await errorOf(() => Promise.resolve(validatePerceptionOptions({
    representation: APX_REPRESENTATION, query: { name: { regex: "(a+)+$" } },
  })));
  assert(unsafeRegex?.code === APX_ERROR_CODES.schemaInvalid,
    "APX attention query가 catastrophic regex를 허용했다");
  const invalidProbe = await errorOf(() => Promise.resolve(assertApxVisualProbe({
    kind: "entityCrop", entityRef: "entity:save", reason: "canvas",
    artifact: { kind: "screenshot", mimeType: "image/png", artifactRef: "artifact:bad", byteLength: 1,
      sha256: "0".repeat(64) },
    provenance: { mode: "derived", source: "fixture", trust: "browser" },
  })));
  assert(invalidProbe?.code === APX_ERROR_CODES.schemaInvalid,
    "APX visual probe가 schema 밖 provenance를 허용했다");

  const failedVisualReleases = [];
  let failedVisualCalls = 0;
  const failingVisual = new PerceptionSpace({
    sensor: { capture: async () => ({ documentEpoch: 1, page: {},
      entities: [sensorEntity("native:31", { role: "canvas", name: "", kind: "content.canvas",
        unresolved: { reason: "canvas" } }),
      sensorEntity("native:32", { role: "canvas", name: "", kind: "content.canvas",
        unresolved: { reason: "canvas" } })], relations: [], events: [], completeness: {} }) },
    idFactory: () => `failed_${++idSequence}`,
    visualProbe: async (sessionRef, entity) => {
      failedVisualCalls += 1;
      if (failedVisualCalls === 2) throw new Error("second crop failed");
      return { kind: "entityCrop", entityRef: entity.entityRef, reason: "canvas",
        artifact: { kind: "screenshot", mimeType: "image/png", artifactRef: "artifact:first",
          byteLength: 8, sha256: createHash("sha256").update(Buffer.from("fixture!")).digest("hex") },
        provenance: { mode: "observed", source: "fixture.crop", trust: "browser" } };
    },
    visualRelease: async (probe) => failedVisualReleases.push(probe.artifact.artifactRef),
  });
  const failedVisual = await errorOf(() => failingVisual.observe(sessionRef, {
    representation: APX_REPRESENTATION, visual: { mode: "auto", maxCrops: 2 },
  }));
  assert(failedVisual?.message === "second crop failed" && failedVisualCalls === 2
    && failedVisualReleases.join(",") === "artifact:first",
  "중간 visual capture 실패가 이미 만든 artifact를 정확히 한 번 회수하지 않았다");
  const recoveredVisual = await failingVisual.observe(sessionRef, {
    representation: APX_REPRESENTATION, visual: { mode: "off" },
  });
  assert(recoveredVisual.kind === "full" && failingVisual.inspect().observations === 1
    && recoveredVisual.entities.every((entity) => entity.temporal.firstSeen === recoveredVisual.observationRef),
  "실패한 observation이 identity 또는 timeline에 숨은 상태를 남겼다");
  failingVisual.close();

  let activeCaptures = 0;
  let maxActiveCaptures = 0;
  let orderedCapture = 0;
  const orderedPerception = new PerceptionSpace({
    sensor: { capture: async () => {
      const capture = ++orderedCapture;
      activeCaptures += 1;
      maxActiveCaptures = Math.max(maxActiveCaptures, activeCaptures);
      await new Promise((resolve) => setTimeout(resolve, capture === 1 ? 15 : 0));
      activeCaptures -= 1;
      return { documentEpoch: 1, page: {}, entities: [sensorEntity("native:41", {
        role: "status", name: `capture-${capture}`, kind: "ui.status",
      })], relations: [], events: [], completeness: {} };
    } },
    idFactory: () => `ordered_${++idSequence}`,
  });
  const orderedSession = { protocolVersion: "1", sessionId: "session-ordered", targetRef: "target-ordered" };
  const [orderedFirst, orderedSecond] = await Promise.all([
    orderedPerception.observe(orderedSession, { representation: APX_REPRESENTATION }),
    orderedPerception.observe(orderedSession, { representation: APX_REPRESENTATION }),
  ]);
  assert(maxActiveCaptures === 1
    && orderedFirst.entities[0].semantic.name === "capture-1"
    && orderedSecond.entities[0].semantic.name === "capture-2"
    && orderedSecond.entities[0].temporal.firstSeen === orderedFirst.observationRef,
  "같은 session의 concurrent observation이 FIFO로 직렬화되지 않았다");
  orderedPerception.close();

  const events = [
    { eventId: "event:req", requestRef: "request:order", kind: "network", phase: "request",
      method: "POST", url: "https://allowed.test/order" },
    { eventId: "event:res", requestRef: "request:order", kind: "network", phase: "response",
      status: 201, url: "https://allowed.test/order" },
  ];
  const confirmed = verifyPostcondition({ all: [
    { entityAppeared: { role: "status", nameContains: "완료" } },
    { networkResponse: { method: "POST", urlPath: "/order", status: 201 } },
  ] }, { observation: second, events, final: true });
  const contradicted = verifyPostcondition({ networkResponse: {
    method: "POST", urlPath: "/order", status: 500,
  } }, { observation: second, events, final: true });
  const notObserved = verifyPostcondition({ entityAppeared: {
    role: "dialog", nameContains: "승인",
  } }, { observation: { ...second, delta: { added: [], removed: [], changed: [] } }, events: [], final: true });
  const ambiguous = verifyPostcondition({ entityAppeared: {
    role: "dialog", nameContains: "승인",
  } }, { observation: second, events, final: true });
  assert(confirmed.state === "confirmed" && confirmed.evidenceRefs.length >= 2
    && contradicted.state === "contradicted" && ambiguous.state === "ambiguous"
    && notObserved.state === "notObserved",
  "EvidenceLoop postcondition 판정이 성공, 반증, 미관찰을 분리하지 않았다");
  const falseCorrelation = verifyPostcondition({ networkResponse: {
    method: "POST", urlPath: "/order", status: 201,
  } }, { observation: second, events: [events[0], { ...events[1], requestRef: "request:other" }], final: true });
  assert(falseCorrelation.state !== "confirmed",
    "EvidenceLoop가 서로 다른 network request와 response를 거짓 상관시켰다");

  let effectCalls = 0;
  const loop = new ActionEvidenceLoop({ idFactory: () => "capture_failure", now: (() => {
    let value = 1000;
    return () => value += 10;
  })() });
  const captureFailure = await errorOf(() => loop.run({
    actionRef: "action:capture_failure",
    postcondition: { entityAppeared: { role: "status", nameContains: "done" }, withinMs: 20 },
    capture: async ({ phase }) => {
      if (phase === "before") return { observationRef: "observation:before", events: [] };
      const error = new Error("sensor disconnected after effect");
      error.code = "CONTROL_CONNECTION_LOST";
      error.outcome = "notSent";
      throw error;
    },
    effect: async () => { effectCalls += 1; return { clicked: true }; },
  }));
  assert(effectCalls === 1 && captureFailure?.outcome === "outcomeUnknown"
    && captureFailure?.retryable === false
    && captureFailure?.actionEvidence?.verification?.state === "outcomeUnknown",
  "effect 뒤 capture 실패가 보수적 evidence terminal로 수렴하지 않았다");
  const frozenEffectFailure = Object.freeze(Object.assign(new Error("frozen effect"), {
    code: "FROZEN_EFFECT", outcome: "outcomeUnknown", retryable: false,
  }));
  const frozenFailure = await errorOf(() => loop.run({
    actionRef: "action:frozen_failure",
    postcondition: { entityAppeared: { role: "status" } },
    capture: async () => ({ observationRef: "observation:frozen_before", events: [] }),
    effect: async () => { throw frozenEffectFailure; },
  }));
  assert(frozenFailure?.code === "FROZEN_EFFECT" && frozenFailure.outcome === "outcomeUnknown"
    && frozenFailure.retryable === false && frozenFailure.actionEvidence?.verification?.state === "outcomeUnknown",
  "frozen effect 오류가 canonical ActionEvidence terminal로 수렴하지 않았다");

  const conformance = inspectApxConformance();
  assert(conformance.level === "L4" && conformance.profiles.includes("apx-action/1")
    && canonicalApxJson({ b: 1, a: 2 }) === '{"a":2,"b":1}',
  "APX conformance 또는 canonical JSON 계약이 어긋났다");
  perception.close();
  return true;
}
