import { createWebComputer, open } from "../index.js";
import type { MachineStore } from "../src/machine/index.js";
import {
  createEffectTransactionRegistry,
  createAppSpaceRegistry,
  createExecutionMemoryRegistry,
  createActuationIntent,
  PyProcControlClient,
  ControlRemoteError,
} from "../scripts/controlProtocol/controlApi.js";

declare const minimalCrypto: { randomUUID(): string };
declare const store: MachineStore;

// 0.0.10의 비내구 provider 계약은 그대로 컴파일돼야 한다.
createWebComputer({ cryptoProvider: minimalCrypto });

// Web Locks는 브라우저 전역 fallback이 있으므로 durability 안에서 선택 사항이다.
createWebComputer({
  cryptoProvider: globalThis.crypto,
  durability: { groupId: "typed", store },
});

// 내구 경로는 digest/signature가 없는 최소 provider를 받으면 안 된다.
// @ts-expect-error durable computers require the complete Web Crypto surface
createWebComputer({ cryptoProvider: minimalCrypto, durability: { groupId: "typed", store } });

async function durableMachineSurface() {
  const defaultMachine = await open();
  const namedMachine = await open({ name: "typed-machine" });
  const autoCommit: boolean = defaultMachine.status().autoCommit;
  await namedMachine.run("typedValue = 1");
  return autoCommit;
}
void durableMachineSurface;

async function controlSurface() {
  const client = await PyProcControlClient.start("pyproc-control.json");
  const result = await client.runPython("40 + 2", { timeoutMs: 1000 });
  const value: string | null = result.output.value;
  const checkpoint = await client.saveCheckpoint();
  await client.restoreCheckpoint(checkpoint.output.index);
  const request = client.requestAsync("machine.run", { code: "6 * 7" });
  await request.cancel("typed cancellation");
  const eyes = client.perception({ sessionId: "session:typed" });
  const save = (await eyes.query({ role: "button", name: "Save", actionable: true })).one();
  await eyes.act("click", save.locatorRef!, { verify: { entityAppeared: { role: "status" } } });
  const situation = await eyes.situate({ requirements: [{ requirementRef: "requirement:save",
    select: { role: "button", name: "Save" }, need: ["fact", "affordance"], cardinality: "one" }] });
  const saveAffordance = situation.requirement("requirement:save").oneAffordance("click");
  await eyes.actAffordance(saveAffordance, { intent: "Save the document",
    verify: { entityAppeared: { role: "status" } } });
  await eyes.situate({ requirements: [{ requirementRef: "requirement:bad", select: { role: "button" },
    // @ts-expect-error situation requirements use the closed fact, affordance, change vocabulary
    need: ["screenshot"] }] });
  const audited = await client.auditExperience("qa/eyes", { repositoryRoot: ".", outputDir: ".eyes/current",
    environmentId: "desktop", repository: { commit: "abc123",
      treeSha256: `sha256:${"a".repeat(64)}`, diffSha256: `sha256:${"b".repeat(64)}`, untracked: false } });
  const verdict: "verified" | "rejected" | "incomplete" = audited.output.verdict;
  await client.verifyExperience(".eyes/reference", ".eyes/current");
  await client.replayEvidencePack(".eyes/current");
  const project = { workspaceId: "workspace:typed", commit: "typed",
    treeSha256: `sha256:${"a".repeat(64)}` as const,
    diffSha256: `sha256:${"b".repeat(64)}` as const, untracked: false };
  const memory = await client.createExecutionSession("session:typed", project);
  await client.checkpointExecutionSession("session:typed", memory.output.contentSha256,
    { state: "active", branch: null, checkpoint: null, outcomeUnknown: false, pendingIntentSha256: null });
  await client.openExecutionSession("session:typed");
  await client.listExecutionSessions();
  await client.inspectExecutionSession("session:typed");
  await client.exportExecutionHandoff("session:typed", "typed-handoff");
  const preparedEffect = await client.prepareEffectTransaction({
    transactionId: "effect:typed",
    intentId: "intent:typed",
    executionSessionId: "session:typed",
    expectedSessionRevisionSha256: memory.output.contentSha256,
    destination: { origin: "https://example.test", subjectSha256: "a".repeat(64), purpose: "Typed effect" },
    effectTemplate: {
      sessionRef: { protocolVersion: "1", brokerId: "broker:typed", brokerEpoch: "epoch:typed",
        sessionId: "browser:typed", targetRef: "target:typed" },
      focus: { requirements: [{ requirementRef: "requirement:submit", select: { role: "button", name: "Submit" },
        need: ["fact", "affordance"], cardinality: "one" }] },
      actions: [{ kind: "click", requirementRef: "requirement:submit", expectedRisk: "externalEffect",
        verify: { entityAppeared: { role: "status" } } }],
    },
    expectedTransition: { entityAppeared: { role: "status" } },
  });
  const rehearsedEffect = await client.rehearseEffectTransaction("effect:typed",
    preparedEffect.output.transaction.contentSha256, { mode: "computed", code: "40 + 2", expectedValue: "42" });
  await client.inspectEffectTransaction("effect:typed");
  await client.listEffectTransactions();
  const effectState: string = rehearsedEffect.output.state;
  const attachedApp = await client.attachApp({ protocolVersion: "1", spaceId: "space:frame",
    sessionId: "session:frame", targetRef: "target:frame" });
  const appPair = await client.checkpointApp({ appRef: attachedApp.output.appRef, pairId: "pair:typed",
    executionSessionId: "session:typed", expectedSessionRevisionSha256: memory.output.contentSha256,
    expectedActivePairSha256: null });
  await client.branchApp({ appRef: attachedApp.output.appRef, pairId: "pair:typed-branch",
    parentPairId: "pair:typed", executionSessionId: "session:typed",
    expectedSessionRevisionSha256: memory.output.contentSha256,
    expectedActivePairSha256: appPair.output.pair.contentSha256 });
  await client.restoreApp(attachedApp.output.appRef, "pair:typed");
  await client.adoptApp(attachedApp.output.appRef, "pair:typed",
    appPair.output.pair.contentSha256);
  await client.inspectApp(attachedApp.output.appRef);
  await client.listAppPairs();
  const graphs = await client.listReplayGraphs();
  const motorIntent = createActuationIntent({ intent: "activate", target: { spaceRef: "space:typed",
    entityRef: "entity:typed", worldRef: "world:typed", surfaceEpoch: "document:1" },
  desired: { activated: true }, preconditions: [],
  expectedTransition: { entityAppeared: { role: "status" } }, authority: {
    actionCapabilityRef: `capability:${"a".repeat(64)}`, approvalGrantRef: null,
    commitLeaseRef: null, controlLeaseRef: null }, policy: {
    allowedActuatorKinds: ["browserInput"], allowPreContactFallback: false } });
  const motorResult = await client.executeMotor({ sessionRef: { sessionId: "session:typed" },
    situation: {}, requirementRef: "requirement:typed", intent: motorIntent });
  const motorTerminal: string = motorResult.output.receipt.terminal;
  await client.inspectMotor();
  await client.listMotorRecords();
  void motorTerminal;
  const importedGraph = await client.importReplayGraphRecording("graph:typed", "/tmp/typed-recording.json");
  const openedWorld = await client.openReplayWorld("graph:typed", importedGraph.output.graph.rootSha256);
  const worldRef = String(openedWorld.output.world.worldRef);
  await client.replayMotor(motorResult.output.receipt.receiptSha256, worldRef,
    importedGraph.output.graph.startNodeRefs[0]);
  const worldEdges = await client.listReplayWorldEdges(worldRef);
  if (worldEdges.output[0]) {
    await client.traverseReplayWorld(worldRef, String(worldEdges.output[0].capabilityRef),
      String(worldEdges.output[0].sourceNodeRef || importedGraph.output.graph.startNodeRefs[0]));
  }
  const worldCheckpoint = await client.checkpointReplayWorld(worldRef);
  await client.restoreReplayWorld(worldRef, worldCheckpoint.output);
  await client.inspectReplayWorld(worldRef);
  await client.inspectReplayWorldCoverage(worldRef);
  await client.evaluateReplayWorld("graph:typed", importedGraph.output.graph.rootSha256, {
    startNodeRef: importedGraph.output.graph.startNodeRefs[0], goalNodeRefs: [], forbiddenEdgeRefs: [], stepBudget: 1,
  }, []);
  void graphs;
  await client.stageAppEffect(attachedApp.output.appRef, "effect:typed",
    rehearsedEffect.output.contentSha256);
  await client.close();
  return `${value}:${verdict}:${effectState}`;
}
void controlSurface;

declare const controlFailure: ControlRemoteError;
const controlOutcome: string = controlFailure.outcome;
void controlOutcome;

async function directExecutionMemorySurface() {
  const registry = await createExecutionMemoryRegistry({ root: "C:/execution-memory" });
  const sessions: readonly Readonly<Record<string, unknown>>[] = await registry.listSessions();
  return sessions.length;
}
void directExecutionMemorySurface;

async function directEffectTransactionSurface() {
  const registry = await createEffectTransactionRegistry({ root: "C:/execution-memory",
    approvalAuthorities: [{ authorityId: "operator:typed", publicKey: new Uint8Array() }] });
  const transactions: readonly Readonly<Record<string, unknown>>[] = await registry.listTransactions();
  return transactions.length;
}
void directEffectTransactionSurface;

async function directAppSpaceSurface() {
  const registry = await createAppSpaceRegistry({ root: "C:/execution-memory", maxStateBytes: 4096 });
  const pairs: readonly Readonly<Record<string, unknown>>[] = await registry.list();
  return pairs.length;
}
void directAppSpaceSurface;

// @ts-expect-error the legacy wrapper is removed; durable options are direct
open({ persistent: true });
