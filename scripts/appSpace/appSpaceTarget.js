// appSpaceTarget.js - cooperative app이 명시적으로 등록하는 logical state adapter.
(function installPyProcAppSpaceTarget() {
  "use strict";
  if (globalThis.pyprocAppSpace) return;
  let adapter = null;
  let fence = null;
  let quiesced = false;

  const fail = (code, message) => { const error = new Error(message); error.code = code;
    error.outcome = "notSent"; error.retryable = false; throw error; };
  const revisionOf = async () => {
    const revision = String(await adapter.revision());
    if (!/^apprev:[A-Za-z0-9._:-]{1,128}$/.test(revision)) fail("APP_SPACE_REVISION_INVALID", "adapter revision is invalid");
    return revision;
  };
  const sameIdentity = (value) => value?.appId === adapter.identity.appId && value?.origin === adapter.identity.origin
    && value?.adapterVersion === adapter.identity.adapterVersion && value?.stateSchema === adapter.identity.stateSchema;
  const requireAdapter = () => { if (!adapter) fail("APP_SPACE_ADAPTER_UNAVAILABLE", "cooperative app adapter is not registered"); };
  const requireFence = (input) => {
    if (!quiesced || typeof input?.fence !== "string" || input.fence !== fence) {
      fail("APP_SPACE_FENCE_INVALID", "operation requires the current quiesce fence");
    }
  };
  const dispatch = async (operation, input = {}) => {
    requireAdapter();
    if (operation === "describe") return { identity: adapter.identity, revision: await revisionOf(), quiesced,
      capabilities: Object.freeze(["exportState", "importState", ...(adapter.stageEffect ? ["stageEffect"] : []),
        ...(adapter.finalizeEffect ? ["finalizeEffect"] : [])]) };
    if (operation === "quiesce") {
      if (input.expectedRevision !== await revisionOf()) fail("APP_SPACE_REVISION_CONFLICT", "app revision changed before quiesce");
      await adapter.quiesce();
      if (input.expectedRevision !== await revisionOf()) fail("APP_SPACE_REVISION_CONFLICT", "app revision changed during quiesce");
      quiesced = true;
      fence = crypto.randomUUID();
      return { revision: input.expectedRevision, fence };
    }
    if (operation === "export") {
      requireFence(input);
      const revision = await revisionOf();
      if (input.expectedRevision !== revision) fail("APP_SPACE_REVISION_CONFLICT", "app revision changed before export");
      const state = await adapter.exportState();
      const outbox = typeof adapter.describeEffects === "function" ? await adapter.describeEffects() : [];
      if (revision !== await revisionOf()) fail("APP_SPACE_REVISION_CONFLICT", "app revision changed during export");
      return { identity: adapter.identity, revision, state, outbox, scope: adapter.scope };
    }
    if (operation === "import") {
      requireFence(input);
      if (!sameIdentity(input.snapshot?.identity)) fail("APP_SPACE_IDENTITY_MISMATCH", "snapshot identity does not match the adapter");
      await adapter.importState(structuredClone(input.snapshot.state), structuredClone(input.snapshot.outbox));
      return { revision: await revisionOf() };
    }
    if (operation === "resume") {
      requireFence(input);
      await adapter.resume();
      quiesced = false;
      fence = null;
      return { resumed: true, revision: await revisionOf() };
    }
    if (operation === "stageEffect") {
      if (quiesced || typeof adapter.stageEffect !== "function") fail("APP_SPACE_EFFECT_UNAVAILABLE", "effect staging is unavailable");
      await adapter.stageEffect(structuredClone(input.effect));
      return { staged: true, revision: await revisionOf() };
    }
    if (operation === "finalizeEffect") {
      if (quiesced || typeof adapter.finalizeEffect !== "function") fail("APP_SPACE_EFFECT_UNAVAILABLE", "effect finalization is unavailable");
      await adapter.finalizeEffect(structuredClone(input.effect));
      return { finalized: true, revision: await revisionOf() };
    }
    fail("APP_SPACE_OPERATION_UNSUPPORTED", `unsupported app operation: ${operation}`);
  };

  Object.defineProperty(globalThis, "pyprocAppSpace", { configurable: false, enumerable: false,
    value: Object.freeze({
      register(value) {
        if (adapter) fail("APP_SPACE_ADAPTER_EXISTS", "an app adapter is already registered");
        if (!value || typeof value !== "object" || !value.identity || value.identity.origin !== location.origin
          || !Array.isArray(value.scope) || !value.scope.length
          || !["revision", "quiesce", "exportState", "importState", "resume"].every((name) => typeof value[name] === "function")) {
          fail("APP_SPACE_ADAPTER_INVALID", "app adapter contract is invalid");
        }
        adapter = Object.freeze({ ...value, identity: Object.freeze({ ...value.identity }), scope: Object.freeze([...value.scope]) });
        return Object.freeze({ registered: true, identity: adapter.identity });
      },
    }) });
  Object.defineProperty(globalThis, "pyprocAppSpaceTarget", { configurable: false, enumerable: false,
    value: Object.freeze({ dispatch }) });
})();
