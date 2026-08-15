export type ControlOutcome = "observed" | "applied" | "notSent" | "rejected" | "outcomeUnknown";

export interface ControlAttachment {
  readonly attachmentId: string;
  readonly kind: string;
  readonly mimeType: string;
  readonly byteLength: number;
  readonly sha256: string;
  readonly bytes: Uint8Array;
}

export interface ControlResult<Output = unknown> {
  readonly terminal: "completed";
  readonly output: Output;
  readonly outcome: "observed" | "applied";
  readonly attachments: readonly ControlAttachment[];
}

export interface MachineRunOutput {
  readonly stdout: string;
  readonly value: string | null;
}

export interface MachineFirstResult {
  readonly schemaVersion: 1;
  readonly operation: "machine.run";
  readonly input: Readonly<{ readonly code: string }>;
  readonly shell: Readonly<{ readonly command: "pyproc-control"; readonly arguments: readonly string[] }>;
  readonly javascript: Readonly<{
    readonly module: "pyproc/control";
    readonly client: "PyProcControlClient";
    readonly startMethod: "start";
    readonly startArguments: readonly string[];
    readonly method: "runPython";
    readonly arguments: readonly string[];
  }>;
  readonly python: Readonly<{
    readonly module: "pyprocControl";
    readonly client: "PyProcClient";
    readonly startMethod: "start";
    readonly startArguments: readonly string[];
    readonly method: "runPython";
    readonly arguments: readonly string[];
  }>;
  readonly mcp: Readonly<{
    readonly command: "pyproc-mcp";
    readonly serverArguments: readonly string[];
    readonly tool: "pythonRun";
    readonly arguments: Readonly<{ readonly code: string }>;
  }>;
}

export interface MachineDoctorReport extends Readonly<Record<string, unknown>> {
  readonly ok: boolean;
  readonly configPath: string;
  readonly checks: readonly Readonly<Record<string, unknown>>[];
  readonly blocking: readonly Readonly<Record<string, unknown>>[];
  readonly advisory: readonly Readonly<Record<string, unknown>>[];
  readonly next: Readonly<{
    readonly doctor: string;
    readonly start: string;
    readonly run: string;
    readonly mcp: string;
    readonly firstResult: MachineFirstResult;
  }>;
}

export interface MachineImageOutput {
  readonly kind: "machineImage";
  readonly mimeType: "application/x-pymachine";
  readonly byteLength: number;
  readonly sha256: string;
  readonly generation: `sha256:${string}`;
  readonly artifactRef: string;
}

export interface ExecutionMemoryProject {
  readonly workspaceId: string;
  readonly commit: string;
  readonly treeSha256: `sha256:${string}`;
  readonly diffSha256: `sha256:${string}`;
  readonly untracked: boolean;
}

export interface ExecutionMemoryWork {
  readonly state: "active" | "waitingApproval" | "suspended" | "completed" | "failed" | "abandoned";
  readonly branch: string | null;
  readonly checkpoint: string | null;
  readonly outcomeUnknown: boolean;
  readonly pendingIntentSha256: string | null;
}

export interface ExecutionMemoryBrowserBoundary {
  readonly situation: Readonly<Record<string, unknown>>;
  readonly cursor: number;
  readonly prefixSha256: string;
}

export interface ExecutionMemoryMachineLink {
  readonly machineId: string;
  readonly generation: `sha256:${string}`;
  readonly environment: string;
  readonly imageSha256: string;
  readonly lifecycle: "portable" | "cold";
}

export interface ExecutionMemoryStoredBrowserBoundary {
  readonly situationRef: string;
  readonly situationSha256: string;
  readonly recordingId: string;
  readonly cursor: number;
  readonly prefixSha256: string;
  readonly finalSha256: string;
}

export interface ExecutionMemoryEvidenceLink {
  readonly contentSha256: string;
  readonly verdict: "verified" | "rejected" | "incomplete";
}

export interface ExecutionMemoryPermissionLink {
  readonly manifestSha256: string;
}

export interface ExecutionMemoryRevision extends Readonly<Record<string, unknown>> {
  readonly format: "pyproc.executionMemoryRevision";
  readonly version: 1;
  readonly executionSessionId: string;
  readonly revision: number;
  readonly parents: readonly string[];
  readonly project: ExecutionMemoryProject;
  readonly machine: ExecutionMemoryMachineLink;
  readonly work: ExecutionMemoryWork;
  readonly browser: ExecutionMemoryStoredBrowserBoundary | null;
  readonly evidence: ExecutionMemoryEvidenceLink | null;
  readonly permissions: ExecutionMemoryPermissionLink;
  readonly provenance: Readonly<{ readonly createdAt: string; readonly source: string }>;
  readonly contentSha256: string;
}

export interface EffectDestination {
  readonly origin: string;
  readonly subjectSha256: string;
  readonly purpose: string;
}

export interface EffectSecretPlaceholder {
  readonly secretEnv: string;
}

export interface EffectTemplate extends Readonly<Record<string, unknown>> {
  readonly sessionRef: ControlSessionRef;
  readonly focus: Readonly<Record<string, unknown>>;
  readonly actions: readonly Readonly<Record<string, unknown>>[];
}

export interface ApprovalGrant extends Readonly<Record<string, unknown>> {
  readonly format: "pyproc.approvalGrant";
  readonly version: 1;
  readonly authorityId: string;
  readonly trustDomainSha256: string;
  readonly intentSha256: string;
  readonly destinationSha256: string;
  readonly risk: "externalEffect";
  readonly sessionRevisionSha256: string;
  readonly expiresAt: string;
  readonly nonce: string;
  readonly policyVersion: string;
  readonly contentSha256: string;
  readonly signature: string;
}

export interface EffectTransactionRevision extends Readonly<Record<string, unknown>> {
  readonly format: "pyproc.effectTransactionRevision";
  readonly version: 1;
  readonly transactionId: string;
  readonly revision: number;
  readonly parents: readonly string[];
  readonly state: "prepared" | "rehearsed" | "approved" | "sending" | "finalizing" | "terminal" | "sealed";
  readonly intent: Readonly<Record<string, unknown>> & { readonly contentSha256: string };
  readonly rehearsals: readonly (Readonly<Record<string, unknown>> & { readonly contentSha256: string })[];
  readonly approval: ApprovalGrant | null;
  readonly lease: (Readonly<Record<string, unknown>> & { readonly contentSha256: string }) | null;
  readonly effectResult: (Readonly<Record<string, unknown>> & { readonly terminal: string;
    readonly contentSha256: string }) | null;
  readonly receipt: (Readonly<Record<string, unknown>> & { readonly contentSha256: string }) | null;
  readonly session: Readonly<{ readonly executionSessionId: string; readonly baseSha256: string;
    readonly pendingSha256: string | null; readonly terminalSha256: string | null }>;
  readonly contentSha256: string;
}

export interface AppSpaceIdentity {
  readonly appId: string;
  readonly origin: string;
  readonly adapterVersion: string;
  readonly stateSchema: string;
}

export interface AppSpaceOutboxEntry {
  readonly intentSha256: string;
  readonly state: "staged" | "terminal";
  readonly terminal: "confirmed" | "contradicted" | "ambiguous" | "notObserved" | "outcomeUnknown" | null;
  readonly effectReceiptSha256: string | null;
}

export interface AppStateSnapshot extends Readonly<Record<string, unknown>> {
  readonly format: "pyproc.appStateSnapshot";
  readonly version: 1;
  readonly identity: AppSpaceIdentity;
  readonly revision: string;
  readonly state: Readonly<Record<string, unknown>>;
  readonly outbox: readonly AppSpaceOutboxEntry[];
  readonly scope: readonly string[];
  readonly stateSha256: string;
  readonly contentSha256: string;
}

export interface AppPairedGeneration extends Readonly<Record<string, unknown>> {
  readonly format: "pyproc.pairedAppGeneration";
  readonly version: 1;
  readonly pairId: string;
  readonly parentPairSha256: string | null;
  readonly app: AppStateSnapshot;
  readonly machine: Readonly<{ readonly checkpointIndex: number; readonly imageSha256: string;
    readonly generation: `sha256:${string}`; readonly environment: string }>;
  readonly session: Readonly<{ readonly executionSessionId: string; readonly revisionSha256: string }>;
  readonly contentSha256: string;
}

export interface AppPairCaptureInput {
  readonly appRef: string;
  readonly pairId: string;
  readonly executionSessionId: string;
  readonly expectedSessionRevisionSha256: string;
  readonly expectedActivePairSha256: string | null;
}

export interface ReplayGraphNode extends Readonly<Record<string, unknown>> {
  readonly nodeRef: `node:${string}`;
  readonly providerKind: string;
  readonly environmentSha256: string;
  readonly policySha256: string;
  readonly state: Readonly<Record<string, unknown>>;
  readonly completeness: "complete" | "partial" | "implicit";
}

export interface ReplayGraphEdge extends Readonly<Record<string, unknown>> {
  readonly edgeRef: `edge:${string}`;
  readonly sourceNodeRef: `node:${string}`;
  readonly targetNodeRef: `node:${string}`;
  readonly operation: string;
  readonly input: Readonly<Record<string, unknown>>;
  readonly terminal: Readonly<{ readonly ok: boolean } & Record<string, unknown>>;
  readonly provenance: "recordedLive" | "recordedFrame" | "transactional" | "syntheticFixture";
  readonly effectClass: "none" | "recordedExternal";
}

export interface ReplayGraphRevision extends Readonly<Record<string, unknown>> {
  readonly format: "pyproc.replayGraph";
  readonly version: 1;
  readonly graphId: string;
  readonly parentRootSha256: string | null;
  readonly startNodeRefs: readonly `node:${string}`[];
  readonly nodes: readonly ReplayGraphNode[];
  readonly edges: readonly ReplayGraphEdge[];
  readonly artifacts: readonly Readonly<Record<string, unknown>>[];
  readonly unexploredActionClasses: readonly string[];
  readonly rootSha256: string;
}

export interface ReplayWorldCheckpoint extends Readonly<Record<string, unknown>> {
  readonly worldRef: string;
  readonly rootSha256: string;
  readonly currentNodeRef: `node:${string}`;
  readonly path: readonly `edge:${string}`[];
  readonly checkpointSha256: string;
}

export type ActuationIntentKind = "activate" | "focus" | "setValue" | "setSelected" | "setExpanded"
  | "scrollTo" | "dragTo";
export type ActuatorKind = "cooperative" | "browserInput" | "accessibility" | "osInput" | "replay";
export type ActuationTerminal = "confirmed" | "contradicted" | "ambiguous" | "notObserved"
  | "outcomeUnknown" | "alreadySatisfied" | "notSent" | "rejected";

export interface ActuationIntentInput extends Readonly<Record<string, unknown>> {
  readonly intent: ActuationIntentKind;
  readonly target: Readonly<{ readonly spaceRef: string; readonly entityRef: string;
    readonly worldRef: string; readonly surfaceEpoch: string }>;
  readonly desired: Readonly<Record<string, unknown>>;
  readonly preconditions: readonly Readonly<Record<string, unknown>>[];
  readonly expectedTransition: Readonly<Record<string, unknown>>;
  readonly authority: Readonly<{ readonly actionCapabilityRef: string;
    readonly approvalGrantRef: string | null; readonly commitLeaseRef: string | null;
    readonly controlLeaseRef: string | null }>;
  readonly policy: Readonly<{ readonly allowedActuatorKinds: readonly ActuatorKind[];
    readonly allowPreContactFallback: boolean }>;
}

export interface ActuationIntent extends ActuationIntentInput {
  readonly protocol: "pyproc.actuationIntent";
  readonly version: 1;
  readonly intentSha256: string;
}

export interface TargetBinding extends Readonly<Record<string, unknown>> {
  readonly protocol: "pyproc.targetBinding";
  readonly version: 1;
  readonly bindingRef: string;
  readonly bindingSha256: string;
  readonly actuatorKind: ActuatorKind;
}

export interface ActuationPlan extends Readonly<Record<string, unknown>> {
  readonly protocol: "pyproc.actuationPlan";
  readonly version: 1;
  readonly planRef: string;
  readonly planSha256: string;
  readonly intentSha256: string;
  readonly bindingSha256: string;
  readonly selectedActuator: ActuatorKind;
}

export interface ActuationReceipt extends Readonly<Record<string, unknown>> {
  readonly protocol: "pyproc.actuation";
  readonly version: 1;
  readonly actuationRef: string;
  readonly intentSha256: string;
  readonly bindingSha256: string;
  readonly planSha256: string;
  readonly terminal: ActuationTerminal;
  readonly receiptSha256: string;
  readonly actionEvidenceRef: string | null;
}

export interface ActuationEpisode extends Readonly<Record<string, unknown>> {
  readonly protocol: "pyproc.actuationEpisode";
  readonly version: 1;
  readonly episodeRef: string;
  readonly episodeSha256: string;
  readonly receiptSha256: string;
}

export interface ActuationPolicyRevision extends Readonly<Record<string, unknown>> {
  readonly protocol: "pyproc.actuationPolicy";
  readonly version: 1;
  readonly previousSha256: string | null;
  readonly policy: Readonly<Record<string, unknown>>;
  readonly policySha256: string;
}

export interface MotorExecuteInput extends Readonly<Record<string, unknown>> {
  readonly sessionRef: ControlSessionRef;
  readonly situation: Readonly<Record<string, unknown>>;
  readonly requirementRef: string;
  readonly destinationRequirementRef?: string;
  readonly applicationId?: string;
  readonly nativePostcondition?: Readonly<{ readonly name: string; readonly controlType: string }>;
  readonly intent: ActuationIntentInput;
}

export interface MotorExecuteOutput extends Readonly<Record<string, unknown>> {
  readonly receipt: ActuationReceipt;
  readonly episode: ActuationEpisode;
  readonly terminal: ActuationTerminal;
}

export interface MotorTaskCleanup {
  readonly protocol: "pyproc.motorTaskCleanup";
  readonly version: 1;
  readonly state: "complete" | "incomplete";
  readonly effectRetried: false;
  readonly targetOwnership: "owned" | "borrowed";
  readonly artifactsRetained: number;
  readonly failures: readonly Readonly<{ readonly phase: string; readonly code: string }>[];
}

export interface MotorAmbiguityDiagnostic {
  readonly protocol: "pyproc.motorAmbiguityDiagnostic";
  readonly version: 1;
  readonly requirementRef: string;
  readonly state: "unique" | "ambiguous" | "incomplete";
  readonly matched: number;
  readonly canExecute: boolean;
  readonly requiredCallerRefinement: readonly Readonly<{
    readonly predicate: string;
    readonly operator: string;
  }>[];
}

export interface CheckpointSaveOutput {
  readonly index: number;
  readonly changedPages: number;
  readonly kind: string;
}

export interface CheckpointRestoreOutput {
  readonly index: number;
  readonly pagesWritten: number;
  readonly rehashed: boolean;
}

export interface AutomationTargetOutput extends Readonly<Record<string, unknown>> {
  readonly targetRef: string;
}

export interface ArtifactDeleteOutput {
  readonly deleted: boolean;
}

export interface VerificationRepositoryIdentity {
  readonly commit: string;
  readonly treeSha256: `sha256:${string}`;
  readonly diffSha256: `sha256:${string}`;
  readonly untracked: boolean;
}

export interface VerificationMotorJourneyReference {
  readonly receiptSha256: string;
  readonly scenarioId: string;
  readonly checkpointId: string;
}

export interface VerificationOutput extends Readonly<Record<string, unknown>> {
  readonly verdict: "verified" | "rejected" | "incomplete";
  readonly contentSha256: string;
}

export interface ControlRequestOptions {
  readonly requestId?: string;
  readonly spaceId?: string;
  readonly timeoutMs?: number;
  readonly cancelSettleTimeoutMs?: number;
}

export interface ControlProcessOptions {
  readonly command?: string | readonly string[];
  readonly cwd?: string;
  readonly env?: Readonly<Record<string, string | undefined>>;
  readonly startupTimeoutMs?: number;
  readonly shutdownTimeoutMs?: number;
  readonly cancelSettleTimeoutMs?: number;
  readonly maxAttachmentChunkBytes?: number;
  readonly peer?: Readonly<{ name: string; version: string }>;
}

export class ControlRemoteError extends Error {
  private constructor();
  readonly code: string;
  readonly retryable: boolean;
  readonly outcome: ControlOutcome;
  readonly terminal: "partial" | "rejected" | "outcomeUnknown" | "cancelled";
  readonly details?: unknown;
}

export class ControlRequest<Output = unknown> {
  private constructor();
  readonly requestId: string;
  readonly result: Promise<ControlResult<Output>>;
  cancel(reason?: string): Promise<boolean>;
  wait(options?: Readonly<{ timeoutMs?: number; cancelSettleTimeoutMs?: number }>): Promise<ControlResult<Output>>;
}

export class FileExecutionMemoryStore {
  private constructor();
  static open(root: string): Promise<FileExecutionMemoryStore>;
  readonly root: string;
  readHead(executionSessionId: string): Promise<string | null>;
  listSessionIds(): Promise<readonly string[]>;
  listObjectDigests(): Promise<readonly string[]>;
}

export class ExecutionMemoryArtifacts {
  readonly store: FileExecutionMemoryStore;
  captureMachineImage(options: Readonly<{
    bytes: Uint8Array | ArrayBuffer;
    machineId: string;
    lifecycle?: "portable" | "cold";
    coldReceipt?: Readonly<{
      machineId: string;
      state: "cold";
      terminal: "suspended";
      generationId: `sha256:${string}`;
      environmentFingerprint: string;
      cleanupPending?: false;
    }>;
  }>): Promise<ExecutionMemoryMachineLink>;
  captureSituation(capsule: Readonly<Record<string, unknown>>): Promise<Readonly<{
    situationRef: string;
    situationSha256: string;
  }>>;
  captureRecording(options: Readonly<{
    file: string;
    recordingId: string;
    cursor?: number;
    prefixSha256?: string;
    finalSha256: string;
  }>): Promise<Readonly<{
    recordingId: string;
    cursor: number;
    prefixSha256: string;
    finalSha256: string;
  }>>;
  captureEvidence(packDir: string): Promise<ExecutionMemoryEvidenceLink>;
  capturePermissions(manifest: Readonly<Record<string, unknown>>): Promise<ExecutionMemoryPermissionLink>;
}

export class ExecutionMemoryRegistry {
  private constructor();
  static open(options: Readonly<{ root: string; secretValues?: readonly string[] }>):
    Promise<ExecutionMemoryRegistry>;
  readonly store: FileExecutionMemoryStore;
  readonly artifacts: ExecutionMemoryArtifacts;
  createSession(options: Readonly<{
    executionSessionId: string;
    project: ExecutionMemoryProject;
    machine: ExecutionMemoryMachineLink;
    permissions: ExecutionMemoryPermissionLink;
    browser?: ExecutionMemoryStoredBrowserBoundary | null;
    source?: string;
  }>): Promise<ExecutionMemoryRevision>;
  checkpointSession(executionSessionId: string, expectedRevisionSha256: string, options?: Readonly<{
    project?: ExecutionMemoryProject;
    machine?: ExecutionMemoryMachineLink;
    work?: ExecutionMemoryWork;
    browser?: ExecutionMemoryStoredBrowserBoundary | null;
    evidence?: ExecutionMemoryEvidenceLink | null;
    permissions?: ExecutionMemoryPermissionLink;
    source?: string;
  }>): Promise<ExecutionMemoryRevision>;
  completeSession(executionSessionId: string, expectedRevisionSha256: string, options: Readonly<{
    machine: ExecutionMemoryMachineLink;
    evidence: ExecutionMemoryEvidenceLink;
    source?: string;
  }>): Promise<ExecutionMemoryRevision>;
  openSession(executionSessionId: string): Promise<ExecutionMemoryRevision>;
  listSessions(): Promise<readonly Readonly<Record<string, unknown>>[]>;
  inspectSession(executionSessionId: string): Promise<Readonly<Record<string, unknown>>>;
  retentionPlan(): Promise<Readonly<{
    reachable: readonly string[];
    orphaned: readonly string[];
    artifacts: Readonly<Record<string, Readonly<{
      reachable: readonly string[];
      orphaned: readonly string[];
    }>>>;
  }>>;
  exportHandoff(executionSessionId: string, outputPath: string): Promise<Readonly<Record<string, unknown>>>;
  importHandoff(handoffDir: string, options: Readonly<{
    trustedPublicKeyFile: string;
    approvedPermissionManifestSha256: string;
  }>): Promise<ExecutionMemoryRevision>;
}

export function createExecutionMemoryRegistry(options: Readonly<{
  root: string;
  secretValues?: readonly string[];
}>): Promise<ExecutionMemoryRegistry>;

export class FileEffectTransactionStore {
  private constructor();
  static open(root: string, options: Readonly<{
    approvalAuthorities: readonly Readonly<{ authorityId: string; publicKey: string | Uint8Array }>[];
    secretBindings?: Readonly<Record<string, string>>;
  }>): Promise<FileEffectTransactionStore>;
  readonly root: string;
  readonly trustDomainSha256: string;
  inspectTrustDomain(): Readonly<Record<string, unknown>>;
}

export class EffectTransactionRegistry {
  private constructor();
  static open(options: Readonly<{
    root: string;
    approvalAuthorities: readonly Readonly<{ authorityId: string; publicKey: string | Uint8Array }>[];
    secretBindings?: Readonly<Record<string, string>>;
  }>): Promise<EffectTransactionRegistry>;
  readonly store: FileEffectTransactionStore;
  inspectTrustDomain(): Readonly<Record<string, unknown>>;
  prepareTransaction(input: Readonly<{
    transactionId: string;
    intentId: string;
    destination: EffectDestination;
    effectTemplate: EffectTemplate;
    expectedTransition: Readonly<Record<string, unknown>>;
    environmentSha256: string;
    executionSessionId: string;
    sessionRevisionSha256: string;
    source?: string;
  }>): Promise<EffectTransactionRevision>;
  bindPendingSession(transactionId: string, expectedRevisionSha256: string,
    pendingSha256: string, source?: string): Promise<EffectTransactionRevision>;
  addRehearsal(transactionId: string, expectedRevisionSha256: string,
    input: Readonly<Record<string, unknown>>, source?: string): Promise<EffectTransactionRevision>;
  approveTransaction(transactionId: string, expectedRevisionSha256: string,
    grant: ApprovalGrant, source?: string): Promise<EffectTransactionRevision>;
  reserveCommit(transactionId: string, expectedRevisionSha256: string,
    before: Readonly<Record<string, unknown>>, source?: string): Promise<EffectTransactionRevision>;
  recordEffectResult(transactionId: string, expectedRevisionSha256: string,
    result: Readonly<Record<string, unknown>>, source?: string): Promise<EffectTransactionRevision>;
  bindTerminalSession(transactionId: string, expectedRevisionSha256: string,
    terminalSha256: string, source?: string): Promise<EffectTransactionRevision>;
  sealTransaction(transactionId: string, expectedRevisionSha256: string,
    evidence: ExecutionMemoryEvidenceLink, source?: string): Promise<EffectTransactionRevision>;
  openTransaction(transactionId: string): Promise<EffectTransactionRevision>;
  listTransactions(): Promise<readonly Readonly<Record<string, unknown>>[]>;
}

export function createEffectTransactionRegistry(options: Readonly<{
  root: string;
  approvalAuthorities: readonly Readonly<{ authorityId: string; publicKey: string | Uint8Array }>[];
  secretBindings?: Readonly<Record<string, string>>;
}>): Promise<EffectTransactionRegistry>;

export function createApprovalGrant(input: Readonly<{
  intent: Readonly<Record<string, unknown>>;
  authorityId: string;
  trustDomainSha256: string;
  expiresAt: string;
  nonce: string;
  policyVersion: string;
}>, privateKey: string | Uint8Array): ApprovalGrant;

export function verifyApprovalGrant(grant: ApprovalGrant, intent: Readonly<Record<string, unknown>>,
  options: Readonly<Record<string, unknown>>): ApprovalGrant;

export class FileAppSpaceStore {
  private constructor();
  static open(root: string): Promise<FileAppSpaceStore>;
  readonly root: string;
  publishCandidate(pair: AppPairedGeneration, expectedMarker?: string | null): Promise<AppPairedGeneration>;
  readPair(pairId: string): Promise<AppPairedGeneration | null>;
  readDigest(digest: string): Promise<AppPairedGeneration>;
  activeDigest(appId: string): Promise<string | null>;
  adopt(appId: string, expectedDigest: string | null, nextDigest: string): Promise<AppPairedGeneration>;
  moveActive(appId: string, expectedDigest: string | null,
    nextDigest: string | null): Promise<AppPairedGeneration | null>;
  active(appId: string): Promise<AppPairedGeneration | null>;
  listPairs(): Promise<readonly AppPairedGeneration[]>;
}

export class AppSpaceRegistry {
  private constructor();
  static open(options: Readonly<{ root: string; secretValues?: readonly string[];
    maxStateBytes?: number }>): Promise<AppSpaceRegistry>;
  readonly store: FileAppSpaceStore;
  snapshot(value: Readonly<Record<string, unknown>>): AppStateSnapshot;
  createCandidate(input: Readonly<{ pairId: string; parentPairSha256: string | null;
    snapshot: AppStateSnapshot; machine: AppPairedGeneration["machine"];
    session: AppPairedGeneration["session"]; source?: string }>): Promise<AppPairedGeneration>;
  adopt(pairId: string, expectedActivePairSha256: string | null): Promise<AppPairedGeneration>;
  openPair(pairId: string): Promise<AppPairedGeneration>;
  active(appId: string): Promise<AppPairedGeneration | null>;
  list(): Promise<readonly Readonly<Record<string, unknown>>[]>;
  createAppRef(): string;
}

export function createAppSpaceRegistry(options: Readonly<{ root: string;
  secretValues?: readonly string[]; maxStateBytes?: number }>): Promise<AppSpaceRegistry>;

export class FileReplayGraphStore {
  private constructor();
  static open(root: string): Promise<FileReplayGraphStore>;
  readonly root: string;
  publish(graph: ReplayGraphRevision, expectedRootSha256: string | null,
    artifactBytes?: ReadonlyMap<string, Uint8Array>): Promise<ReplayGraphRevision>;
  readRoot(rootSha256: string): Promise<ReplayGraphRevision>;
  head(graphId: string): Promise<ReplayGraphRevision | null>;
  list(): Promise<readonly Readonly<Record<string, unknown>>[]>;
}

export class ReplayGraphRegistry {
  private constructor();
  static open(options: Readonly<{ root: string; importRoots?: readonly string[] }>): Promise<ReplayGraphRegistry>;
  importRecording(input: Readonly<{ graphId: string; recordingFile: string }>): Promise<Readonly<{
    graph: ReplayGraphRevision; source: Readonly<Record<string, unknown>> }>>;
  open(graphId: string, rootSha256?: string | null): Promise<ReplayGraphRevision>;
  list(): Promise<readonly Readonly<Record<string, unknown>>[]>;
}

export function createReplayGraphRegistry(options: Readonly<{
  root: string; importRoots?: readonly string[] }>): Promise<ReplayGraphRegistry>;

export class ReplayWorld {
  constructor(graph: ReplayGraphRevision, options?: Readonly<{ worldRef?: string; startNodeRef?: string | null }>);
  readonly worldRef: string;
  inspect(): Readonly<Record<string, unknown>>;
  listEdges(): readonly Readonly<Record<string, unknown>>[];
  traverse(capabilityRef: string, expectedNodeRef: string): Readonly<Record<string, unknown>>;
  checkpoint(): ReplayWorldCheckpoint;
  restore(checkpoint: ReplayWorldCheckpoint): ReplayWorldCheckpoint;
  coverage(): Readonly<Record<string, unknown>>;
}

export function evaluateReplayGraph(graph: ReplayGraphRevision, contract: Readonly<Record<string, unknown>>,
  edgeRefs: readonly string[]): Readonly<Record<string, unknown>>;
export function inspectReplayGraphCoverage(graph: ReplayGraphRevision): Readonly<Record<string, unknown>>;
export function retainedReplayGraphObjects(graph: ReplayGraphRevision,
  pinnedNodeRefs?: readonly string[]): Readonly<Record<string, unknown>>;

export const ACTUATION_ERROR_CODES: Readonly<Record<string, string>>;
export const ACTUATION_INTENTS: readonly ActuationIntentKind[];
export const ACTUATION_TERMINALS: readonly ActuationTerminal[];
export const ACTUATOR_KINDS: readonly ActuatorKind[];
export function canonicalActuationJson(value: unknown): string;
export function actuationDigest(value: unknown): string;
export function createActuationIntent(input: ActuationIntentInput): ActuationIntent;
export function assertActuationIntent(value: ActuationIntent): ActuationIntent;
export function createTargetBinding(input: Readonly<Record<string, unknown>>): TargetBinding;
export function assertTargetBinding(value: TargetBinding): TargetBinding;
export function createActuationPlan(input: Readonly<Record<string, unknown>>): ActuationPlan;
export function assertActuationPlan(value: ActuationPlan): ActuationPlan;
export function createActuationReceipt(input: Readonly<Record<string, unknown>>): ActuationReceipt;
export function assertActuationReceipt(value: ActuationReceipt): ActuationReceipt;
export function createActuationEpisode(input: Readonly<Record<string, unknown>>): ActuationEpisode;
export function assertActuationEpisode(value: ActuationEpisode): ActuationEpisode;
export function createPolicyRevision(input: Readonly<Record<string, unknown>>): ActuationPolicyRevision;
export function assertPolicyRevision(value: ActuationPolicyRevision): ActuationPolicyRevision;
export function evaluateCorrection(input: Readonly<Record<string, unknown>>): Readonly<Record<string, unknown>>;

export class FileActuationStore {
  private constructor();
  static open(root: string): Promise<FileActuationStore>;
  policy(): Promise<ActuationPolicyRevision>;
  receipt(receiptSha256: string): Promise<ActuationReceipt>;
  episode(episodeSha256: string): Promise<ActuationEpisode>;
  list(): Promise<readonly Readonly<Record<string, unknown>>[]>;
}

export class ActuationCoordinator {
  private constructor();
  static open(options: Readonly<Record<string, unknown>>): Promise<ActuationCoordinator>;
  execute(input: MotorExecuteInput, context?: Readonly<Record<string, unknown>>): Promise<MotorExecuteOutput>;
  inspect(): Promise<Readonly<Record<string, unknown>>>;
  list(): Promise<readonly Readonly<Record<string, unknown>>[]>;
  replay(input: Readonly<Record<string, unknown>>): Promise<Readonly<Record<string, unknown>>>;
  evaluate(input: Readonly<Record<string, unknown>>): Readonly<Record<string, unknown>>;
  promote(input: Readonly<Record<string, unknown>>): Promise<Readonly<Record<string, unknown>>>;
  rollback(input: Readonly<Record<string, unknown>>): Promise<ActuationPolicyRevision>;
}

export class ControlLease {
  constructor(scope: Readonly<Record<string, unknown>>, options?: Readonly<Record<string, unknown>>);
  readonly leaseRef: string;
  activate(live: Readonly<Record<string, unknown>>): Readonly<Record<string, unknown>>;
  assert(segmentScope: Readonly<Record<string, unknown>>): Readonly<Record<string, unknown>>;
  suspend(reason?: string): Readonly<Record<string, unknown>>;
  userInput(): Readonly<Record<string, unknown>>;
  inspect(): Readonly<Record<string, unknown>>;
}

export type ControlSessionRef = Readonly<Record<string, unknown>>;

export interface SemanticInventoryReceipt {
  readonly protocol: "pyproc.semanticInventory";
  readonly version: 1;
  readonly inventoryRef: string;
  readonly snapshotRef: string;
  readonly documentEpoch: unknown;
  readonly ordering: "provider";
  readonly offset: number;
  readonly returned: number;
  readonly nextOffset: number;
  readonly total: number;
  readonly byteLength: number;
  readonly complete: boolean;
  readonly pageSha256: string;
  readonly prefixSha256: string;
  readonly nodesSha256: string;
  readonly bindingSha256: string;
  readonly evidenceSha256: string;
  readonly receiptSha256: string;
  readonly binding: Readonly<Record<string, unknown>>;
  readonly evidence: Readonly<Record<string, unknown>>;
  readonly continuationExpiresAt: string | null;
}

export interface SemanticInventoryObservation {
  readonly nodes: readonly Readonly<Record<string, unknown>>[];
  readonly continuationRef: string | null;
  readonly inventory: SemanticInventoryReceipt;
  readonly truncated: boolean;
  readonly [key: string]: unknown;
}

export type SemanticInventoryObserveOptions = Readonly<{
  expectedRisk: "read";
  mode?: "all" | "interactive";
  maxNodes?: number;
  includeScreenshot?: boolean;
  includeConsole?: boolean;
  includeNetwork?: boolean;
  maxEvents?: number;
  continuationRef?: never;
}> | Readonly<{
  expectedRisk: "read";
  continuationRef: string;
  mode?: never;
  maxNodes?: never;
  includeScreenshot?: never;
  includeConsole?: never;
  includeNetwork?: never;
  maxEvents?: never;
}>;

export class PerceptionEntity {
  private constructor();
  readonly value: Readonly<Record<string, unknown>>;
  readonly entityRef: string;
  readonly locatorRef: string | null;
  readonly kind: string;
  readonly role: string;
  readonly name: string;
  readonly actionable: boolean;
}

export class PerceptionQueryResult {
  private constructor();
  readonly result: ControlResult<Readonly<Record<string, unknown>>>;
  readonly observation: Readonly<Record<string, unknown>>;
  readonly matches: readonly PerceptionEntity[];
  one(): PerceptionEntity;
}

export class SituationFact {
  private constructor();
  readonly value: Readonly<Record<string, unknown>>;
  readonly claimRef: string;
  readonly subjectRef: string;
  readonly predicate: string;
  readonly state: string;
}

export class SituationAffordance {
  private constructor();
  readonly value: Readonly<Record<string, unknown>>;
  readonly kind: string;
  readonly action: string;
  readonly entityRef: string | null;
  readonly locatorRef: string | null;
  readonly capabilityRef: string | null;
  readonly risk: string | null;
}

export class SituationUnknown {
  private constructor();
  readonly value: Readonly<Record<string, unknown>>;
  readonly unknownRef: string;
  readonly requirementRef: string;
  readonly reason: string;
}

export class SituationRequirement {
  private constructor();
  readonly value: Readonly<Record<string, unknown>>;
  readonly requirementRef: string;
  readonly state: string;
  readonly facts: readonly SituationFact[];
  readonly affordances: readonly SituationAffordance[];
  readonly unknowns: readonly SituationUnknown[];
  oneAffordance(action: string): SituationAffordance;
}

export class SituationResult {
  private constructor();
  readonly result: ControlResult<Readonly<Record<string, unknown>>>;
  readonly situation: Readonly<Record<string, unknown>>;
  readonly situationRef: string;
  readonly worldRef: string;
  readonly facts: readonly SituationFact[];
  readonly affordances: readonly SituationAffordance[];
  readonly unknowns: readonly SituationUnknown[];
  readonly requirements: readonly SituationRequirement[];
  requirement(requirementRef: string): SituationRequirement;
}

export interface SituationFocus {
  readonly objective?: string;
  readonly requirements: readonly Readonly<{
    requirementRef: string;
    select: Readonly<Record<string, unknown>>;
    need: readonly ("fact" | "affordance" | "change")[];
    cardinality?: "one" | "oneOrMore" | "zeroOrMore";
  }>[];
  readonly changedSince?: string;
  readonly freshness?: Readonly<{ mode: "live" | "recorded"; maxAgeMs: number }>;
}

export interface SituationOptions {
  readonly sessionRef?: ControlSessionRef;
  readonly channels?: readonly string[];
  readonly visual?: Readonly<Record<string, unknown>>;
  readonly budget?: Readonly<Record<string, unknown>>;
  readonly profile?: readonly string[];
}

export interface PerceptionObserveOptions {
  readonly sessionRef?: ControlSessionRef;
  readonly since?: string;
  readonly channels?: readonly string[];
  readonly visual?: Readonly<Record<string, unknown>>;
  readonly budget?: Readonly<Record<string, unknown>>;
  readonly query?: Readonly<Record<string, unknown>>;
  readonly profile?: readonly string[];
}

export interface PerceptionQueryOptions extends Omit<PerceptionObserveOptions, "query" | "visual"> {
  readonly entityRef?: string;
  readonly kind?: string;
  readonly role?: string;
  readonly name?: string | Readonly<Record<string, string>>;
  readonly state?: Readonly<Record<string, unknown>>;
  readonly actionable?: boolean;
  readonly changedSince?: string;
}

export class PerceptionClient {
  private constructor();
  readonly sessionRef: ControlSessionRef | null;
  bind(sessionRef: ControlSessionRef): PerceptionClient;
  observe(options?: PerceptionObserveOptions, requestOptions?: ControlRequestOptions):
    Promise<ControlResult<Readonly<Record<string, unknown>>>>;
  query(query?: PerceptionQueryOptions, requestOptions?: ControlRequestOptions): Promise<PerceptionQueryResult>;
  situate(focus: SituationFocus, options?: SituationOptions,
    requestOptions?: ControlRequestOptions): Promise<SituationResult>;
  act(kind: string, locatorRef: string, options?: Readonly<Record<string, unknown>>,
    requestOptions?: ControlRequestOptions): Promise<ControlResult>;
  actAffordance(affordance: SituationAffordance | Readonly<Record<string, unknown>>,
    options?: Readonly<Record<string, unknown>>, requestOptions?: ControlRequestOptions): Promise<ControlResult>;
  explainActionability(entityRef: string, options?: Readonly<{ sessionRef?: ControlSessionRef } & ControlRequestOptions>):
    Promise<PerceptionEntity>;
  whatChanged(since: string, options?: PerceptionObserveOptions,
    requestOptions?: ControlRequestOptions): Promise<ControlResult<Readonly<Record<string, unknown>>>>;
}

export class MotorTaskSession {
  private constructor();
  static open(client: PyProcControlClient, input: Readonly<{
    readonly url?: string;
    readonly targetRef?: string;
    readonly expectedRisk?: "externalEffect";
    readonly waitUntil?: "commit" | "domcontentloaded" | "load";
    readonly retainArtifacts?: boolean;
  }>, requestOptions?: ControlRequestOptions): Promise<MotorTaskSession>;
  readonly targetRef: string;
  readonly sessionRef: ControlSessionRef;
  readonly ownedTarget: boolean;
  situate(focus: SituationFocus, options?: SituationOptions,
    requestOptions?: ControlRequestOptions): Promise<SituationResult>;
  diagnoseAmbiguity(situation: SituationResult | Readonly<Record<string, unknown>>,
    requirementRef: string): MotorAmbiguityDiagnostic;
  execute(input: Omit<MotorExecuteInput, "sessionRef" | "situation"> & Readonly<{
    readonly situation: SituationResult | Readonly<Record<string, unknown>>;
  }>, requestOptions?: ControlRequestOptions): Promise<ControlResult<MotorExecuteOutput>>;
  retainArtifact(artifactRef: string): Readonly<{ readonly artifactRef: string; readonly retained: true }>;
  close(requestOptions?: ControlRequestOptions): Promise<MotorTaskCleanup>;
}

export class PyProcControlClient {
  private constructor();
  static start(configPath: string, options?: ControlProcessOptions): Promise<PyProcControlClient>;
  static check(configPath: string, options?: ControlProcessOptions & { readonly timeoutMs?: number }):
    Promise<Readonly<Record<string, unknown>>>;
  static doctor(configPath: string, options?: ControlProcessOptions & { readonly timeoutMs?: number }):
    Promise<MachineDoctorReport>;
  readonly ready: Promise<this>;
  readonly operations: readonly string[];
  readonly diagnostics: string;
  readonly cancelSettleTimeoutMs: number;
  requestAsync<Output = unknown>(operation: string, input?: Readonly<Record<string, unknown>>,
    options?: ControlRequestOptions): ControlRequest<Output>;
  request<Output = unknown>(operation: string, input?: Readonly<Record<string, unknown>>,
    options?: ControlRequestOptions): Promise<ControlResult<Output>>;
  cancel(requestId: string, reason?: string): Promise<boolean>;
  runPython(code: string, options?: ControlRequestOptions): Promise<ControlResult<MachineRunOutput>>;
  exportMachineImage(options?: ControlRequestOptions): Promise<ControlResult<MachineImageOutput>>;
  saveCheckpoint(options?: ControlRequestOptions): Promise<ControlResult<CheckpointSaveOutput>>;
  restoreCheckpoint(index?: number, options?: ControlRequestOptions): Promise<ControlResult<CheckpointRestoreOutput>>;
  reset(options?: ControlRequestOptions): Promise<ControlResult<CheckpointRestoreOutput>>;
  inspectSpace(options?: ControlRequestOptions): Promise<ControlResult>;
  listTargets(options?: ControlRequestOptions): Promise<ControlResult>;
  openTarget(url: string, options: ControlRequestOptions & { readonly expectedRisk: string; readonly waitUntil?: string }):
    Promise<ControlResult<AutomationTargetOutput>>;
  closeTarget(targetRef: string,
    options?: ControlRequestOptions & { readonly expectedRisk?: "externalEffect" }):
    Promise<ControlResult<Readonly<{ readonly closed: boolean; readonly targetRef: string }>>>;
  attachSession(targetRef: string, options?: ControlRequestOptions): Promise<ControlResult<ControlSessionRef>>;
  observe(sessionRef: ControlSessionRef, observation: SemanticInventoryObserveOptions,
    options?: ControlRequestOptions): Promise<ControlResult<SemanticInventoryObservation | Readonly<{
      readonly result: SemanticInventoryObservation;
      readonly [key: string]: unknown;
    }>>>;
  observe(sessionRef: ControlSessionRef, observation?: Readonly<Record<string, unknown>>,
    options?: ControlRequestOptions): Promise<ControlResult<Readonly<Record<string, unknown>>>>;
  act(sessionRef: ControlSessionRef, actions: readonly Readonly<Record<string, unknown>>[],
    options?: ControlRequestOptions): Promise<ControlResult>;
  command(sessionRef: ControlSessionRef, method: string, params: Readonly<Record<string, unknown>>,
    options: ControlRequestOptions & { readonly expectedRisk: string }): Promise<ControlResult>;
  detachSession(sessionRef: ControlSessionRef, options?: ControlRequestOptions): Promise<ControlResult>;
  readArtifact(artifactRef: string, options?: ControlRequestOptions & { readonly offset?: number; readonly maxBytes?: number }):
    Promise<ControlResult>;
  deleteArtifact(artifactRef: string, options?: ControlRequestOptions): Promise<ControlResult<ArtifactDeleteOutput>>;
  auditExperience(contractRoot: string, options: ControlRequestOptions & Readonly<{
    repositoryRoot: string;
    outputDir: string;
    environmentId: string;
    repository: VerificationRepositoryIdentity;
    motorJourneys?: readonly VerificationMotorJourneyReference[];
  }>): Promise<ControlResult<VerificationOutput>>;
  verifyExperience(referenceDir: string, currentDir: string,
    options?: ControlRequestOptions): Promise<ControlResult<VerificationOutput>>;
  replayEvidencePack(packDir: string,
    options?: ControlRequestOptions): Promise<ControlResult<VerificationOutput>>;
  createExecutionSession(executionSessionId: string, project: ExecutionMemoryProject,
    options?: ControlRequestOptions & Readonly<{
      machineId?: string;
      browser?: ExecutionMemoryBrowserBoundary;
    }>): Promise<ControlResult<ExecutionMemoryRevision>>;
  checkpointExecutionSession(executionSessionId: string, expectedRevisionSha256: string,
    work: ExecutionMemoryWork, options?: ControlRequestOptions & Readonly<{
      browser?: ExecutionMemoryBrowserBoundary;
    }>): Promise<ControlResult<ExecutionMemoryRevision>>;
  completeExecutionSession(executionSessionId: string, expectedRevisionSha256: string,
    evidencePackDir: string, options?: ControlRequestOptions): Promise<ControlResult<ExecutionMemoryRevision>>;
  openExecutionSession(executionSessionId: string,
    options?: ControlRequestOptions): Promise<ControlResult<ExecutionMemoryRevision>>;
  listExecutionSessions(options?: ControlRequestOptions): Promise<ControlResult<readonly Readonly<Record<string, unknown>>[]>>;
  inspectExecutionSession(executionSessionId: string,
    options?: ControlRequestOptions): Promise<ControlResult<Readonly<Record<string, unknown>>>>;
  exportExecutionHandoff(executionSessionId: string, outputPath: string,
    options?: ControlRequestOptions): Promise<ControlResult<Readonly<Record<string, unknown>>>>;
  importExecutionHandoff(handoffDir: string, options: ControlRequestOptions & Readonly<{
    trustedPublicKeyFile: string;
    approvedPermissionManifestSha256: string;
  }>): Promise<ControlResult<ExecutionMemoryRevision>>;
  prepareEffectTransaction(input: Readonly<{
    transactionId: string;
    intentId: string;
    executionSessionId: string;
    expectedSessionRevisionSha256: string;
    destination: EffectDestination;
    effectTemplate: EffectTemplate;
    expectedTransition: Readonly<Record<string, unknown>>;
  }>, options?: ControlRequestOptions): Promise<ControlResult<Readonly<{
    transaction: EffectTransactionRevision;
    trustDomain: Readonly<Record<string, unknown>>;
    executionSession: ExecutionMemoryRevision;
  }>>>;
  rehearseEffectTransaction(transactionId: string, expectedRevisionSha256: string,
    rehearsal: Readonly<{ mode: "computed" | "provider"; code?: string; expectedValue?: string | null;
      branch?: string }>, options?: ControlRequestOptions): Promise<ControlResult<EffectTransactionRevision>>;
  approveEffectTransaction(transactionId: string, expectedRevisionSha256: string,
    grant: ApprovalGrant, options?: ControlRequestOptions): Promise<ControlResult<EffectTransactionRevision>>;
  commitEffectTransaction(transactionId: string, expectedRevisionSha256: string,
    options?: ControlRequestOptions): Promise<ControlResult<EffectTransactionRevision>>;
  inspectEffectTransaction(transactionId: string,
    options?: ControlRequestOptions): Promise<ControlResult<Readonly<Record<string, unknown>>>>;
  listEffectTransactions(options?: ControlRequestOptions):
    Promise<ControlResult<readonly Readonly<Record<string, unknown>>[]>>;
  sealEffectTransaction(transactionId: string, expectedRevisionSha256: string, evidencePackDir: string,
    options?: ControlRequestOptions): Promise<ControlResult<EffectTransactionRevision>>;
  attachApp(sessionRef: ControlSessionRef,
    options?: ControlRequestOptions): Promise<ControlResult<Readonly<{ readonly appRef: string;
      readonly identity: AppSpaceIdentity; readonly revision: string;
      readonly capabilities: readonly string[]; readonly isolation: "credentialless-opaque-frame" }>>>;
  checkpointApp(input: AppPairCaptureInput,
    options?: ControlRequestOptions): Promise<ControlResult<Readonly<{ readonly pair: AppPairedGeneration;
      readonly active: boolean }>>>;
  branchApp(input: AppPairCaptureInput & Readonly<{ readonly parentPairId: string }>,
    options?: ControlRequestOptions): Promise<ControlResult<Readonly<{ readonly pair: AppPairedGeneration;
      readonly active: boolean }>>>;
  restoreApp(appRef: string, pairId: string,
    options?: ControlRequestOptions): Promise<ControlResult<Readonly<{ readonly pair: AppPairedGeneration;
      readonly restored: Readonly<Record<string, unknown>>;
      readonly restoreProof: Readonly<{ readonly restoreRef: string; readonly pairSha256: string }>;
      readonly activeChanged: false }>>>;
  adoptApp(appRef: string, pairId: string, expectedActivePairSha256: string | null,
    options?: ControlRequestOptions): Promise<ControlResult<Readonly<{ readonly pair: AppPairedGeneration;
      readonly restored: Readonly<Record<string, unknown>>; readonly activeChanged: true }>>>;
  inspectApp(appRef: string,
    options?: ControlRequestOptions): Promise<ControlResult<Readonly<Record<string, unknown>>>>;
  listAppPairs(options?: ControlRequestOptions):
    Promise<ControlResult<readonly Readonly<Record<string, unknown>>[]>>;
  stageAppEffect(appRef: string, transactionId: string, expectedTransactionRevisionSha256: string,
    options?: ControlRequestOptions): Promise<ControlResult<Readonly<Record<string, unknown>>>>;
  finalizeAppEffect(appRef: string, transactionId: string, expectedTransactionRevisionSha256: string,
    options?: ControlRequestOptions): Promise<ControlResult<Readonly<Record<string, unknown>>>>;
  importReplayGraphRecording(graphId: string, recordingFile: string,
    options?: ControlRequestOptions): Promise<ControlResult<Readonly<{
      readonly graph: ReplayGraphRevision; readonly source: Readonly<Record<string, unknown>> }>>>;
  createReplayGraphAppWorld(graphId: string, pairId: string,
    options?: ControlRequestOptions): Promise<ControlResult<ReplayGraphRevision>>;
  captureReplayGraphAppBranch(input: Readonly<Record<string, unknown>>,
    options?: ControlRequestOptions): Promise<ControlResult<ReplayGraphRevision>>;
  openReplayWorld(graphId: string, rootSha256: string,
    options?: ControlRequestOptions & Readonly<{ startNodeRef?: string }>): Promise<ControlResult<Readonly<{
      readonly world: Readonly<Record<string, unknown>>; readonly node: ReplayGraphNode }>>>;
  inspectReplayWorld(worldRef: string,
    options?: ControlRequestOptions): Promise<ControlResult<Readonly<Record<string, unknown>>>>;
  listReplayWorldEdges(worldRef: string,
    options?: ControlRequestOptions): Promise<ControlResult<readonly Readonly<Record<string, unknown>>[]>>;
  traverseReplayWorld(worldRef: string, capabilityRef: string, expectedNodeRef: string,
    options?: ControlRequestOptions): Promise<ControlResult<Readonly<Record<string, unknown>>>>;
  checkpointReplayWorld(worldRef: string,
    options?: ControlRequestOptions): Promise<ControlResult<ReplayWorldCheckpoint>>;
  restoreReplayWorld(worldRef: string, checkpoint: ReplayWorldCheckpoint,
    options?: ControlRequestOptions): Promise<ControlResult<ReplayWorldCheckpoint>>;
  evaluateReplayWorld(graphId: string, rootSha256: string, contract: Readonly<Record<string, unknown>>,
    edgeRefs: readonly string[], options?: ControlRequestOptions): Promise<ControlResult<Readonly<Record<string, unknown>>>>;
  inspectReplayWorldCoverage(worldRef: string,
    options?: ControlRequestOptions): Promise<ControlResult<Readonly<Record<string, unknown>>>>;
  listReplayGraphs(options?: ControlRequestOptions):
    Promise<ControlResult<readonly Readonly<Record<string, unknown>>[]>>;
  executeMotor(input: MotorExecuteInput,
    options?: ControlRequestOptions): Promise<ControlResult<MotorExecuteOutput>>;
  acquireMotorControl(input: Readonly<{ readonly applicationId: string; readonly intent: ActuationIntentInput;
    readonly expiresInMs?: number }>,
    options?: ControlRequestOptions): Promise<ControlResult<Readonly<Record<string, unknown>>>>;
  revokeMotorControl(leaseRef: string,
    options?: ControlRequestOptions): Promise<ControlResult<Readonly<Record<string, unknown>>>>;
  inspectMotor(options?: ControlRequestOptions): Promise<ControlResult<Readonly<Record<string, unknown>>>>;
  listMotorRecords(options?: ControlRequestOptions):
    Promise<ControlResult<readonly Readonly<Record<string, unknown>>[]>>;
  replayMotor(receiptSha256: string, worldRef: string, expectedNodeRef: string,
    options?: ControlRequestOptions): Promise<ControlResult<Readonly<Record<string, unknown>>>>;
  evaluateMotorPolicy(input: Readonly<Record<string, unknown>>,
    options?: ControlRequestOptions): Promise<ControlResult<Readonly<Record<string, unknown>>>>;
  promoteMotorPolicy(input: Readonly<Record<string, unknown>>,
    options?: ControlRequestOptions): Promise<ControlResult<Readonly<Record<string, unknown>>>>;
  rollbackMotorPolicy(expectedPolicySha256: string,
    options?: ControlRequestOptions): Promise<ControlResult<ActuationPolicyRevision>>;
  openMotorTask(input: Readonly<{
    readonly url?: string;
    readonly targetRef?: string;
    readonly expectedRisk?: "externalEffect";
    readonly waitUntil?: "commit" | "domcontentloaded" | "load";
    readonly retainArtifacts?: boolean;
  }>, options?: ControlRequestOptions): Promise<MotorTaskSession>;
  perception(sessionRef?: ControlSessionRef | null): PerceptionClient;
  close(): Promise<void>;
}
