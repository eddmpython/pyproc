import { createWebComputer, open } from "../index.js";
import type { MachineStore } from "../src/machine/index.js";
import {
  bootCpythonWasiKernel,
  decodeValueEnvelope,
  encodeValueEnvelope,
  HostCapabilityBroker,
  KernelReactiveController,
  KernelVfs,
  MemoryKernelVfsStore,
  MemoryPackageContentStore,
  PackageEnvironment,
  ProductHostCapabilityPort,
  SimpleApiPackageResolver,
  KernelEnvironmentManager,
  KernelTerminal,
  KernelFactory,
  MemoryKernelAssetStore,
  createKernelEngineManifest,
  createOwnedPackageResolver,
  getDataKernelEngineManifest,
  inspectDataKernelEngineDistribution,
  createFramebufferHostAdapter,
} from "../src/composition/wasiSubpath.js";
import { bootKernelMachine, KernelMachine } from "../src/machine/index.js";
import { KernelProcess, KernelProcessManager } from "../src/processOs/kernelProcess.js";
import { KernelSession } from "../src/session/kernelSession.js";
import { createWebGpuHostAdapter, runHardwareVisualOracle } from "../src/composition/gpuSubpath.js";
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
  await defaultMachine.run.python("typedValue = 1");
  const image = await defaultMachine.history.export();
  const reopenedMachine = await open(image);
  await reopenedMachine.run.python("typedValue += 1");
  await defaultMachine.close();
  const inspection = await reopenedMachine.inspect();
  await reopenedMachine.close();
  return inspection.protocol;
}
void durableMachineSurface;

async function gpuSurface() {
  const adapter = await createWebGpuHostAdapter({ requireHardware: true, powerPreference: "high-performance" });
  const receipt = await runHardwareVisualOracle(adapter);
  const protocol: "pyproc.hardwareVisualOracle" = receipt.protocol;
  const version: 1 = receipt.version;
  const operation: "solidRgba8" = receipt.pixel.operation;
  void protocol;
  void version;
  void operation;
  adapter.close();
  // @ts-expect-error power preference is a closed WebGPU vocabulary
  await createWebGpuHostAdapter({ powerPreference: "fastest" });
}
void gpuSurface;

async function kernelValueSurface() {
  const hostBroker = new HostCapabilityBroker({ authorize: ({ capability }) => capability === "terminal.write" });
  const productPort = new ProductHostCapabilityPort({
    framebuffer: createFramebufferHostAdapter(async ({ byteLength }) => { void byteLength; }),
  }).install(hostBroker);
  const vfs = new KernelVfs(new MemoryKernelVfsStore(), { volumeId: "typed", ownerId: "owner:typed" });
  await vfs.open();
  const transaction = vfs.beginTransaction();
  await transaction.write("/home/typed.txt", "typed");
  await transaction.commit();
  const kernel = await bootCpythonWasiKernel({ wasmBytes: new Uint8Array(), stdlibBytes: new Uint8Array(),
    kernelVfs: vfs, hostBroker, checkpointCoordinator: hostBroker });
  const packageStore = new MemoryPackageContentStore();
  const packageResolver = new SimpleApiPackageResolver({
    indexes: [{ url: "https://packages.example/simple/", trustRef: "trust:typed" }],
  });
  const ownedPackageResolver = createOwnedPackageResolver();
  const ownedDataPackageResolver = createOwnedPackageResolver({ profile: "data" });
  const dataEngineManifest = getDataKernelEngineManifest();
  const dataEngineDistribution = inspectDataKernelEngineDistribution();
  void ownedPackageResolver;
  void ownedDataPackageResolver;
  void dataEngineManifest;
  void dataEngineDistribution;
  const packageEnvironment = new PackageEnvironment({ kernel, resolver: packageResolver,
    contentStore: packageStore });
  const terminal = new KernelTerminal(kernel, { packageEnvironment });
  const environmentManager = new KernelEnvironmentManager(kernel, packageEnvironment);
  void terminal;
  void environmentManager;
  const envelope = await encodeValueEnvelope({ exact: 9007199254740993n, bytes: new Uint8Array([1, 2]) });
  await kernel.setValue({ name: "typed", value: envelope });
  const result = await kernel.getValue({ name: "typed" });
  const decoded: unknown = await decodeValueEnvelope(result.value);
  const registration = await kernel.registerApplication({ name: "app", type: "callable", operations: ["call"] });
  await kernel.invokeApplication({ applicationRef: registration.applicationRef, operation: "call", args: [envelope] });
  const reactive = new KernelReactiveController(kernel);
  const checkpoint = await reactive.checkpoint();
  await reactive.restore(checkpoint.checkpointRef);
  await kernel.close();
  await productPort.close();
  return decoded;
}
void kernelValueSurface;

async function kernelFactorySurface() {
  const bytes = new Uint8Array([1]);
  const sha256 = `sha256:${"a".repeat(64)}` as const;
  const manifest = await createKernelEngineManifest({
    engineId: "engine:typed",
    environmentId: sha256,
    runtimeKind: "cpython-wasi",
    target: "wasm32-wasip1",
    pythonVersion: "3.14.6",
    nativeProfile: "core",
    stdlibDir: "python3.14",
    artifacts: {
      wasm: { url: "/python.wasm", sha256, byteLength: bytes.byteLength },
      stdlib: { url: "/stdlib.zip", sha256, byteLength: bytes.byteLength },
    },
    buildManifestSha256: sha256,
  });
  const factory = new KernelFactory({ assetStore: new MemoryKernelAssetStore() });
  const machine: Promise<KernelMachine> = bootKernelMachine(factory, manifest);
  const sessionType: typeof KernelSession = KernelSession;
  const processType: typeof KernelProcess = KernelProcess;
  const processManagerType: typeof KernelProcessManager = KernelProcessManager;
  void machine;
  void sessionType;
  void processType;
  void processManagerType;
}
void kernelFactorySurface;

async function controlSurface() {
  const doctor = await PyProcControlClient.doctor("pyproc-control.json");
  const firstOperation: "machine.run" = doctor.next.firstResult.operation;
  const firstTool: "pythonRun" = doctor.next.firstResult.mcp.tool;
  const client = await PyProcControlClient.start("pyproc-control.json");
  const result = await client.runPython("40 + 2", { timeoutMs: 1000 });
  const value: string | null = result.output.value;
  void firstOperation;
  void firstTool;
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
  const converged = await eyes.actAffordance(saveAffordance, { intent: "Save the document",
    verify: { entityAppeared: { role: "status" } } });
  const convergence = converged.output.actions?.[0]?.convergence || converged.output.results?.[0]?.convergence;
  if (convergence) {
    const maxAttempts: 2 = convergence.maxAttempts;
    const effectRetries: 0 = convergence.effectRetries;
    void maxAttempts;
    void effectRetries;
  }
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
