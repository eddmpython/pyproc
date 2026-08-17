// createWebComputer.js - Layer 5/composition: 컴퓨터 한 대의 배선. pyproc의 최상단 조립 지점이다.
//
// 여기 오기 전까지 이 조립은 제품 앱(apps/webComputer) 안에 살았고, npm으로 받은 소비자는
// 재현할 방법이 없었다. 이제 조립이 공개 표면이고 앱은 이 함수의 소비자다.
//
// 게스트 정책:
// - python: 기본 탑재. pyproc 자신이 엔진이므로 주입 없이 즉시 부팅한다.
// - linux: V86 constructor를 주입할 때만 등록한다. third-party binary를 package에 싣지
//   않는 provenance 정책(skills/manage-pyproc-assets/references/asset-provenance.md 결정 1)이 그대로 산다.
// - node: source identity와 digest가 있는 image를 주입할 때만 별도 x86-node adapter로 등록한다.
import { WebMachineError } from "../contracts/webMachineError.js";
import { createBrowserHost } from "./createBrowserHost.js";
import { createCpythonWasiGuestFactory } from "../guests/cpythonWasi/cpythonWasiGuestAdapter.js";
import { createV86GuestFactory } from "../guests/v86/v86GuestAdapter.js";
import { MemoryEthernetSwitch } from "../devices/memoryEthernetSwitch.js";
import { MemoryBlockDevice } from "../devices/memoryBlockDevice.js";
import { MemoryScanCodeInputDevice } from "../devices/memoryScanCodeInputDevice.js";
import { MemoryTextDisplayDevice } from "../devices/memoryTextDisplayDevice.js";
import { createDurableWebComputerFacade } from "./durableWebComputer.js";
import { createLinuxPythonSession } from "./linuxPythonSession.js";

// 기본 디스크 크기. 출처: 제품 실측 상수(apps/webComputer/machineConfig.js의 2MiB)와 동일값.
const DEFAULT_DISK_BYTES = 2 * 1024 * 1024;

export const WEB_COMPUTER_MACHINE_IDS = Object.freeze(["pythonOs", "linuxOs", "nodeOs"]);

function isPublicHttpsUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password && !url.hash;
  } catch (error) { return false; }
}

function assertNodeManifest(manifest) {
  const node = manifest?.node;
  if (!node || node.runtime !== "node" || typeof node.version !== "string" || !/^\d+\.\d+\.\d+$/.test(node.version)
    || typeof node.sourceRevision !== "string" || !/^[0-9a-f]{40}$/.test(node.sourceRevision)
    || typeof node.sourceUrl !== "string" || !isPublicHttpsUrl(node.sourceUrl)
    || typeof node.sourceSha256 !== "string" || !/^[0-9a-f]{64}$/.test(node.sourceSha256)) {
    throw new TypeError("node.manifest.node requires runtime node, an exact version, source revision, URL, and SHA-256");
  }
  const assets = manifest?.v86?.assets;
  if (!Array.isArray(assets) || !assets.some((entry) => entry?.target === "bzimage")) {
    throw new TypeError("node.manifest.v86.assets requires a digest-pinned bzimage");
  }
}

async function loadBrowserAsset(url, descriptor) {
  const base = globalThis.location?.href;
  const origin = globalThis.location?.origin;
  if (!base || !origin) {
    throw new WebMachineError("WEB_MACHINE_GUEST_BOOT", "the default node asset loader requires a browser location");
  }
  const resolved = new URL(String(url), base);
  if (resolved.origin !== origin || resolved.username || resolved.password) {
    throw new WebMachineError("WEB_MACHINE_GUEST_BOOT", "the default node asset loader accepts same-origin URLs only");
  }
  const response = await fetch(resolved.href, { redirect: "error", credentials: "omit", cache: "no-store" });
  if (!response.ok) throw new Error(`asset response ${response.status}`);
  const expectedBytes = descriptor?.byteLength;
  const contentLength = response.headers?.get?.("content-length");
  const declaredBytes = contentLength === null || contentLength === undefined || contentLength === ""
    ? null
    : Number(contentLength);
  if (declaredBytes !== null && (!Number.isSafeInteger(declaredBytes) || declaredBytes < 0)) {
    throw new Error(`asset Content-Length is invalid: ${contentLength}`);
  }
  if (declaredBytes !== null && declaredBytes !== expectedBytes) {
    throw new Error(`asset Content-Length ${declaredBytes} does not match ${expectedBytes}`);
  }
  if (!response.body?.getReader) throw new Error("asset response requires a readable byte stream");
  const output = new Uint8Array(expectedBytes);
  const reader = response.body.getReader();
  let offset = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!ArrayBuffer.isView(value) || offset + value.byteLength > expectedBytes) {
        await reader.cancel("asset exceeded its declared byteLength").catch(() => undefined);
        throw new Error(`asset body exceeds ${expectedBytes} bytes`);
      }
      output.set(new Uint8Array(value.buffer, value.byteOffset, value.byteLength), offset);
      offset += value.byteLength;
    }
  } finally {
    reader.releaseLock();
  }
  if (offset !== expectedBytes) throw new Error(`asset body ${offset} does not match ${expectedBytes}`);
  return output;
}

function browserDigestBytes(cryptoProvider) {
  if (!cryptoProvider?.subtle) throw new TypeError("a node guest requires cryptoProvider.subtle or node.digestBytes");
  return async (bytes) => {
    const digest = new Uint8Array(await cryptoProvider.subtle.digest("SHA-256", bytes));
    return `sha256:${[...digest].map((byte) => byte.toString(16).padStart(2, "0")).join("")}`;
  };
}

function v86AssetIntegrityOptions(config, cryptoProvider) {
  const declaresAssets = Array.isArray(config?.manifest?.v86?.assets);
  if (!declaresAssets && config?.loadAsset == null && config?.digestBytes == null) return {};
  return {
    loadAsset: config?.loadAsset ?? loadBrowserAsset,
    digestBytes: config?.digestBytes ?? browserDigestBytes(cryptoProvider),
  };
}

// 컴퓨터 한 대를 조립한다. 반환값은 host/장치/머신과 수명주기 제어다.
// python은 항상 만들어지고, linux와 node는 각 V86 설정이 주입될 때만 만들어진다.
function createBasicWebComputer({
  python = {},
  linux = null,
  node = null,
  adapters = {},
  devices: extraDevices = {},
  onConsole = null,
  cryptoProvider = globalThis.crypto,
  // 머신의 출처를 정하는 모드다(동사 부재의 우회가 아니다): true면 설정된 기본 머신을 여기서
  // 만들고, false면 하드웨어(장치+host+어댑터)만 조립해 머신은 image manifest가 만든다.
  // 세 호출부가 후자를 쓴다: 신뢰 화면 preflight, import 후보 조립, deferBoot 복원.
  // host.destroyMachine으로 대체하지 않는 이유: 어댑터를 만들어 곧 버리는 낭비가 된다.
  createMachines = true,
  // 내장 L2 스위치. false면 끄고, 객체면 그 옵션으로 만든다(maxFrameBytes/maxQueuedFrames).
  network = true,
} = {}) {
  const pythonDisk = new MemoryBlockDevice({ byteLength: python.diskBytes ?? DEFAULT_DISK_BYTES });
  const builtInDevices = { pythonDisk };
  // L2 스위치를 컴퓨터의 내장 장치로 둔다. guest가 둘 이상이면 이것이 그들 사이의 유일한
  // 바이트 경로다(같은 host에 등록됐다는 사실만 공유하는 상태를 끝낸다). 학습·flood·큐 상한은
  // 장치가 소유하고, TCP/IP는 guest 몫이다(프레임 계약만 준다).
  if (network !== false) builtInDevices.network = new MemoryEthernetSwitch(network === true ? {} : network || {});
  if (linux) {
    builtInDevices.linuxDisk = new MemoryBlockDevice({ byteLength: linux.diskBytes ?? DEFAULT_DISK_BYTES });
    builtInDevices.display = new MemoryTextDisplayDevice();
    builtInDevices.input = new MemoryScanCodeInputDevice({ maxBatchBytes: 512, maxQueuedBatches: 32 });
  }
  if (node) builtInDevices.nodeDisk = new MemoryBlockDevice({ byteLength: node.diskBytes ?? DEFAULT_DISK_BYTES });
  const devices = {
    console: {
      kind: "console",
      write: (line) => { onConsole?.(String(line)); },
    },
    ...builtInDevices,
    ...extraDevices,
  };

  const host = createBrowserHost({ devices, cryptoProvider });
  host.registerAdapter("cpython-wasi", createCpythonWasiGuestFactory({
    ...(python.bootMachine ? { bootMachine: python.bootMachine } : {}),
    ...(python.openMachineImage ? { openMachineImage: python.openMachineImage } : {}),
  }));
  if (linux) {
    if (typeof linux.V86 !== "function") throw new TypeError("a linux.V86 constructor is required");
    host.registerAdapter("x86-linux", createV86GuestFactory({
      V86: linux.V86,
      ...(linux.adapterVersion ? { adapterVersion: linux.adapterVersion } : {}),
      blockDeviceName: "linuxDisk",
      blockMode: "filesystem",
      displayDeviceName: "display",
      inputDeviceName: "input",
      ...(builtInDevices.network ? { packetDeviceName: "network" } : {}),
      ...(linux.adapterOptions || {}),
      ...v86AssetIntegrityOptions(linux, cryptoProvider),
    }));
  }
  if (node) {
    if (typeof node.V86 !== "function") throw new TypeError("a node.V86 constructor is required");
    if (!node.manifest) throw new TypeError("node.manifest is required");
    assertNodeManifest(node.manifest);
    host.registerAdapter("x86-node", createV86GuestFactory({
      V86: node.V86,
      ...(node.adapterVersion ? { adapterVersion: node.adapterVersion } : {}),
      blockDeviceName: "nodeDisk",
      blockMode: "filesystem",
      ...(builtInDevices.network ? { packetDeviceName: "network" } : {}),
      ...(node.adapterOptions || {}),
      ...v86AssetIntegrityOptions(node, cryptoProvider),
    }));
  }
  for (const [adapterId, factory] of Object.entries(adapters || {})) {
    host.registerAdapter(adapterId, factory);
  }

  const machines = new Map();
  if (createMachines) machines.set("pythonOs", host.createMachine({
    machineId: "pythonOs",
    adapterId: "cpython-wasi",
    manifest: python.manifest ?? { kernel: { ...(python.kernel || {}) } },
    permissions: { devices: ["console", "pythonDisk", ...(builtInDevices.network ? ["network"] : [])] },
  }));
  if (createMachines && linux) {
    if (!linux.manifest) throw new TypeError("linux.manifest is required (the consumer brings the boot assets along with their provenance)");
    machines.set("linuxOs", host.createMachine({
      machineId: "linuxOs",
      adapterId: "x86-linux",
      manifest: linux.manifest,
      permissions: { devices: ["console", "linuxDisk", "display", "input", ...(builtInDevices.network ? ["network"] : [])] },
    }));
  }
  if (createMachines && node) {
    machines.set("nodeOs", host.createMachine({
      machineId: "nodeOs",
      adapterId: "x86-node",
      manifest: node.manifest,
      permissions: { devices: ["console", "nodeDisk", ...(builtInDevices.network ? ["network"] : [])] },
    }));
  }

  const machine = (machineId) => {
    const found = machines.get(machineId);
    if (!found) throw new WebMachineError("WEB_MACHINE_UNAVAILABLE", `Machine is not available: ${machineId}`);
    return found;
  };
  const runningMachineIds = () => [...machines.values()]
    .filter((m) => m.state === "running")
    .map((m) => m.machineId);

  return Object.freeze({
    host,
    devices,
    machines,
    machine,
    runningMachineIds,
    async bootAll(control) {
      const candidates = [...machines.values()];
      const outcomes = await Promise.allSettled(candidates.map((m) => m.boot(control)));
      const bootFailures = outcomes.filter((entry) => entry.status === "rejected").map((entry) => entry.reason);
      if (bootFailures.length) {
        const cleanup = await Promise.allSettled(candidates
          .filter((m) => m.state !== "stopped")
          .map((m) => m.shutdown()));
        const cleanupFailures = cleanup.filter((entry) => entry.status === "rejected").map((entry) => entry.reason);
        const failures = [...bootFailures, ...cleanupFailures];
        if (failures.length > 1) {
          throw new AggregateError(failures, cleanupFailures.length
            ? "Web Computer boot and cleanup both failed"
            : "Multiple Web Computer guests failed to boot");
        }
        throw failures[0];
      }
    },
    // 실행 중인 머신만 순서대로 멈춘다. 중간 실패 시 이미 멈춘 것들을 되살리고 던진다
    // (절반만 멈춘 컴퓨터를 남기지 않는다).
    async pauseRunning(control) {
      const runningIds = runningMachineIds();
      const pausedIds = [];
      try {
        for (const machineId of runningIds) {
          await machine(machineId).pause(control);
          pausedIds.push(machineId);
        }
      } catch (error) {
        await this.resumeMachineIds(pausedIds).catch(() => undefined);
        throw error;
      }
      return runningIds;
    },
    async resumeMachineIds(machineIds, control) {
      await Promise.all(machineIds.map((machineId) => {
        const found = machine(machineId);
        return found.state === "paused" ? found.resume(control) : undefined;
      }));
    },
    async resumeAll(control) {
      await this.resumeMachineIds(
        [...machines.values()].filter((m) => m.state === "paused").map((m) => m.machineId),
        control,
      );
    },
    async shutdownAll(control) {
      await Promise.all([...machines.values()]
        .filter((m) => m.state !== "stopped")
        .map((m) => m.shutdown(control)));
    },
    // 머신 집합 교체. 이미지에서 만들어진 머신으로 갈아끼우는 소비자(신뢰 화면 preflight,
    // import 후보 조립, deferBoot 복원)에게 필요한 동사다. 없는 동안 앱은 자기 Map을 들고
    // 위 수명주기 동사 전부를 통째로 다시 구현했다: 동사 하나의 부재가 사본 하나를 낳는다.
    // Map을 갈아끼우지 않고 내용만 바꾸는 이유는 위 클로저들이 이 Map을 붙들고 있기 때문이다.
    adoptMachines(next) {
      if (!(next instanceof Map)) throw new TypeError("adoptMachines: a Map of machines is required");
      for (const [machineId, candidate] of next) {
        if (typeof machineId !== "string" || !machineId || !candidate || typeof candidate.boot !== "function") {
          throw new WebMachineError("WEB_MACHINE_INPUT_INVALID", `adoptMachines: ${String(machineId)} is not a machine handle`);
        }
      }
      machines.clear();
      for (const [machineId, candidate] of next) machines.set(machineId, candidate);
      return machines;
    },
    adoptOwnership(token) {
      for (const m of machines.values()) m.adoptOwnership(token);
    },
    invalidateOwnership(reason) {
      for (const m of machines.values()) m.invalidateOwnership(reason);
    },
  });
}

// 공개 컴퓨터 핸들. 기본 수명주기와 내구 수명주기를 같은 active context에 묶는다.
// durability를 주입하지 않은 기존 소비자는 전과 같은 동사를 쓰고, 주입한 소비자는 같은
// 핸들에서 initialize/save/exportImage/importImage/dispose까지 이어 간다. import가 검증된
// candidate로 성공하면 getter가 새 active context를 가리키므로 옛 host/device 참조가 공개
// 핸들에 남지 않는다.
export function createWebComputer(options = {}) {
  if (!options || typeof options !== "object") throw new TypeError("createWebComputer: options must be an object");
  let active = createBasicWebComputer(options);
  const createCandidate = () => createBasicWebComputer({ ...options, createMachines: false });
  const durable = createDurableWebComputerFacade({
    getActive: () => active,
    setActive: (candidate) => { active = candidate; },
    createCandidate,
    durability: options.durability,
    cryptoProvider: options.cryptoProvider ?? globalThis.crypto,
  });
  // linuxOs가 있을 때만 네이티브 CPython을 친다. 기본 pythonOs/WASI boot는 그대로다.
  const linuxPython = createLinuxPythonSession({
    machine: () => active.machines.get("linuxOs") || null,
    python: options.linux?.python,
    prompt: options.linux?.shellPrompt
      || options.linux?.manifest?.v86?.shellPrompt
      || options.linux?.manifest?.v86?.readyPattern
      || null,
  });
  return Object.freeze({
    get host() { return active.host; },
    get devices() { return active.devices; },
    get machines() { return active.machines; },
    machine: (machineId) => active.machine(machineId),
    runningMachineIds: () => active.runningMachineIds(),
    bootAll: (control) => active.bootAll(control),
    pauseRunning: (control) => active.pauseRunning(control),
    resumeMachineIds: (machineIds, control) => active.resumeMachineIds(machineIds, control),
    resumeAll: (control) => active.resumeAll(control),
    shutdownAll: (control) => active.shutdownAll(control),
    adoptMachines: (machines) => active.adoptMachines(machines),
    adoptOwnership: (token) => active.adoptOwnership(token),
    invalidateOwnership: (reason) => active.invalidateOwnership(reason),
    initialize: durable.initialize,
    resume: durable.resume,
    save: durable.save,
    suspend: durable.suspend,
    retrySuspendCleanup: durable.retrySuspendCleanup,
    exportImage: durable.exportImage,
    importImage: durable.importImage,
    linuxPython,
    inspect: () => Object.freeze({
      ...durable.inspect(),
      linuxPython: linuxPython.inspect(),
    }),
    dispose: durable.dispose,
  });
}
