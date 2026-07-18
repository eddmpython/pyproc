// machineCommitCoordinator.js - paused guest snapshot과 flushed device를 한 CAS generation으로 commit한다.
//
// 재기초(kernel-product P2): generation은 이제 machine의 자기 manifest가 아니라 상태 커널의
// 오브젝트다. 스냅샷 payload = blob, 머신·장치의 도메인 기술 = payloadTree 엔트리 meta,
// generation 정체 = commit(parents = 직전 generation, fence = owner epoch). generationId는
// commit 주소 자신이라 정체성 대조가 주소 대조로 환원된다. store의 단일 트랜잭션
// CAS(owner + expectedHead)는 backend 원자성으로 그대로 남고(원자성은 backend 책임),
// 저장·무결성 판정은 커널 문법(주입: cryptoProvider.state)이 한다. record에는 gc 색인
// (blobDigests)만 남는다 - 복원은 색인을 신뢰하지 않고 commit 체인을 걷는다.
import { throwIfOperationAborted } from "../contracts/operationControl.js";
import { WebMachineError } from "../contracts/webMachineError.js";
import { copyGenerationBytes } from "./generationIntegrity.js";

export const GENERATION_SCHEMA_VERSION = 2;

const RECOVERABLE_CODES = new Set([
  "WEB_MACHINE_BLOB_MISSING",
  "WEB_MACHINE_GENERATION_CORRUPT",
  "WEB_MACHINE_GENERATION_MISSING",
]);

function lookup(collection, key) {
  return collection instanceof Map ? collection.get(key) : collection?.[key];
}

function sortedMachines(machines) {
  return [...machines].sort((left, right) => left.machineId.localeCompare(right.machineId));
}

function sortedDevices(devices) {
  return Object.entries(devices).sort(([left], [right]) => left.localeCompare(right));
}

function generationCorrupt(groupId, detail) {
  return new WebMachineError("WEB_MACHINE_GENERATION_CORRUPT", `${groupId}: ${detail}`);
}

export class MachineCommitCoordinator {
  constructor({ store, cryptoProvider, idFactory, nowFactory }) {
    if (!store) throw new TypeError("store가 필요하다");
    // digest·커널 문법은 코어 한 벌이다: 조립은 createMachineCryptoProvider가 배달한다(맨 Crypto 거부).
    if (typeof cryptoProvider?.digestBytes !== "function") throw new TypeError("cryptoProvider.digestBytes가 필요하다(createMachineCryptoProvider로 감싸라)");
    if (typeof cryptoProvider?.state?.makeStateCommit !== "function") throw new TypeError("cryptoProvider.state(커널 문법)가 필요하다(createMachineCryptoProvider로 감싸라)");
    if (typeof idFactory !== "function") throw new TypeError("idFactory가 필요하다");
    if (typeof nowFactory !== "function") throw new TypeError("nowFactory가 필요하다");
    this._store = store;
    this._cryptoProvider = cryptoProvider;
    this._idFactory = idFactory; // generation 정체는 commit 주소가 대체했지만, 시그니처 계약은 유지한다
    this._nowFactory = nowFactory;
  }

  async readHead(groupId) {
    return this._store.readHead(groupId);
  }

  async commitPaused({ groupId, machines, devices = {}, expectedHead, ownerToken, control }) {
    if (!groupId) throw new TypeError("groupId가 필요하다");
    if (expectedHead === undefined) throw new TypeError("expectedHead가 필요하다");
    if (!ownerToken) throw new TypeError("ownerToken이 필요하다");
    throwIfOperationAborted(control, `${groupId}: paused commit`);
    const machineList = sortedMachines(machines || []);
    if (!machineList.length) throw new TypeError("machines가 필요하다");
    for (const machine of machineList) {
      if (machine.state !== "paused") {
        throw new WebMachineError("WEB_MACHINE_COMMIT_STATE", `${machine.machineId}: paused commit만 허용`);
      }
    }
    const deviceEntries = sortedDevices(devices);
    for (const [name, device] of deviceEntries) this._assertBlockDevice(name, device);

    await Promise.all(deviceEntries.map(([, device]) => device.flush()));
    throwIfOperationAborted(control, `${groupId}: paused commit`);
    const [machineSnapshots, deviceSnapshots] = await Promise.all([
      Promise.all(machineList.map((machine) => machine.snapshot(control))),
      Promise.all(deviceEntries.map(async ([name, device]) => ({ name, device, payload: await device.snapshot() }))),
    ]);
    throwIfOperationAborted(control, `${groupId}: paused commit`);

    const grammar = this._cryptoProvider.state;
    const blobs = new Map();
    const putBlob = async (bytes) => {
      const address = await this._cryptoProvider.digestBytes(bytes);
      if (!blobs.has(address)) blobs.set(address, bytes);
      return address;
    };
    const entries = [];
    for (const snapshot of machineSnapshots) {
      const bytes = copyGenerationBytes(snapshot.payload);
      entries.push({
        id: `machine/${snapshot.machineId}`,
        address: await putBlob(bytes),
        byteLength: bytes.byteLength,
        meta: {
          machineId: snapshot.machineId,
          adapterId: snapshot.adapterId,
          adapterVersion: snapshot.adapterVersion,
          snapshotScope: snapshot.snapshotScope,
          originInstanceId: snapshot.originInstanceId,
        },
      });
    }
    for (const { name, device, payload } of deviceSnapshots) {
      const bytes = copyGenerationBytes(payload);
      entries.push({
        id: `device/${name}`,
        address: await putBlob(bytes),
        byteLength: bytes.byteLength,
        meta: { name, kind: device.kind, byteLength: device.byteLength },
      });
    }
    throwIfOperationAborted(control, `${groupId}: paused commit`);

    const tree = grammar.makePayloadTree({ entries });
    const treeAddress = await putBlob(grammar.encodeObject(tree));
    const commit = grammar.makeStateCommit({
      parents: expectedHead ? [expectedHead] : [],
      tree: treeAddress,
      env: {},
      fence: { ownerId: ownerToken.ownerId, epoch: ownerToken.epoch },
      createdAt: String(Number(this._nowFactory())),
    });
    const commitAddress = await putBlob(grammar.encodeObject(commit));
    // record = 저장소 지역 색인(gc의 도달 집합). 정본은 commit 체인이고 복원은 색인을 안 믿는다.
    const record = { schemaVersion: GENERATION_SCHEMA_VERSION, commitAddress, blobDigests: [...blobs.keys()].sort() };
    const head = await this._store.commitGeneration({
      groupId,
      generationId: commitAddress,
      expectedHead,
      ownerToken,
      blobs: [...blobs].map(([digest, bytes]) => ({ digest, bytes })),
      record,
      control,
    });
    return { schemaVersion: GENERATION_SCHEMA_VERSION, commitAddress, commit, entries: tree.entries, record, head };
  }

  async restoreLatest({ groupId, machines, devices = {}, control }) {
    throwIfOperationAborted(control, `${groupId}: restore latest`);
    const head = await this._store.readHead(groupId);
    if (!head?.head) throw new WebMachineError("WEB_MACHINE_RECOVERY_EMPTY", `${groupId}: HEAD 없음`);
    const failures = [];
    for (const generationId of [head.head, head.prev].filter(Boolean)) {
      let verified;
      try {
        verified = await this._readVerifiedGeneration(groupId, generationId, control);
      } catch (error) {
        if (!RECOVERABLE_CODES.has(error?.code)) throw error;
        failures.push({ generationId, code: error.code });
        continue;
      }
      await this._applyGeneration(groupId, verified, machines, devices, control);
      return {
        generationId,
        recoveredFrom: generationId === head.head ? null : head.head,
        failures,
        commit: verified.commit,
        // 도메인 요약(payload 바이트 제외): 관측·게이트용. 정본은 commit 체인이다.
        machines: verified.machines.map(({ payload, ...meta }) => meta),
        devices: verified.devices.map(({ payload, ...meta }) => meta),
      };
    }
    throw new WebMachineError("WEB_MACHINE_RECOVERY_UNAVAILABLE", `${groupId}: HEAD/PREV 복구 실패`, { failures });
  }

  async pruneRecoveryWindow({ groupId, ownerToken, control }) {
    if (typeof this._store.pruneRecoveryWindow !== "function") throw new TypeError("store.pruneRecoveryWindow()이 필요하다");
    return this._store.pruneRecoveryWindow({ groupId, ownerToken, control });
  }

  async dryRunRecoveryWindow({ groupId, ownerToken }) {
    if (typeof this._store.dryRunRecoveryWindow !== "function") throw new TypeError("store.dryRunRecoveryWindow()이 필요하다");
    return this._store.dryRunRecoveryWindow({ groupId, ownerToken });
  }

  async inspectStorage() {
    if (typeof this._store.inspectStorage !== "function") throw new TypeError("store.inspectStorage()이 필요하다");
    return this._store.inspectStorage();
  }

  // blob을 읽어 내용주소를 재대조한다(verify-on-read). 없음(BLOB_MISSING)은 store가 던진다.
  async _verifiedBlob(groupId, address, label) {
    const bytes = await this._store.getBlob(address);
    if (await this._cryptoProvider.digestBytes(bytes) !== address) {
      throw generationCorrupt(groupId, `${label} digest 불일치(${address.slice(0, 20)}..)`);
    }
    return bytes;
  }

  // 커널 문법의 형식 오류(PyProcError 계열)는 machine 계약으로 감싼다: 저장소에서 온
  // 파손은 이 층에서 GENERATION_CORRUPT다.
  _decodeAs(groupId, validate, bytes, label) {
    const grammar = this._cryptoProvider.state;
    try { return validate(grammar.decodeObject(bytes)); }
    catch (error) {
      throw generationCorrupt(groupId, `${label} 형식 파손(${String(error?.message || error).slice(-160)})`);
    }
  }

  async _readVerifiedGeneration(groupId, generationId, control) {
    throwIfOperationAborted(control, `${groupId}: verify generation`);
    const grammar = this._cryptoProvider.state;
    const record = await this._store.readGeneration(groupId, generationId);
    if (record?.schemaVersion !== GENERATION_SCHEMA_VERSION || record?.commitAddress !== generationId) {
      throw generationCorrupt(groupId, `generation 정체 불일치 ${generationId}(schemaVersion ${record?.schemaVersion})`);
    }
    const commit = this._decodeAs(groupId, grammar.validateStateCommit,
      await this._verifiedBlob(groupId, generationId, "commit"), "commit");
    const tree = this._decodeAs(groupId, grammar.validateStateTree,
      await this._verifiedBlob(groupId, commit.tree, "tree"), "tree");
    if (tree.kind !== "payload") throw generationCorrupt(groupId, `payload tree가 아니다(${tree.kind})`);
    const machineEntries = [];
    const deviceEntries = [];
    for (const entry of tree.entries) {
      throwIfOperationAborted(control, `${groupId}: verify generation`);
      const bytes = await this._verifiedBlob(groupId, entry.address, entry.id);
      if (bytes.byteLength !== entry.byteLength) throw generationCorrupt(groupId, `${entry.id} 길이 불일치`);
      if (entry.id.startsWith("machine/")) {
        if (typeof entry.meta?.machineId !== "string") throw generationCorrupt(groupId, `${entry.id} meta 파손`);
        machineEntries.push({ ...entry.meta, payload: bytes });
      } else if (entry.id.startsWith("device/")) {
        if (typeof entry.meta?.name !== "string") throw generationCorrupt(groupId, `${entry.id} meta 파손`);
        deviceEntries.push({ ...entry.meta, payload: bytes });
      } else {
        throw generationCorrupt(groupId, `알 수 없는 엔트리(${entry.id})`);
      }
    }
    if (!machineEntries.length) throw generationCorrupt(groupId, "machine 엔트리가 없다");
    return { commit, machines: machineEntries, devices: deviceEntries };
  }

  async _applyGeneration(groupId, verified, machines, devices, control) {
    for (const entry of verified.devices) {
      throwIfOperationAborted(control, `${groupId}: restore generation`);
      const device = lookup(devices, entry.name);
      if (!device) throw new WebMachineError("WEB_MACHINE_RESTORE_TARGET_MISSING", `device target 없음: ${entry.name}`);
      this._assertBlockDevice(entry.name, device);
      if (device.byteLength !== entry.byteLength) {
        throw new WebMachineError("WEB_MACHINE_BLOCK_SIZE", `${entry.name}: block 크기 불일치`);
      }
      await device.restore(entry.payload);
    }
    for (const entry of verified.machines) {
      throwIfOperationAborted(control, `${groupId}: restore generation`);
      const machine = lookup(machines, entry.machineId);
      if (!machine) throw new WebMachineError("WEB_MACHINE_RESTORE_TARGET_MISSING", `machine target 없음: ${entry.machineId}`);
      await machine.restore({
        schemaVersion: 1,
        machineId: entry.machineId,
        adapterId: entry.adapterId,
        adapterVersion: entry.adapterVersion,
        snapshotScope: entry.snapshotScope,
        originInstanceId: entry.originInstanceId,
        payload: entry.payload,
      }, control);
    }
  }

  _assertBlockDevice(name, device) {
    if (!device || device.kind !== "block") throw new WebMachineError("WEB_MACHINE_DEVICE_KIND_UNSUPPORTED", `${name}: block device 필요`);
    for (const method of ["flush", "snapshot", "restore"]) {
      if (typeof device[method] !== "function") throw new WebMachineError("WEB_MACHINE_DEVICE_INVALID", `${name}: ${method}() 없음`);
    }
  }
}
