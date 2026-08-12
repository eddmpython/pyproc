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
  readonly output: Output;
  readonly outcome: "observed" | "applied";
  readonly attachments: readonly ControlAttachment[];
}

export interface MachineRunOutput {
  readonly stdout: string;
  readonly value: string | null;
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
  readonly details?: unknown;
}

export class ControlRequest<Output = unknown> {
  private constructor();
  readonly requestId: string;
  readonly result: Promise<ControlResult<Output>>;
  cancel(reason?: string): Promise<boolean>;
  wait(options?: Readonly<{ timeoutMs?: number; cancelSettleTimeoutMs?: number }>): Promise<ControlResult<Output>>;
}

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
  act(kind: string, locatorRef: string, options?: Readonly<Record<string, unknown>>,
    requestOptions?: ControlRequestOptions): Promise<ControlResult>;
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
  perception(sessionRef?: ControlSessionRef | null): PerceptionClient;
  close(): Promise<void>;
}
