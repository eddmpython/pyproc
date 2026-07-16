// webMachineFile.js - canonical manifest와 연속 blob으로 구성된 .webmachine 파일.
import {
  createWebMachineManifest,
  createWebMachineManifestContent,
  getWebMachineManifestContent,
  validateWebMachineManifest,
  WebMachineError,
  WEB_MACHINE_FORMAT,
  WEB_MACHINE_SCHEMA_VERSION,
  operationAbortError,
  throwIfOperationAborted,
} from "@web-machine/core";
import {
  canonicalJson,
  copyGenerationBytes,
  digestGenerationBytes,
  digestGenerationManifest,
} from "../persistence/generationIntegrity.js";
import { signWebMachineContent, verifyWebMachineTrust } from "./webMachineTrust.js";

const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8", { fatal: true });
const magic = encoder.encode("WEBMACHINE1\n");
const headerLengthBytes = 4;
const prefixByteLength = magic.byteLength + headerLengthBytes;
const maximumManifestBytes = 16 * 1024 * 1024;
const verifiedArchives = new WeakSet();

function compareNames(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function imageError(code, message, details) {
  throw new WebMachineError(code, message, details);
}

function headerLengthPrefix(byteLength) {
  const bytes = new Uint8Array(headerLengthBytes);
  new DataView(bytes.buffer).setUint32(0, byteLength, false);
  return bytes;
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

async function payloadRecord(cryptoProvider, blobId, value, control) {
  const bytes = copyGenerationBytes(value, blobId);
  return {
    blob: {
      blobId,
      byteLength: bytes.byteLength,
      digest: await abortable(digestGenerationBytes(cryptoProvider, bytes), control, `${blobId}: digest`),
    },
    bytes,
  };
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
  const sortedMachines = [...(machines || [])].sort((left, right) => compareNames(left.machineId, right.machineId));
  const sortedDevices = [...devices].sort((left, right) => compareNames(left.name, right.name));
  const machinePayloads = await Promise.all(sortedMachines.map((machine) => payloadRecord(
    cryptoProvider,
    machinePayloadId(machine.machineId),
    machine.payload,
    control,
  )));
  const devicePayloads = await Promise.all(sortedDevices.map((device) => payloadRecord(
    cryptoProvider,
    devicePayloadId(device.name),
    device.payload,
    control,
  )));
  const payloads = [...machinePayloads, ...devicePayloads].sort((left, right) => compareNames(left.blob.blobId, right.blob.blobId));
  const content = createWebMachineManifestContent({
    format: WEB_MACHINE_FORMAT,
    schemaVersion: WEB_MACHINE_SCHEMA_VERSION,
    groupId,
    createdAt,
    machines: sortedMachines.map((machine) => ({
      machineId: machine.machineId,
      adapterId: machine.adapterId,
      adapterVersion: machine.adapterVersion,
      snapshotScope: machine.snapshotScope,
      requiredCapabilities: machine.requiredCapabilities,
      permissions: machine.permissions,
      guestManifest: machine.guestManifest,
      payload: { blobId: machinePayloadId(machine.machineId) },
    })),
    devices: sortedDevices.map((device) => ({
      name: device.name,
      kind: device.kind,
      byteLength: device.byteLength,
      payload: { blobId: devicePayloadId(device.name) },
    })),
    blobs: payloads.map(({ blob }) => blob),
  });
  const contentDigest = await abortable(digestGenerationManifest(cryptoProvider, content), control, "webmachine manifest digest");
  const signature = await abortable(signWebMachineContent(cryptoProvider, contentDigest, signingKeyPair), control, "webmachine signature");
  const manifest = createWebMachineManifest(content, { contentDigest, signature });
  const headerBytes = encoder.encode(canonicalJson(manifest));
  if (headerBytes.byteLength > maximumManifestBytes) {
    imageError("WEB_MACHINE_IMAGE_MANIFEST_INVALID", `manifest가 ${maximumManifestBytes} bytes를 초과`);
  }
  const bytesById = new Map(payloads.map((entry) => [entry.blob.blobId, entry.bytes]));
  const file = new Blob([
    magic,
    headerLengthPrefix(headerBytes.byteLength),
    headerBytes,
    ...manifest.blobs.map((blob) => bytesById.get(blob.blobId)),
  ], { type: "application/x-webmachine" });
  return Object.freeze({ file, manifest });
}

export async function readWebMachineFile({ file, cryptoProvider, trustedPublicKeys, control }) {
  throwIfOperationAborted(control, "webmachine import");
  assertFile(file);
  if (file.size < prefixByteLength) imageError("WEB_MACHINE_IMAGE_FORMAT_INVALID", "file prefix가 잘림");
  const prefix = new Uint8Array(await abortable(file.slice(0, prefixByteLength).arrayBuffer(), control, "webmachine prefix read"));
  if (!sameBytes(prefix.subarray(0, magic.byteLength), magic)) {
    imageError("WEB_MACHINE_IMAGE_FORMAT_INVALID", "WEBMACHINE magic 불일치");
  }
  const manifestByteLength = new DataView(prefix.buffer, prefix.byteOffset + magic.byteLength, headerLengthBytes).getUint32(0, false);
  if (!manifestByteLength || manifestByteLength > maximumManifestBytes || prefixByteLength + manifestByteLength > file.size) {
    imageError("WEB_MACHINE_IMAGE_FORMAT_INVALID", "manifest byteLength 불일치");
  }
  const manifestBytes = new Uint8Array(await abortable(
    file.slice(prefixByteLength, prefixByteLength + manifestByteLength).arrayBuffer(),
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
  const expectedFileSize = prefixByteLength + manifestByteLength + payloadByteLength;
  if (!Number.isSafeInteger(expectedFileSize) || expectedFileSize !== file.size) {
    imageError("WEB_MACHINE_IMAGE_FORMAT_INVALID", `file byteLength 불일치: ${file.size} != ${expectedFileSize}`);
  }
  const blobs = new Map();
  let offset = prefixByteLength + manifestByteLength;
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
