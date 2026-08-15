// cpythonWasiKernel.js - Layer 0: worker-owned CPython WASI kernel runtime.
import { bootWasi } from "../engines/wasi/wasiSession.js";
import { parseSha256Address, sha256Address } from "../contentDigest.js";
import { PyProcError } from "../errors.js";
import { KernelCommandQueue } from "./kernelCommandQueue.js";
import { createKernelCommand, createKernelEvent } from "./kernelProtocol.js";
import { ApplicationReferenceTable } from "./applicationReference.js";
import {
  MemoryValueArtifactStore,
  VALUE_ENVELOPE_PROTOCOL,
  canonicalValueEnvelope,
  decodeValueEnvelope,
  digestValueEnvelope,
  encodeValueEnvelope,
} from "./valueEnvelope.js";
import {
  sealKernelCheckpoint,
  verifyKernelCheckpointDescriptor,
} from "./kernelCheckpoint.js";
import {
  KERNEL_RUNTIME_CONTRACT_VERSION,
  KERNEL_RUNTIME_KIND,
  assertKernelRuntimeContract,
  kernelError,
} from "./kernelRuntimeContract.js";

const META_KEYS = new Set([
  "commandId",
  "generation",
  "deadlineAt",
  "cancellationRef",
  "authorityRef",
  "expectedStateDigest",
]);

function requestObject(request) {
  if (request === undefined) return {};
  if (!request || typeof request !== "object" || Array.isArray(request)) {
    throw new PyProcError("PYPROC_INPUT_INVALID", "Kernel operation request must be an object");
  }
  return request;
}

function commandInput(request) {
  const input = {};
  for (const [key, value] of Object.entries(request)) if (!META_KEYS.has(key)) input[key] = value;
  return input;
}

export class CpythonWasiKernelRuntime {
  #session;
  #queue;
  #kernelRef;
  #generation = 0;
  #state = "ready";
  #commandCounter = 0;
  #stateVersion = 0;
  #eventSequences = new Map();
  #eventListeners = new Set();
  #checkpoints = new Map();
  #unsubscribeFailure = null;
  #admissionTail = Promise.resolve();
  #applications;
  #valueOptions;
  #checkpointArtifactStore;
  #activeCheckpointRef = null;
  #environmentId;
  #onEnvironmentChanged;
  #checkpointCoordinators;

  constructor(session, { kernelRef = "kernel:cpython-wasi:default", engineId = null,
    nativeProfile = "unidentified", threading = null, environmentId = null, artifactStore = null, valueLimits = undefined,
    checkpointCoordinator = null, kernelVfs = null, restoredCheckpoint = null,
    restoredCheckpoints = [], onEnvironmentChanged = null } = {}) {
    if (!session || typeof session.run !== "function" || typeof session.onFailure !== "function") {
      throw new PyProcError("PYPROC_INPUT_INVALID", "CpythonWasiKernelRuntime requires a worker-backed WasiSession");
    }
    this.#session = session;
    this.#kernelRef = kernelRef;
    this.engineId = engineId || "engine:unidentified";
    this.nativeProfile = nativeProfile;
    this.threading = threading;
    this.#environmentId = environmentId || `environment:unidentified:${this.engineId}`;
    if (onEnvironmentChanged !== null && typeof onEnvironmentChanged !== "function") {
      throw new PyProcError("PYPROC_INPUT_INVALID", "onEnvironmentChanged must be a function or null");
    }
    this.#onEnvironmentChanged = onEnvironmentChanged;
    this.#checkpointArtifactStore = artifactStore || new MemoryValueArtifactStore();
    this.#checkpointCoordinators = [...new Set([checkpointCoordinator, kernelVfs, session]
      .filter((candidate) => typeof candidate?.inspectCheckpointBoundary === "function"))];
    this.vfs = kernelVfs;
    this.#valueOptions = Object.freeze({ artifactStore: this.#checkpointArtifactStore,
      ...(valueLimits ? { limits: valueLimits } : {}) });
    this.#applications = new ApplicationReferenceTable({ kernelRef, generation: this.#generation });
    this.#queue = new KernelCommandQueue({
      kernelRef,
      generation: this.#generation,
      onState: (state) => {
        if (!["closed", "closing", "faulted", "terminated", "interrupting"].includes(this.#state)) this.#state = state;
      },
    });
    if (restoredCheckpoint) {
      if (!Number.isSafeInteger(session.bootstrapSnapshotIndex) || session.bootstrapSnapshotIndex < 0
        || restoredCheckpoint.engineId !== this.engineId
        || restoredCheckpoint.environmentId !== this.#environmentId) {
        throw new PyProcError("PYPROC_STATE_FENCE_STALE", "Restored checkpoint does not match the booted kernel");
      }
      for (const descriptor of restoredCheckpoints) {
        if (descriptor?.checkpointRef) this.#checkpoints.set(descriptor.checkpointRef,
          { descriptor, index: null });
      }
      this.#checkpoints.set(restoredCheckpoint.checkpointRef,
        { descriptor: restoredCheckpoint, index: session.bootstrapSnapshotIndex });
      this.#activeCheckpointRef = restoredCheckpoint.checkpointRef;
      this.#stateVersion = restoredCheckpoint.executionCursor;
    }
    this.#unsubscribeFailure = session.onFailure((error) => this.#fault(error));
  }

  get runtimeContractVersion() { return KERNEL_RUNTIME_CONTRACT_VERSION; }
  get kernelRef() { return this.#kernelRef; }
  get runtimeKind() { return KERNEL_RUNTIME_KIND; }

  async #stateDigest() {
    return sha256Address(`${this.#kernelRef}\n${this.#generation}\n${this.#stateVersion}\n${this.#environmentId}`);
  }

  #emit(command, type, payload) {
    const sequence = (this.#eventSequences.get(command.commandId) || 0) + 1;
    this.#eventSequences.set(command.commandId, sequence);
    const event = createKernelEvent(command, sequence, type, payload);
    for (const listener of this.#eventListeners) {
      try { listener(event); }
      catch (listenerError) { queueMicrotask(() => { throw listenerError; }); }
    }
    return event;
  }

  onEvent(listener) {
    if (typeof listener !== "function") throw new PyProcError("PYPROC_INPUT_INVALID", "Kernel event listener must be a function");
    this.#eventListeners.add(listener);
    return () => this.#eventListeners.delete(listener);
  }

  async #submit(operation, rawRequest, handler, canonicalOverride = null) {
    if (["closed", "closing", "faulted", "terminated"].includes(this.#state)) {
      throw new PyProcError("PYPROC_PROCESS_UNAVAILABLE", `Kernel is ${this.#state}`);
    }
    const request = requestObject(rawRequest);
    const previousAdmission = this.#admissionTail;
    let releaseAdmission;
    this.#admissionTail = new Promise((resolve) => { releaseAdmission = resolve; });
    await previousAdmission;
    let submitted;
    try {
      const command = await createKernelCommand({
        commandId: request.commandId || `${this.#kernelRef}:command:${++this.#commandCounter}`,
        kernelRef: this.#kernelRef,
        generation: request.generation ?? this.#generation,
        operation,
        input: canonicalOverride || commandInput(request),
        deadlineAt: request.deadlineAt,
        cancellationRef: request.cancellationRef,
        authorityRef: request.authorityRef,
        expectedStateDigest: request.expectedStateDigest,
      });
      submitted = this.#queue.submit(command, async (accepted) => {
        if (accepted.expectedStateDigest && accepted.expectedStateDigest !== await this.#stateDigest()) {
          throw new PyProcError("PYPROC_STATE_FENCE_STALE", "Kernel command expectedStateDigest is stale");
        }
        this.#emit(accepted, "commandStarted", { operation });
        const receipt = await handler(accepted, request);
        this.#emit(accepted, "commandCompleted", { operation, state: receipt.state || "completed" });
        return receipt;
      });
    } finally {
      releaseAdmission();
    }
    return submitted;
  }

  async describe() {
    return Object.freeze({
      protocol: "pyproc.kernel-descriptor",
      version: 1,
      runtimeContractVersion: KERNEL_RUNTIME_CONTRACT_VERSION,
      runtimeKind: KERNEL_RUNTIME_KIND,
      kernelRef: this.#kernelRef,
      generation: this.#generation,
      lifecycleState: this.#state,
      engineId: this.engineId,
      nativeProfile: this.nativeProfile,
      threading: this.threading,
      environmentId: this.#environmentId,
      workerOwned: true,
      directHeapAccess: false,
      liveObjectProxy: false,
      valueEnvelopeVersion: 1,
      applicationReferences: "generation-bound",
      vfsRootDigest: this.vfs?.rootDigest || null,
    });
  }

  async execute(request) {
    return this.#submit("execute", request, async (command, acceptedRequest) => {
      if (typeof acceptedRequest.code !== "string") throw new PyProcError("PYPROC_INPUT_INVALID", "execute.code must be a string");
      const beforeStateDigest = await this.#stateDigest();
      const startedAt = performance.now();
      try {
        const output = await this.#session.run(acceptedRequest.code, {
          authorityRef: command.authorityRef,
          commandId: command.commandId,
          kernelRef: command.kernelRef,
          generation: command.generation,
        });
        const stdout = [];
        for (const text of output ? output.split("\n") : []) {
          const event = this.#emit(command, "output", { stream: "stdout", text });
          stdout.push(Object.freeze({ sequence: event.sequence, stream: "stdout", text }));
        }
        this.#stateVersion += 1;
        return {
          protocol: "pyproc.execution-result",
          version: 1,
          executionRef: `${this.#kernelRef}:execution:${command.commandId}`,
          state: "completed",
          stdout,
          stderr: [],
          displayArtifacts: [],
          mutated: true,
          beforeStateDigest,
          afterStateDigest: await this.#stateDigest(),
          timing: { durationMs: Math.max(0, performance.now() - startedAt) },
        };
      } catch (error) {
        const terminal = ["faulted", "terminated"].includes(this.#state);
        return {
          protocol: "pyproc.execution-result",
          version: 1,
          executionRef: `${this.#kernelRef}:execution:${command.commandId}`,
          state: terminal ? "terminated" : "failed",
          stdout: [],
          stderr: [],
          displayArtifacts: [],
          mutated: false,
          beforeStateDigest,
          error: kernelError(error, "execute", terminal ? "newGeneration" : "never"),
          timing: { durationMs: Math.max(0, performance.now() - startedAt) },
        };
      }
    });
  }

  async getValue(request) {
    return this.#submit("getValue", request, async (command, acceptedRequest) => {
      if (typeof acceptedRequest.name !== "string" || !acceptedRequest.name) throw new PyProcError("PYPROC_INPUT_INVALID", "getValue.name is required");
      const value = typeof this.#session.getEnvelope === "function"
        ? canonicalValueEnvelope(await this.#session.getEnvelope(acceptedRequest.name), this.#valueOptions)
        : await encodeValueEnvelope(await this.#session.get(acceptedRequest.name), this.#valueOptions);
      return Object.freeze({ protocol: "pyproc.value-result", version: 1, commandId: command.commandId,
        state: "completed", value, valueDigest: await digestValueEnvelope(value, this.#valueOptions) });
    });
  }

  async setValue(request) {
    return this.#submit("setValue", request, async (command, acceptedRequest) => {
      if (typeof acceptedRequest.name !== "string" || !acceptedRequest.name) throw new PyProcError("PYPROC_INPUT_INVALID", "setValue.name is required");
      const beforeStateDigest = await this.#stateDigest();
      const value = acceptedRequest.value?.protocol === VALUE_ENVELOPE_PROTOCOL
        ? canonicalValueEnvelope(acceptedRequest.value, this.#valueOptions)
        : await encodeValueEnvelope(acceptedRequest.value, this.#valueOptions);
      const decoded = await decodeValueEnvelope(value, this.#valueOptions);
      if (typeof this.#session.setEnvelope === "function") {
        const transport = await encodeValueEnvelope(decoded, {
          limits: { ...(this.#valueOptions.limits || {}), artifactThresholdBytes: 1024 * 1024 },
        });
        await this.#session.setEnvelope(acceptedRequest.name, transport);
      } else {
        await this.#session.set(acceptedRequest.name, decoded);
      }
      this.#stateVersion += 1;
      return Object.freeze({ protocol: "pyproc.mutation-receipt", version: 1, commandId: command.commandId,
        state: "completed", valueDigest: await digestValueEnvelope(value, this.#valueOptions),
        beforeStateDigest, afterStateDigest: await this.#stateDigest() });
    });
  }

  async registerApplication(request) {
    return this.#submit("registerApplication", request, async (command, acceptedRequest) => {
      if (typeof acceptedRequest.name !== "string" || !acceptedRequest.name
        || typeof acceptedRequest.type !== "string" || !acceptedRequest.type
        || !Array.isArray(acceptedRequest.operations)) {
        throw new PyProcError("PYPROC_INPUT_INVALID", "registerApplication requires name, type, and operations");
      }
      if (typeof this.#session.hasCallable === "function" && !await this.#session.hasCallable(acceptedRequest.name)) {
        throw new PyProcError("PYPROC_INPUT_INVALID", "registerApplication name is not a callable Python global");
      }
      const applicationRef = this.#applications.register({
        name: acceptedRequest.name,
        type: acceptedRequest.type,
        operations: acceptedRequest.operations,
      });
      return Object.freeze({ protocol: "pyproc.application-registration", version: 1,
        commandId: command.commandId, state: "completed", applicationRef });
    });
  }

  async invokeApplication(request) {
    return this.#submit("invokeApplication", request, async (command, acceptedRequest) => {
      const operation = acceptedRequest.operation || "call";
      const reference = this.#applications.resolve(acceptedRequest.applicationRef, { operation });
      if (!Array.isArray(acceptedRequest.args)) {
        throw new PyProcError("PYPROC_INPUT_INVALID", "invokeApplication.args must be an array");
      }
      if (typeof this.#session.invokeApplication !== "function") {
        throw new PyProcError("PYPROC_ENV_UNSUPPORTED", "The engine session cannot invoke application references");
      }
      const argumentEnvelopes = [];
      for (const argument of acceptedRequest.args) {
        const normalized = argument?.protocol === VALUE_ENVELOPE_PROTOCOL
          ? canonicalValueEnvelope(argument, this.#valueOptions)
          : await encodeValueEnvelope(argument, this.#valueOptions);
        const decoded = await decodeValueEnvelope(normalized, this.#valueOptions);
        argumentEnvelopes.push(await encodeValueEnvelope(decoded, {
          limits: { ...(this.#valueOptions.limits || {}), artifactThresholdBytes: 1024 * 1024 },
        }));
      }
      const rawResult = await this.#session.invokeApplication(reference.name, argumentEnvelopes);
      const inlineResult = canonicalValueEnvelope(rawResult, this.#valueOptions);
      const decodedResult = await decodeValueEnvelope(inlineResult, this.#valueOptions);
      const value = await encodeValueEnvelope(decodedResult, this.#valueOptions);
      return Object.freeze({ protocol: "pyproc.application-result", version: 1, commandId: command.commandId,
        state: "completed", applicationRef: reference, value,
        valueDigest: await digestValueEnvelope(value, this.#valueOptions) });
    });
  }

  async checkpoint(request = {}) {
    return this.#submit("checkpoint", request, async (command, acceptedRequest) => {
      if (acceptedRequest.parentCheckpointRef !== undefined
        && acceptedRequest.parentCheckpointRef !== this.#activeCheckpointRef) {
        throw new PyProcError("PYPROC_STATE_FENCE_STALE", "Checkpoint parent is not the active checkpoint", {
          context: { kernelCode: "KERNEL_CHECKPOINT_PARENT_MISMATCH",
            expectedParentCheckpointRef: this.#activeCheckpointRef,
            actualParentCheckpointRef: acceptedRequest.parentCheckpointRef },
        });
      }
      const boundaries = await Promise.all(this.#checkpointCoordinators
        .map((coordinator) => coordinator.inspectCheckpointBoundary()));
      const vfsRoots = [...new Set(boundaries.map((boundary) => boundary.vfsRootDigest).filter(Boolean))];
      if (vfsRoots.length > 1) {
        throw new PyProcError("PYPROC_STATE_CORRUPT", "Checkpoint coordinators reported conflicting VFS roots", {
          context: { kernelCode: "KERNEL_CHECKPOINT_VFS_ROOT_CONFLICT", vfsRoots },
        });
      }
      const boundary = {
        acceptedHostcalls: boundaries.reduce((count, item) => count + (item.acceptedHostcalls || 0), 0),
        activeTransactions: boundaries.reduce((count, item) => count + (item.activeTransactions || 0), 0),
        outputDrained: boundaries.every((item) => item.outputDrained !== false),
        openResources: boundaries.flatMap((item) => item.openResources || []),
        vfsRootDigest: vfsRoots[0] || null,
      };
      const forbiddenResource = boundary.openResources?.find((resource) => resource.disposition === "forbidden");
      if (boundary.acceptedHostcalls || boundary.activeTransactions || boundary.outputDrained === false || forbiddenResource) {
        throw new PyProcError("PYPROC_PROCESS_UNAVAILABLE", "Kernel checkpoint boundary is busy", {
          context: { kernelCode: "KERNEL_CHECKPOINT_BUSY", boundary },
        });
      }
      const snapshot = await this.#session.checkpoint();
      const descriptor = await sealKernelCheckpoint(snapshot, {
        artifactStore: this.#checkpointArtifactStore,
        engineId: this.engineId,
        environmentId: this.#environmentId,
        vfsRootDigest: boundary.vfsRootDigest ?? null,
        openResources: boundary.openResources || [],
        executionCursor: this.#stateVersion,
        parentCheckpointRef: this.#activeCheckpointRef,
      });
      this.#checkpoints.set(descriptor.checkpointRef, { descriptor, index: snapshot.idx });
      this.#activeCheckpointRef = descriptor.checkpointRef;
      return Object.freeze({ ...descriptor, commandId: command.commandId,
        state: "completed", generation: this.#generation, stateDigest: await this.#stateDigest() });
    });
  }

  async restore(request) {
    const receipt = await this.#submit("restore", request, async (command, acceptedRequest) => {
      const record = this.#checkpoints.get(acceptedRequest.checkpointRef);
      if (!record) throw new PyProcError("PYPROC_INPUT_INVALID", "restore.checkpointRef is unknown");
      const descriptor = acceptedRequest.checkpoint || record.descriptor;
      if (descriptor.checkpointRef !== acceptedRequest.checkpointRef) {
        throw new PyProcError("PYPROC_INPUT_INVALID", "restore checkpoint descriptor reference does not match");
      }
      await this.#verifyCheckpointDescriptor(descriptor);
      if (!Number.isSafeInteger(record.index) || record.index < 0) {
        throw new PyProcError("PYPROC_STATE_FENCE_STALE", "Checkpoint belongs to an earlier worker image and requires a fresh kernel boot");
      }
      await this.#session.timeTravel(record.index);
      this.#stateVersion += 1;
      return { protocol: "pyproc.restore-receipt", version: 1, commandId: command.commandId,
        state: "completed", checkpointRef: acceptedRequest.checkpointRef, checkpoint: descriptor };
    });
    this.#generation += 1;
    this.#queue.advanceGeneration(this.#generation);
    this.#applications.advanceGeneration(this.#generation);
    this.#activeCheckpointRef = receipt.checkpointRef;
    return Object.freeze({ ...receipt, generation: this.#generation, stateDigest: await this.#stateDigest() });
  }

  async verifyCheckpoint(request) {
    return this.#submit("verifyCheckpoint", request, async (command, acceptedRequest) => {
      await this.#verifyCheckpointDescriptor(acceptedRequest.checkpoint);
      return Object.freeze({ protocol: "pyproc.checkpoint-verification", version: 1,
        commandId: command.commandId, state: "verified", checkpointRef: acceptedRequest.checkpoint.checkpointRef });
    });
  }

  async #verifyCheckpointDescriptor(descriptor) {
    return verifyKernelCheckpointDescriptor(descriptor, {
      artifactStore: this.#checkpointArtifactStore,
      engineId: this.engineId,
      environmentId: this.#environmentId,
      resolveParent: async (checkpointRef) => this.#checkpoints.get(checkpointRef)?.descriptor || null,
    });
  }

  async install(request) {
    const acceptedRequest = requestObject(request);
    const wheel = acceptedRequest.wheel;
    if (!(wheel instanceof ArrayBuffer) && !(wheel instanceof Uint8Array)) {
      throw new PyProcError("PYPROC_INPUT_INVALID", "install.wheel must be bytes");
    }
    const wheelBytes = wheel instanceof Uint8Array ? wheel : new Uint8Array(wheel);
    const wheelDigest = await sha256Address(wheelBytes);
    return this.#submit("install", acceptedRequest, async (command) => {
      const beforeStateDigest = await this.#stateDigest();
      const installed = await this.#session.installWheel(wheelBytes);
      if (parseSha256Address(installed.environmentId)) this.#environmentId = installed.environmentId;
      if (typeof this.#session.resetCheckpointLineage === "function") await this.#session.resetCheckpointLineage();
      this.#activeCheckpointRef = null;
      if (this.#onEnvironmentChanged) this.#onEnvironmentChanged(null);
      this.#stateVersion += 1;
      return Object.freeze({ protocol: "pyproc.environment-receipt", version: 1, commandId: command.commandId,
        state: "completed", wheelDigest, installed, beforeStateDigest, afterStateDigest: await this.#stateDigest() });
    }, { wheelDigest, byteLength: wheelBytes.byteLength });
  }

  async installEnvironment(request) {
    const acceptedRequest = requestObject(request);
    if (!parseSha256Address(acceptedRequest.environmentId) || !Array.isArray(acceptedRequest.wheels)
      || !acceptedRequest.wheels.length || !Array.isArray(acceptedRequest.allowedTags)) {
      throw new PyProcError("PYPROC_INPUT_INVALID", "installEnvironment requires an environment digest, wheel set, and tags");
    }
    const wheels = [];
    const commandWheels = [];
    for (const wheel of acceptedRequest.wheels) {
      if (!wheel || typeof wheel !== "object" || typeof wheel.filename !== "string"
        || typeof wheel.name !== "string" || typeof wheel.version !== "string"
        || !parseSha256Address(wheel.sha256)
        || !(wheel.bytes instanceof ArrayBuffer) && !(wheel.bytes instanceof Uint8Array)) {
        throw new PyProcError("PYPROC_INPUT_INVALID", "installEnvironment wheel descriptor is invalid");
      }
      const bytes = wheel.bytes instanceof Uint8Array ? wheel.bytes.slice() : new Uint8Array(wheel.bytes.slice(0));
      wheels.push(Object.freeze({ filename: wheel.filename, name: wheel.name, version: wheel.version,
        sha256: wheel.sha256, bytes }));
      commandWheels.push(Object.freeze({ filename: wheel.filename, name: wheel.name, version: wheel.version,
        sha256: wheel.sha256, byteLength: bytes.byteLength }));
    }
    const canonical = Object.freeze({ environmentId: acceptedRequest.environmentId,
      lockDigest: acceptedRequest.lockDigest || null, policyDigest: acceptedRequest.policyDigest || null,
      allowedTags: [...acceptedRequest.allowedTags], wheels: commandWheels });
    return this.#submit("installEnvironment", acceptedRequest, async (command) => {
      const beforeStateDigest = await this.#stateDigest();
      const installed = await this.#session.installEnvironment({ environmentId: acceptedRequest.environmentId,
        wheels, allowedTags: acceptedRequest.allowedTags, limits: acceptedRequest.limits });
      this.#environmentId = acceptedRequest.environmentId;
      if (typeof this.#session.resetCheckpointLineage === "function") await this.#session.resetCheckpointLineage();
      this.#activeCheckpointRef = null;
      if (this.#onEnvironmentChanged) this.#onEnvironmentChanged(Object.freeze({
        protocol: "pyproc.package-environment-bootstrap", version: 1,
        environmentId: acceptedRequest.environmentId,
        lockDigest: acceptedRequest.lockDigest || null,
        policyDigest: acceptedRequest.policyDigest || null,
        allowedTags: Object.freeze([...acceptedRequest.allowedTags]),
        limits: acceptedRequest.limits ? Object.freeze({ ...acceptedRequest.limits }) : null,
        wheels: Object.freeze(wheels.map((wheel) => Object.freeze({ ...wheel, bytes: wheel.bytes.slice() }))),
      }));
      this.#stateVersion += 1;
      return Object.freeze({ protocol: "pyproc.environment-receipt", version: 2,
        commandId: command.commandId, state: "completed", environmentId: this.#environmentId,
        lockDigest: acceptedRequest.lockDigest || null, policyDigest: acceptedRequest.policyDigest || null,
        installed, beforeStateDigest, afterStateDigest: await this.#stateDigest() });
    }, canonical);
  }

  async inspect(request = {}) {
    return this.#submit("inspect", request, async (command) => Object.freeze({
      protocol: "pyproc.inspection-result",
      version: 1,
      commandId: command.commandId,
      state: "completed",
      descriptor: await this.describe(),
      stateDigest: await this.#stateDigest(),
      queuedCommands: this.#queue.pending.length,
      activeCommandId: this.#queue.active?.command.commandId || null,
    }));
  }

  async interrupt(request = {}) {
    const acceptedRequest = requestObject(request);
    await this.#admissionTail;
    const targetCommandId = acceptedRequest.targetCommandId || this.#queue.active?.command.commandId;
    if (!targetCommandId) return Object.freeze({ protocol: "pyproc.interrupt-receipt", version: 1, state: "notRunning" });
    const cancelled = this.#queue.cancel(targetCommandId);
    if (cancelled.state === "executing") {
      this.#state = "interrupting";
      this.#session.terminate();
    }
    return Object.freeze({ protocol: "pyproc.interrupt-receipt", version: 1,
      state: cancelled.state === "queued" || cancelled.state === "cancelled" ? "cancelled" : "terminated",
      targetCommandId });
  }

  async close() {
    if (this.#state === "closed") return Object.freeze({ protocol: "pyproc.close-receipt", version: 1, state: "closed" });
    this.#state = "closing";
    if (this.#unsubscribeFailure) this.#unsubscribeFailure();
    this.#unsubscribeFailure = null;
    this.#queue.terminate(new PyProcError("PYPROC_PROCESS_UNAVAILABLE", "Kernel closed"));
    this.#applications.close();
    this.#session.terminate();
    this.#state = "closed";
    return Object.freeze({ protocol: "pyproc.close-receipt", version: 1, state: "closed" });
  }

  #fault(error) {
    if (["closed", "closing", "terminated"].includes(this.#state)) return;
    this.#state = "faulted";
    this.#queue.terminate(error, { preserveActive: true });
    this.#state = "terminated";
  }
}

export async function bootCpythonWasiKernel(manifest) {
  const session = await bootWasi(manifest);
  return assertKernelRuntimeContract(new CpythonWasiKernelRuntime(session, {
    kernelRef: manifest.kernelRef,
    engineId: manifest.engineId,
    nativeProfile: manifest.nativeProfile,
    threading: manifest.threading,
    environmentId: manifest.environmentId,
    onEnvironmentChanged: manifest.onEnvironmentChanged,
    artifactStore: manifest.artifactStore,
    valueLimits: manifest.valueLimits,
    checkpointCoordinator: manifest.checkpointCoordinator,
    kernelVfs: manifest.kernelVfs,
    restoredCheckpoint: manifest.restoredCheckpoint,
    restoredCheckpoints: manifest.restoredCheckpoints,
  }));
}
