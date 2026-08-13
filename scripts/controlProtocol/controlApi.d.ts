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

export type ControlSessionRef = Readonly<Record<string, unknown>>;

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

export class PyProcControlClient {
  private constructor();
  static start(configPath: string, options?: ControlProcessOptions): Promise<PyProcControlClient>;
  static check(configPath: string, options?: ControlProcessOptions & { readonly timeoutMs?: number }):
    Promise<Readonly<Record<string, unknown>>>;
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
  attachSession(targetRef: string, options?: ControlRequestOptions): Promise<ControlResult<ControlSessionRef>>;
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
  perception(sessionRef?: ControlSessionRef | null): PerceptionClient;
  close(): Promise<void>;
}
