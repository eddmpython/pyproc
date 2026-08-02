import { createWebComputer, open } from "../index.js";
import type { MachineStore } from "../src/machine/index.js";

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

// @ts-expect-error the legacy wrapper is removed; durable options are direct
open({ persistent: true });
