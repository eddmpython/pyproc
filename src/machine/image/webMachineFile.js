// webMachineFile.js - .webmachine 파일을 상태 커널의 단일 bundle 포맷(PYBUNDLE1) 위에 세운다.
//
// 봉투는 하나다: 세션 bundle과 machine envelope가 같은 wire 포맷(bundleFormat.js)을 공유하고
// meta로만 갈린다(적대 입력 파서 2벌 = 취약면 2배). machine 층은 커널을 import하지 못하므로
// (경계) 코덱은 cryptoProvider.state로 주입된다(createMachineCryptoProvider가 배달).
//
// 신뢰 계층: 신뢰 판정 = readBundleHeader + verifyTag(헤더만, payload 미접촉 = 조기 거부).
// import = decodeBundle(전 오브젝트 verify-on-read) 후 meta.machines를 읽어 검사.
//
// manifest 하위호환: 소비자(제품 inspect, probe)가 기존 WebMachineManifest 형태를 읽으므로
// bundle meta + objects에서 동등한 manifest 객체를 합성해 반환한다(payload.blobId <-> 내용주소).
//
// 구 WEBMACHINE1 포맷: 감지형 legacy reader로 읽기만 지원(일몰). writer는 bundle 단일화라
// 새 파일은 PYBUNDLE1로만 나간다. 구 fixture 호환을 위해 legacy 파싱을 함수로 보존한다.
import { operationAbortError, throwIfOperationAborted } from "../contracts/operationControl.js";
import { WebMachineError } from "../contracts/webMachineError.js";
import { createWebMachineManifest, getWebMachineManifestContent, validateWebMachineManifest, WEB_MACHINE_FORMAT, WEB_MACHINE_SCHEMA_VERSION } from "./machineManifest.js";
import {
  canonicalJson,
  copyGenerationBytes,
  digestGenerationBytes,
  digestGenerationManifest,
} from "../persistence/generationIntegrity.js";
import { fingerprintWebMachinePublicKey, verifyWebMachineTrust } from "./webMachineTrust.js";

const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8", { fatal: true });
// 구 포맷 감지 접두(일몰 대상). 새 봉투는 PYBUNDLE1이라 이 매직으로 시작하지 않는다.
const legacyMagic = encoder.encode("WEBMACHINE1\n");
const legacyHeaderLengthBytes = 4;
const legacyPrefixByteLength = legacyMagic.byteLength + legacyHeaderLengthBytes;
const legacyMaximumManifestBytes = 16 * 1024 * 1024;
const verifiedArchives = new WeakSet();

function compareNames(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function imageError(code, message, details) {
  throw new WebMachineError(code, message, details);
}

function sameBytes(left, right) {
  return left.byteLength === right.byteLength && left.every((byte, index) => byte === right[index]);
}

function assertFile(value) {
  if (!value || !Number.isSafeInteger(value.size) || typeof value.slice !== "function") {
    imageError("WEB_MACHINE_IMAGE_FORMAT_INVALID", "Blob 호환 .webmachine 파일 필요");
  }
}

function machinePayloadId(machineId) {
  return `machine/${machineId}`;
}

function devicePayloadId(name) {
  return `device/${name}`;
}

// bundle 코덱(주입)이 갖춰졌는지 확인한다. machine은 커널을 직접 import하지 못하므로
// createMachineCryptoProvider가 cryptoProvider.state로 코덱을 배달해야 한다.
function requireBundleGrammar(cryptoProvider) {
  const state = cryptoProvider?.state;
  for (const method of ["encodeBundle", "decodeBundle", "readBundleHeader", "bundleHeaderDigest", "makeTag", "verifyTag"]) {
    if (typeof state?.[method] !== "function") {
      throw new TypeError(`cryptoProvider.state.${method}가 필요하다(createMachineCryptoProvider로 감싸라)`);
    }
  }
  return state;
}

async function abortable(promise, control, label) {
  throwIfOperationAborted(control, label);
  if (!control?.signal) return promise;
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (method, value) => {
      if (settled) return;
      settled = true;
      control.signal.removeEventListener("abort", onAbort);
      method(value);
    };
    const onAbort = () => finish(reject, operationAbortError(control, label));
    control.signal.addEventListener("abort", onAbort, { once: true });
    if (control.signal.aborted) onAbort();
    Promise.resolve(promise).then((value) => finish(resolve, value), (error) => finish(reject, error));
  });
}

// bundle 층(커널)의 오류 코드를 machine 오류 계약으로 감싼다. machine은 자기 코드만 노출한다.
// integrity(봉투/verify-on-read) -> BLOB_CORRUPT, 그 밖 형식/입력 위반 -> FORMAT_INVALID.
function wrapPayloadError(error) {
  if (error instanceof WebMachineError) return error;
  const code = error?.code;
  if (code === "PYPROC_MACHINE_INTEGRITY") {
    return new WebMachineError("WEB_MACHINE_IMAGE_BLOB_CORRUPT", "image 무결성 검증 실패", { cause: String(error?.message || error) });
  }
  return new WebMachineError("WEB_MACHINE_IMAGE_FORMAT_INVALID", "image 포맷 위반", { cause: String(error?.message || error) });
}

// 헤더 판독의 오류 감싸기. 헤더 tag.target 불일치(색인/서명 대상 변조) = 서명 거부이고,
// 그 밖 형식 위반은 FORMAT_INVALID다.
function wrapHeaderError(error) {
  if (error instanceof WebMachineError) return error;
  const code = error?.code;
  if (code === "PYPROC_MACHINE_INTEGRITY") {
    return new WebMachineError("WEB_MACHINE_IMAGE_SIGNATURE_INVALID", "image 서명 대상 불일치", { cause: String(error?.message || error) });
  }
  return new WebMachineError("WEB_MACHINE_IMAGE_FORMAT_INVALID", "image 포맷 위반", { cause: String(error?.message || error) });
}

// base64 서명(tag) -> hex(WebMachineSignature v1 표기). machine 도메인의 형식 법(서명 v1은
// hex 표기)이라 여기 산다. 합성 manifest의 signature.value가 기존 형태와 바이트 동일하다.
function hexFromBase64(value) {
  let bytes;
  if (typeof atob === "function") {
    const raw = atob(value);
    bytes = new Uint8Array(raw.length);
    for (let index = 0; index < raw.length; index += 1) bytes[index] = raw.charCodeAt(index);
  } else if (typeof Buffer !== "undefined") {
    bytes = new Uint8Array(Buffer.from(value, "base64"));
  } else {
    imageError("WEB_MACHINE_IMAGE_SIGNATURE_INVALID", "base64 디코더가 없다");
  }
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

// tag(header-target 서명) -> 기존 WebMachineSignature 형태로 매핑(하위호환).
function synthesizeSignature(tag) {
  if (!tag || typeof tag !== "object" || !tag.publicKey || typeof tag.signature !== "string") {
    imageError("WEB_MACHINE_IMAGE_SIGNATURE_INVALID", "tag 형식 위반");
  }
  return {
    version: 1,
    algorithm: "ECDSA-P256-SHA256",
    publicKey: tag.publicKey,
    value: hexFromBase64(tag.signature),
  };
}

// bundle meta(서명 대상) + objects -> 기존 WebMachineManifest 형태로 합성한다. payload는
// 내용주소(payloadAddress)로 실리므로 blobId <-> 주소를 이 지점에서 다시 잇는다.
// createWebMachineManifest가 전 필드를 재검증하므로 형태 계약이 그대로 유지된다.
function synthesizeManifest(meta, resolveAddress, headerDigest, tag) {
  if (!meta || typeof meta !== "object" || meta.format !== WEB_MACHINE_FORMAT) {
    imageError("WEB_MACHINE_IMAGE_MANIFEST_INVALID", "webmachine meta 형식 위반");
  }
  if (!Array.isArray(meta.machines) || !Array.isArray(meta.devices)) {
    imageError("WEB_MACHINE_IMAGE_MANIFEST_INVALID", "webmachine meta machines/devices 형식 위반");
  }
  const blobs = [];
  const record = (blobId, address) => {
    const byteLength = resolveAddress(blobId, address);
    blobs.push({ blobId, byteLength, digest: address });
    return { blobId };
  };
  const content = {
    format: WEB_MACHINE_FORMAT,
    schemaVersion: WEB_MACHINE_SCHEMA_VERSION,
    groupId: meta.groupId,
    createdAt: meta.createdAt,
    machines: meta.machines.map((machine) => ({
      machineId: machine.machineId,
      adapterId: machine.adapterId,
      adapterVersion: machine.adapterVersion,
      snapshotScope: machine.snapshotScope,
      requiredCapabilities: machine.requiredCapabilities,
      permissions: machine.permissions,
      guestManifest: machine.guestManifest,
      payload: record(machinePayloadId(machine.machineId), machine.payloadAddress),
    })),
    devices: meta.devices.map((device) => ({
      name: device.name,
      kind: device.kind,
      byteLength: device.byteLength,
      payload: record(devicePayloadId(device.name), device.payloadAddress),
    })),
    blobs,
  };
  return createWebMachineManifest(content, {
    contentDigest: headerDigest,
    signature: synthesizeSignature(tag),
  });
}

class WebMachineArchive {
  #blobs;

  constructor(manifest, blobs, signerFingerprint) {
    this.manifest = manifest;
    this.signerFingerprint = signerFingerprint;
    this.#blobs = blobs;
    verifiedArchives.add(this);
    Object.freeze(this);
  }

  readBlob(blobId) {
    const value = this.#blobs.get(blobId);
    if (!value) imageError("WEB_MACHINE_IMAGE_BLOB_MISSING", `blob 없음: ${blobId}`);
    return value.slice();
  }
}

export function assertWebMachineArchive(value) {
  if (!verifiedArchives.has(value)) throw new TypeError("검증된 WebMachineArchive가 필요하다");
  return value;
}

export async function createWebMachineFile({
  cryptoProvider,
  groupId,
  createdAt,
  machines,
  devices = [],
  signingKeyPair,
  control,
}) {
  throwIfOperationAborted(control, "webmachine export");
  if (!signingKeyPair?.privateKey || !signingKeyPair?.publicKey) throw new TypeError("signingKeyPair가 필요하다(서명 필수)");
  const grammar = requireBundleGrammar(cryptoProvider);
  const sortedMachines = [...(machines || [])].sort((left, right) => compareNames(left.machineId, right.machineId));
  const sortedDevices = [...devices].sort((left, right) => compareNames(left.name, right.name));

  // payload를 내용주소로 봉인해 objects Map에 싣는다(동일 바이트는 자연 dedup, 색인은 blobId 유지).
  const objects = new Map();
  const blobs = [];
  const address = async (blobId, payload) => {
    const bytes = copyGenerationBytes(payload, blobId);
    const digest = await abortable(digestGenerationBytes(cryptoProvider, bytes), control, `${blobId}: digest`);
    if (!objects.has(digest)) objects.set(digest, bytes);
    blobs.push({ blobId, byteLength: bytes.byteLength, digest });
    return digest;
  };

  const machineMeta = [];
  for (const machine of sortedMachines) {
    machineMeta.push({
      machineId: machine.machineId,
      adapterId: machine.adapterId,
      adapterVersion: machine.adapterVersion,
      snapshotScope: machine.snapshotScope,
      requiredCapabilities: machine.requiredCapabilities,
      permissions: machine.permissions,
      guestManifest: machine.guestManifest,
      payloadAddress: await address(machinePayloadId(machine.machineId), machine.payload),
    });
  }
  const deviceMeta = [];
  for (const device of sortedDevices) {
    deviceMeta.push({
      name: device.name,
      kind: device.kind,
      byteLength: device.byteLength,
      payloadAddress: await address(devicePayloadId(device.name), device.payload),
    });
  }

  const meta = {
    format: WEB_MACHINE_FORMAT,
    schemaVersion: WEB_MACHINE_SCHEMA_VERSION,
    groupId,
    createdAt,
    machines: machineMeta,
    devices: deviceMeta,
  };

  // 서명 대상 = 헤더 다이제스트(meta + 오브젝트 색인). meta가 machine 레코드(권한/능력/
  // guestManifest 출처)를 싣고 헤더에 실리므로 서명이 그 전부를 봉인한다(조기 거부의 근거).
  const headerDigest = await abortable(grammar.bundleHeaderDigest({ meta, objects }), control, "webmachine header digest");
  const publicJwk = await abortable(cryptoProvider.exportPublicJwk(signingKeyPair.publicKey), control, "webmachine public key");
  const tag = await abortable(grammar.makeTag(signingKeyPair.privateKey, publicJwk, headerDigest), control, "webmachine tag");
  const bytes = await abortable(grammar.encodeBundle({ meta, objects, tag }), control, "webmachine encode");

  // 합성 manifest(하위호환): payload byteLength는 방금 쓴 blobs 색인이 정본이다.
  const byName = new Map(blobs.map((blob) => [blob.blobId, blob.byteLength]));
  const manifest = synthesizeManifest(meta, (blobId) => {
    const byteLength = byName.get(blobId);
    if (byteLength === undefined) imageError("WEB_MACHINE_IMAGE_MANIFEST_INVALID", `blob 색인 누락: ${blobId}`);
    return byteLength;
  }, headerDigest, tag);

  return Object.freeze({ file: new Blob([bytes], { type: "application/x-webmachine" }), manifest });
}

export async function readWebMachineFile({ file, cryptoProvider, trustedPublicKeys, control }) {
  throwIfOperationAborted(control, "webmachine import");
  assertFile(file);
  const grammar = requireBundleGrammar(cryptoProvider);
  // 접두 조각을 abortable read로 공급한다: 지연 file read도 control로 즉시 탈출한다.
  const readSlice = (start, end) => abortable(
    file.slice(start, end).arrayBuffer().then((buffer) => new Uint8Array(buffer)),
    control,
    "webmachine header read",
  );

  // 헤더만 읽어 payload 접촉 전 신뢰 판정(조기 거부). 구 WEBMACHINE1은 감지형 legacy로 위임.
  let header;
  try {
    header = await grammar.readBundleHeader({ read: readSlice });
  } catch (error) {
    if (control?.signal?.aborted) throw error;
    if (file.size >= legacyMagic.byteLength) {
      const head = await readSlice(0, legacyMagic.byteLength);
      if (sameBytes(head, legacyMagic)) return readLegacyWebMachineFile({ file, cryptoProvider, trustedPublicKeys, control });
    }
    throw wrapHeaderError(error);
  }

  if (!header.tag) imageError("WEB_MACHINE_IMAGE_UNTRUSTED", "서명 없는 image 실행 거부");
  const verdict = await abortable(
    grammar.verifyTag(header.tag, header.headerDigest, { trustedPublicKeys: trustedPublicKeys || [] }),
    control,
    "webmachine trust verify",
  );
  if (!verdict.valid) imageError("WEB_MACHINE_IMAGE_SIGNATURE_INVALID", "image 서명 불일치");
  if (!verdict.trusted) imageError("WEB_MACHINE_IMAGE_UNTRUSTED", `trusted key에 없는 signer: ${verdict.signerFingerprint}`);

  // 신뢰됨: 전량 verify-on-read로 오브젝트를 회수한다(통과 못 한 바이트는 소비자에 안 닿는다).
  const buffer = new Uint8Array(await abortable(file.arrayBuffer(), control, "webmachine payload read"));
  let decoded;
  try {
    decoded = await grammar.decodeBundle(buffer);
  } catch (error) {
    if (control?.signal?.aborted) throw error;
    throw wrapPayloadError(error);
  }

  const blobsById = new Map();
  const manifest = synthesizeManifest(decoded.meta, (blobId, digest) => {
    const bytes = decoded.objects.get(digest);
    if (!bytes) imageError("WEB_MACHINE_IMAGE_MANIFEST_INVALID", `payload 주소가 objects에 없다: ${blobId}`);
    blobsById.set(blobId, bytes);
    return bytes.byteLength;
  }, decoded.headerDigest, decoded.tag);

  // 반환 지문은 machine 도메인 규약(fingerprintWebMachinePublicKey)을 유지한다: 소비자가
  // 신뢰 목록에 박아둔 공개 값이라 규약이 바뀌면 목록이 무효화된다.
  const signerFingerprint = await abortable(
    fingerprintWebMachinePublicKey(cryptoProvider, header.tag.publicKey),
    control,
    "webmachine signer fingerprint",
  );
  return new WebMachineArchive(manifest, blobsById, signerFingerprint);
}

// ─── 구 WEBMACHINE1 포맷 legacy reader(일몰) ───
// writer는 bundle로 단일화됐고 이 경로는 구 fixture를 읽기만 한다. 새 봉투는 이 함수에
// 닿지 않는다(감지형 dispatch). 신 포맷이 자리 잡으면 제거한다.
async function readLegacyWebMachineFile({ file, cryptoProvider, trustedPublicKeys, control }) {
  if (file.size < legacyPrefixByteLength) imageError("WEB_MACHINE_IMAGE_FORMAT_INVALID", "file prefix가 잘림");
  const prefix = new Uint8Array(await abortable(file.slice(0, legacyPrefixByteLength).arrayBuffer(), control, "webmachine prefix read"));
  if (!sameBytes(prefix.subarray(0, legacyMagic.byteLength), legacyMagic)) {
    imageError("WEB_MACHINE_IMAGE_FORMAT_INVALID", "WEBMACHINE magic 불일치");
  }
  const manifestByteLength = new DataView(prefix.buffer, prefix.byteOffset + legacyMagic.byteLength, legacyHeaderLengthBytes).getUint32(0, false);
  if (!manifestByteLength || manifestByteLength > legacyMaximumManifestBytes || legacyPrefixByteLength + manifestByteLength > file.size) {
    imageError("WEB_MACHINE_IMAGE_FORMAT_INVALID", "manifest byteLength 불일치");
  }
  const manifestBytes = new Uint8Array(await abortable(
    file.slice(legacyPrefixByteLength, legacyPrefixByteLength + manifestByteLength).arrayBuffer(),
    control,
    "webmachine manifest read",
  ));
  let manifestText;
  let parsed;
  try {
    manifestText = decoder.decode(manifestBytes);
    parsed = JSON.parse(manifestText);
  } catch (cause) {
    imageError("WEB_MACHINE_IMAGE_MANIFEST_INVALID", "manifest JSON 해석 실패", { cause: String(cause) });
  }
  const manifest = validateWebMachineManifest(parsed);
  if (manifestText !== canonicalJson(manifest)) imageError("WEB_MACHINE_IMAGE_MANIFEST_INVALID", "manifest canonical encoding 불일치");
  const contentDigest = await abortable(
    digestGenerationManifest(cryptoProvider, getWebMachineManifestContent(manifest)),
    control,
    "webmachine manifest verify",
  );
  if (contentDigest !== manifest.integrity.contentDigest) {
    imageError("WEB_MACHINE_IMAGE_INTEGRITY_INVALID", "manifest content digest 불일치");
  }
  const trust = await abortable(
    verifyWebMachineTrust(cryptoProvider, contentDigest, manifest.signature, trustedPublicKeys),
    control,
    "webmachine trust verify",
  );

  const payloadByteLength = manifest.blobs.reduce((total, blob) => total + blob.byteLength, 0);
  const expectedFileSize = legacyPrefixByteLength + manifestByteLength + payloadByteLength;
  if (!Number.isSafeInteger(expectedFileSize) || expectedFileSize !== file.size) {
    imageError("WEB_MACHINE_IMAGE_FORMAT_INVALID", `file byteLength 불일치: ${file.size} != ${expectedFileSize}`);
  }
  const blobs = new Map();
  let offset = legacyPrefixByteLength + manifestByteLength;
  for (const reference of manifest.blobs) {
    throwIfOperationAborted(control, "webmachine blob verify");
    const bytes = new Uint8Array(await abortable(
      file.slice(offset, offset + reference.byteLength).arrayBuffer(),
      control,
      `${reference.blobId}: read`,
    ));
    const digest = await abortable(
      digestGenerationBytes(cryptoProvider, bytes),
      control,
      `${reference.blobId}: verify`,
    );
    if (bytes.byteLength !== reference.byteLength || digest !== reference.digest) {
      imageError("WEB_MACHINE_IMAGE_BLOB_CORRUPT", `blob 무결성 불일치: ${reference.blobId}`);
    }
    blobs.set(reference.blobId, bytes);
    offset += reference.byteLength;
  }
  return new WebMachineArchive(manifest, blobs, trust.signerFingerprint);
}
