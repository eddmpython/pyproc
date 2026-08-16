import { createHash } from "node:crypto";
import { createV86GuestFactory, createWebComputer, WEB_COMPUTER_MACHINE_IDS } from "../../src/machine/index.js";
import { resolveV86AssetOptions } from "../../src/machine/guests/v86/v86AssetIntegrity.js";
import { createFakeGuestFactory } from "../webMachine/contracts/fakeGuestAdapter.js";
import { MemoryTextDisplayDevice } from "../../src/machine/devices/memoryTextDisplayDevice.js";
import { V86DisplayPort } from "../../src/machine/guests/v86/v86DisplayPort.js";

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function errorOf(operation) {
  try { await operation(); return null; } catch (error) { return error; }
}

function digestBytes(bytes) {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function fixtureDescriptor(bytes, overrides = {}) {
  return {
    target: "bzimage",
    url: "/node-image.bin",
    byteLength: bytes.byteLength,
    sha256: digestBytes(bytes),
    ...overrides,
  };
}

export async function assertV86AssetIntegrityContract() {
  const bytes = new TextEncoder().encode("source-pinned-node-image");
  const descriptor = fixtureDescriptor(bytes);
  const resolved = await resolveV86AssetOptions({
    options: { wasm_path: "/v86.wasm" },
    assets: [descriptor],
    loadAsset: async (url) => {
      assert(url === descriptor.url, "V86 asset loader가 선언 URL을 받지 않았다");
      return bytes;
    },
    digestBytes,
  });
  assert(resolved.options.bzimage.async === false
    && new Uint8Array(resolved.options.bzimage.buffer).join(",") === bytes.join(",")
    && resolved.assets[0].state === "verified",
  "검증된 V86 asset이 engine buffer와 inspect receipt로 승격되지 않았다");
  const firstByte = bytes[0];
  bytes[0] ^= 1;
  assert(new Uint8Array(resolved.options.bzimage.buffer)[0] === firstByte,
    "검증된 V86 engine buffer가 loader 소유 byte 변경에 노출됐다");
  bytes[0] = firstByte;

  const mutated = await errorOf(() => resolveV86AssetOptions({
    options: {},
    assets: [descriptor],
    loadAsset: async () => new TextEncoder().encode("source-pinned-node-imagf"),
    digestBytes,
  }));
  assert(mutated?.code === "WEB_MACHINE_ASSET_INTEGRITY"
    && mutated.details?.expected === descriptor.sha256
    && mutated.details?.actual !== descriptor.sha256,
  "변조된 V86 asset이 exact digest 오류로 닫히지 않았다");
  const digestFailure = await errorOf(() => resolveV86AssetOptions({
    options: {},
    assets: [descriptor],
    loadAsset: async () => bytes,
    digestBytes: async () => { throw new Error("digest provider failed"); },
  }));
  assert(digestFailure?.code === "WEB_MACHINE_GUEST_BOOT" && /digest failed/.test(digestFailure.message),
    "V86 asset digest provider 실패가 구조화된 boot 오류로 닫히지 않았다");
  const coercedDigest = await errorOf(() => resolveV86AssetOptions({
    options: {},
    assets: [descriptor],
    loadAsset: async () => bytes,
    digestBytes: async () => ({ toString: () => descriptor.sha256 }),
  }));
  assert(coercedDigest?.code === "WEB_MACHINE_GUEST_BOOT" && /SHA-256 string/.test(coercedDigest.message),
    "V86 asset digest provider의 비문자열 결과를 암묵 변환했다");
  const ambiguous = await errorOf(() => resolveV86AssetOptions({
    options: { bzimage: { url: "/other.bin" } },
    assets: [descriptor],
    loadAsset: async () => bytes,
    digestBytes,
  }));
  assert(ambiguous?.code === "WEB_MACHINE_GUEST_BOOT" && /cannot also appear/.test(ambiguous.message),
    "검증 descriptor와 raw V86 option의 이중 출처를 거부하지 않았다");
  const coerced = await errorOf(() => resolveV86AssetOptions({
    options: {},
    assets: [{ ...descriptor, url: new URL("https://computer.example/node.bin") }],
    loadAsset: async () => bytes,
    digestBytes,
  }));
  assert(coerced?.code === "WEB_MACHINE_GUEST_BOOT" && /must be strings/.test(coerced.message),
    "V86 asset descriptor가 비문자열 URL을 암묵 변환했다");

  let stopCalls = 0;
  let destroyCalls = 0;
  class NeverReadyV86 {
    add_listener() {}
    remove_listener() {}
    async stop() { stopCalls += 1; throw new Error("partial instance stop is unsafe"); }
    async destroy() { destroyCalls += 1; throw new Error("partial instance destroy is unsafe"); }
  }
  const partial = createV86GuestFactory({ V86: NeverReadyV86 })();
  const timeout = await errorOf(() => partial.boot(
    { machineId: "partialNode", devices: { console: { kind: "console", write() {} } } },
    { v86: { engineTimeoutMs: 1, options: {} } },
  ));
  assert(timeout?.code === "WEB_MACHINE_GUEST_TIMEOUT", "부분 V86 boot timeout fixture가 RED가 아니다");
  assert(partial.inspect().ready === false, "engine-ready 전 부분 V86가 ready로 보고됐다");
  await partial.shutdown();
  assert(stopCalls === 0 && destroyCalls === 0 && partial.inspect().ready === false,
    "부분 생성 V86를 unsafe stop 또는 destroy 없이 종료하지 않았다");

  const listeners = new Map();
  const displayDevice = new MemoryTextDisplayDevice();
  const displayPort = new V86DisplayPort({ device: displayDevice, endpointId: "display-contract" });
  const displayEngine = {
    add_listener: (name, listener) => listeners.set(name, listener),
    remove_listener: (name) => listeners.delete(name),
  };
  displayPort.attach(displayEngine);
  listeners.get("screen-set-size")([80, 256, 0]);
  listeners.get("screen-put-char")([255, 79, 32]);
  listeners.get("screen-set-size")([80, 25, 0]);
  listeners.get("screen-put-char")([255, 79, 32]);
  listeners.get("screen-put-char")([0, 0, 65]);
  await displayPort.drain();
  assert(displayPort.inspect().clippedCells === 1 && displayPort.inspect().errors === 0
    && displayPort.inspect().cellWrites === 2 && displayDevice.readFrame().cells[0] === 65,
  "v86의 화면 밖 transient cell이 오류로 누적되거나 정상 cell을 막았다");
  displayPort.detach();

  class FixtureV86 {}
  const manifest = {
    node: {
      runtime: "node",
      version: "22.22.0",
      sourceRevision: "6add85e4c46b8be383c8b637102d6b6fd206adce",
      sourceUrl: "https://nodejs.org/dist/v22.22.0/node-v22.22.0.tar.xz",
      sourceSha256: "4c138012bb5352f49822a8f3e6d1db71e00639d0c36d5b6756f91e4c6f30b683",
    },
    v86: { assets: [descriptor], options: { wasm_path: "/v86.wasm", filesystem: {} } },
  };
  const computer = createWebComputer({
    cryptoProvider: { randomUUID: () => "node-contract-instance" },
    node: {
      V86: FixtureV86,
      manifest,
      loadAsset: async () => bytes,
      digestBytes,
    },
  });
  assert(WEB_COMPUTER_MACHINE_IDS.join(",") === "pythonOs,linuxOs,nodeOs"
    && computer.machines.has("pythonOs") && computer.machines.has("nodeOs")
    && computer.machine("nodeOs").adapterId === "x86-node"
    && computer.devices.nodeDisk?.kind === "block",
  "createWebComputer가 Node guest와 독립 block device를 조립하지 않았다");
  const unpinned = await errorOf(() => createWebComputer({
    cryptoProvider: { randomUUID: () => "invalid-node-instance" },
    node: { V86: FixtureV86, manifest: { node: manifest.node, v86: { options: {} } }, loadAsset: async () => bytes, digestBytes },
  }));
  assert(unpinned instanceof TypeError && /digest-pinned bzimage/.test(unpinned.message),
    "createWebComputer가 digest 없는 Node image를 등록했다");
  const sourceUnpinned = await errorOf(() => createWebComputer({
    cryptoProvider: { randomUUID: () => "source-unpinned-node-instance" },
    node: {
      V86: FixtureV86,
      manifest: { ...manifest, node: { ...manifest.node, sourceSha256: undefined } },
      loadAsset: async () => bytes,
      digestBytes,
    },
  }));
  assert(sourceUnpinned instanceof TypeError && /source revision, URL, and SHA-256/.test(sourceUnpinned.message),
    "createWebComputer가 source archive digest 없는 Node runtime을 등록했다");

  const successfulMetrics = {};
  const failedMetrics = {};
  const failingBase = createFakeGuestFactory({ adapterVersion: "boot-rollback-v1", metrics: failedMetrics });
  const transactionalBoot = createWebComputer({
    createMachines: false,
    cryptoProvider: { randomUUID: () => "transactional-boot-instance" },
    adapters: {
      successful: createFakeGuestFactory({ adapterVersion: "boot-rollback-v1", metrics: successfulMetrics }),
      failing: () => {
        const adapter = failingBase();
        adapter.boot = async () => { failedMetrics.boots += 1; throw new Error("injected asset verification failure"); };
        return adapter;
      },
    },
  });
  const successful = transactionalBoot.host.createMachine({ machineId: "successful", adapterId: "successful",
    manifest: {}, permissions: { devices: ["console"] } });
  const failing = transactionalBoot.host.createMachine({ machineId: "failing", adapterId: "failing",
    manifest: {}, permissions: { devices: ["console"] } });
  transactionalBoot.adoptMachines(new Map([[successful.machineId, successful], [failing.machineId, failing]]));
  const bootFailure = await errorOf(() => transactionalBoot.bootAll());
  assert(/injected asset verification failure/.test(bootFailure?.message || "")
    && successful.state === "stopped" && failing.state === "stopped"
    && successfulMetrics.shutdowns === 1 && failedMetrics.shutdowns === 1,
  "Web Computer 부분 boot 실패가 모든 guest를 stopped 상태로 rollback하지 않았다");

  const previousLocation = globalThis.location;
  const previousFetch = globalThis.fetch;
  let fetchCalls = 0;
  try {
    globalThis.location = { href: "https://computer.example/app", origin: "https://computer.example" };
    globalThis.fetch = async () => { fetchCalls += 1; throw new Error("cross-origin request escaped"); };
    const crossOrigin = createWebComputer({
      cryptoProvider: { randomUUID: () => "cross-origin-node-instance" },
      node: {
        V86: FixtureV86,
        manifest: { ...manifest, v86: { ...manifest.v86, assets: [fixtureDescriptor(bytes,
          { url: "https://assets.example/node.bin" })] } },
        digestBytes,
      },
    });
    const crossOriginError = await errorOf(() => crossOrigin.machine("nodeOs").boot());
    assert(crossOriginError?.code === "WEB_MACHINE_GUEST_BOOT" && fetchCalls === 0
      && /same-origin/.test(crossOriginError.details?.reason || ""),
    "기본 Node asset loader가 cross-origin 요청을 보내기 전에 닫히지 않았다");
    await crossOrigin.shutdownAll();

    const credentialUrl = createWebComputer({
      cryptoProvider: { randomUUID: () => "credential-url-node-instance" },
      node: {
        V86: FixtureV86,
        manifest: { ...manifest, v86: { ...manifest.v86, assets: [fixtureDescriptor(bytes,
          { url: "https://name:secret@computer.example/node.bin" })] } },
        digestBytes,
      },
    });
    const credentialError = await errorOf(() => credentialUrl.machine("nodeOs").boot());
    assert(credentialError?.code === "WEB_MACHINE_GUEST_BOOT" && fetchCalls === 0
      && /same-origin/.test(credentialError.details?.reason || ""),
    "기본 Node asset loader가 URL credential을 요청 전에 거부하지 않았다");
    await credentialUrl.shutdownAll();

    let streamedOptions = null;
    class StreamedNeverReadyV86 extends NeverReadyV86 {
      constructor(options) { super(); streamedOptions = options; }
    }
    let fetchOptions = null;
    globalThis.fetch = async (_url, options) => {
      fetchOptions = options;
      return ({
      ok: true,
      headers: { get: () => null },
      body: new ReadableStream({ start(controller) { controller.enqueue(bytes); controller.close(); } }),
      });
    };
    const streamed = createWebComputer({
      cryptoProvider: { randomUUID: () => "streamed-node-instance" },
      network: false,
      node: {
        V86: StreamedNeverReadyV86,
        manifest: { ...manifest, v86: { ...manifest.v86, engineTimeoutMs: 1 } },
        digestBytes,
      },
    });
    const streamedError = await errorOf(() => streamed.machine("nodeOs").boot());
    assert(streamedError?.code === "WEB_MACHINE_GUEST_TIMEOUT"
      && new Uint8Array(streamedOptions?.bzimage?.buffer || []).join(",") === bytes.join(",")
      && fetchOptions?.redirect === "error" && fetchOptions?.credentials === "omit"
      && fetchOptions?.cache === "no-store",
    `기본 Node asset loader가 Content-Length 없는 bounded stream을 검증된 engine buffer로 넘기지 않았다: ${streamedError?.code || streamedError} / ${JSON.stringify(streamedOptions?.bzimage || null)}`);
    await streamed.shutdownAll();

    globalThis.location = { href: "https://computer.example/app", origin: "https://computer.example" };
    globalThis.fetch = async () => ({
      ok: true,
      headers: { get: (name) => name === "content-length" ? String(bytes.byteLength + 1) : null },
      body: null,
    });
    const oversized = createWebComputer({
      cryptoProvider: { randomUUID: () => "oversized-node-instance" },
      node: { V86: FixtureV86, manifest, digestBytes },
    });
    const oversizedError = await errorOf(() => oversized.machine("nodeOs").boot());
    assert(oversizedError?.code === "WEB_MACHINE_GUEST_BOOT"
      && /Content-Length/.test(oversizedError.details?.reason || ""),
    "기본 Node asset loader가 선언 크기와 다른 응답을 body 할당 전에 거부하지 않았다");
    await oversized.shutdownAll();

    globalThis.fetch = async () => ({
      ok: true,
      headers: { get: (name) => name === "content-length" ? String(bytes.byteLength) : null },
      body: null,
    });
    const unstreamed = createWebComputer({
      cryptoProvider: { randomUUID: () => "unstreamed-node-instance" },
      node: { V86: FixtureV86, manifest, digestBytes },
    });
    const unstreamedError = await errorOf(() => unstreamed.machine("nodeOs").boot());
    assert(unstreamedError?.code === "WEB_MACHINE_GUEST_BOOT"
      && /readable byte stream/.test(unstreamedError.details?.reason || ""),
    "기본 Node asset loader가 상한을 적용할 수 없는 비stream 응답을 허용했다");
    await unstreamed.shutdownAll();
  } finally {
    if (previousLocation === undefined) delete globalThis.location;
    else globalThis.location = previousLocation;
    globalThis.fetch = previousFetch;
  }
}
