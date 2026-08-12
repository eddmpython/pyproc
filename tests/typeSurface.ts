import { createWebComputer, open } from "../index.js";
import type { MachineStore } from "../src/machine/index.js";
import { PyProcControlClient, ControlRemoteError } from "../scripts/controlProtocol/controlApi.js";

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
  await client.close();
  return value;
}
void controlSurface;

declare const controlFailure: ControlRemoteError;
const controlOutcome: string = controlFailure.outcome;
void controlOutcome;

// @ts-expect-error the legacy wrapper is removed; durable options are direct
open({ persistent: true });
