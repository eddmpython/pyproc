import { createWebComputer, open } from "../index.js";
import type { MachineStore } from "../src/machine/index.js";
import {
  createExecutionMemoryRegistry,
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
  await client.close();
  return `${value}:${verdict}`;
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

// @ts-expect-error the legacy wrapper is removed; durable options are direct
open({ persistent: true });
