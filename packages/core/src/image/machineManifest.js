// machineManifest.js - 이동 가능한 머신 이미지의 순수 구조와 불변식.
import { isSnapshotScope } from "./snapshotEnvelope.js";
import { WebMachineError } from "../contracts/webMachineError.js";

export const WEB_MACHINE_FORMAT = "webmachine";
export const WEB_MACHINE_SCHEMA_VERSION = 1;

const digestPattern = /^sha256:[0-9a-f]{64}$/;
const hexPattern = /^(?:[0-9a-f]{2})+$/;

function compareNames(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function invalid(message, details) {
  throw new WebMachineError("WEB_MACHINE_IMAGE_MANIFEST_INVALID", message, details);
}

function assertExactKeys(value, expected, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) invalid(`${label}: object 필요`);
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (actual.length !== wanted.length || actual.some((key, index) => key !== wanted[index])) {
    invalid(`${label}: key 불일치`, { actual, expected: wanted });
  }
}

function requiredString(value, label) {
  if (typeof value !== "string" || !value || value.length > 256) invalid(`${label}: 비어 있지 않은 문자열 필요`);
  return value;
}

function safeInteger(value, label, minimum = 0) {
  if (!Number.isSafeInteger(value) || value < minimum) invalid(`${label}: ${minimum} 이상 안전한 정수 필요`);
  return value;
}

function stringList(value, label) {
  if (!Array.isArray(value)) invalid(`${label}: 배열 필요`);
  const normalized = value.map((entry, index) => requiredString(entry, `${label}[${index}]`));
  if (new Set(normalized).size !== normalized.length) invalid(`${label}: 중복 금지`);
  return normalized.sort(compareNames);
}

function jsonValue(value, label) {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) invalid(`${label}: finite number 필요`);
    return value;
  }
  if (Array.isArray(value)) return value.map((entry, index) => jsonValue(entry, `${label}[${index}]`));
  if (value && typeof value === "object") {
    const normalized = {};
    for (const key of Object.keys(value).sort()) normalized[key] = jsonValue(value[key], `${label}.${key}`);
    return normalized;
  }
  invalid(`${label}: JSON value만 허용`);
}

function payloadReference(value, label) {
  assertExactKeys(value, ["blobId"], label);
  return { blobId: requiredString(value.blobId, `${label}.blobId`) };
}

function machineRecord(value, index) {
  const label = `machines[${index}]`;
  assertExactKeys(value, [
    "machineId",
    "adapterId",
    "adapterVersion",
    "snapshotScope",
    "requiredCapabilities",
    "permissions",
    "guestManifest",
    "payload",
  ], label);
  if (!isSnapshotScope(value.snapshotScope) || value.snapshotScope !== "portable") {
    invalid(`${label}.snapshotScope: portable만 허용`);
  }
  assertExactKeys(value.permissions, ["devices"], `${label}.permissions`);
  const guestManifest = jsonValue(value.guestManifest, `${label}.guestManifest`);
  if (!guestManifest || Array.isArray(guestManifest) || typeof guestManifest !== "object") {
    invalid(`${label}.guestManifest: object 필요`);
  }
  return {
    machineId: requiredString(value.machineId, `${label}.machineId`),
    adapterId: requiredString(value.adapterId, `${label}.adapterId`),
    adapterVersion: requiredString(value.adapterVersion, `${label}.adapterVersion`),
    snapshotScope: value.snapshotScope,
    requiredCapabilities: stringList(value.requiredCapabilities, `${label}.requiredCapabilities`),
    permissions: { devices: stringList(value.permissions.devices, `${label}.permissions.devices`) },
    guestManifest,
    payload: payloadReference(value.payload, `${label}.payload`),
  };
}

function deviceRecord(value, index) {
  const label = `devices[${index}]`;
  assertExactKeys(value, ["name", "kind", "byteLength", "payload"], label);
  if (value.kind !== "block") invalid(`${label}.kind: block만 허용`);
  return {
    name: requiredString(value.name, `${label}.name`),
    kind: value.kind,
    byteLength: safeInteger(value.byteLength, `${label}.byteLength`, 1),
    payload: payloadReference(value.payload, `${label}.payload`),
  };
}

function blobRecord(value, index) {
  const label = `blobs[${index}]`;
  assertExactKeys(value, ["blobId", "byteLength", "digest"], label);
  if (typeof value.digest !== "string" || !digestPattern.test(value.digest)) invalid(`${label}.digest: SHA-256 형식 불일치`);
  return {
    blobId: requiredString(value.blobId, `${label}.blobId`),
    byteLength: safeInteger(value.byteLength, `${label}.byteLength`),
    digest: value.digest,
  };
}

function unique(records, key, label) {
  const values = records.map((record) => record[key]);
  if (new Set(values).size !== values.length) invalid(`${label}: 중복 금지`);
}

function normalizeContent(value) {
  assertExactKeys(value, ["format", "schemaVersion", "groupId", "createdAt", "machines", "devices", "blobs"], "image content");
  if (value.format !== WEB_MACHINE_FORMAT) invalid(`format 불일치: ${value.format}`);
  if (value.schemaVersion !== WEB_MACHINE_SCHEMA_VERSION) invalid(`schemaVersion 불일치: ${value.schemaVersion}`);
  if (!Array.isArray(value.machines) || !value.machines.length) invalid("machines: 하나 이상 필요");
  if (!Array.isArray(value.devices)) invalid("devices: 배열 필요");
  if (!Array.isArray(value.blobs)) invalid("blobs: 배열 필요");
  const machines = value.machines.map(machineRecord).sort((left, right) => compareNames(left.machineId, right.machineId));
  const devices = value.devices.map(deviceRecord).sort((left, right) => compareNames(left.name, right.name));
  const blobs = value.blobs.map(blobRecord).sort((left, right) => compareNames(left.blobId, right.blobId));
  unique(machines, "machineId", "machineId");
  unique(devices, "name", "device name");
  unique(blobs, "blobId", "blobId");
  const blobIds = new Set(blobs.map((blob) => blob.blobId));
  const references = [
    ...machines.map((machine) => machine.payload.blobId),
    ...devices.map((device) => device.payload.blobId),
  ];
  if (new Set(references).size !== references.length) invalid("payload blob은 하나의 record만 소유해야 한다");
  if (references.length !== blobs.length || references.some((blobId) => !blobIds.has(blobId))) {
    invalid("payload reference와 blobs가 일대일이어야 한다");
  }
  for (const device of devices) {
    const blob = blobs.find((entry) => entry.blobId === device.payload.blobId);
    if (blob.byteLength !== device.byteLength) invalid(`${device.name}: block byteLength와 blob 불일치`);
  }
  return {
    format: WEB_MACHINE_FORMAT,
    schemaVersion: WEB_MACHINE_SCHEMA_VERSION,
    groupId: requiredString(value.groupId, "groupId"),
    createdAt: safeInteger(value.createdAt, "createdAt"),
    machines,
    devices,
    blobs,
  };
}

function normalizeSignature(value) {
  assertExactKeys(value, ["version", "algorithm", "publicKey", "value"], "signature");
  if (value.version !== 1 || value.algorithm !== "ECDSA-P256-SHA256") invalid("signature algorithm 불일치");
  assertExactKeys(value.publicKey, ["kty", "crv", "x", "y"], "signature.publicKey");
  if (value.publicKey.kty !== "EC" || value.publicKey.crv !== "P-256") invalid("signature.publicKey curve 불일치");
  for (const coordinate of ["x", "y"]) requiredString(value.publicKey[coordinate], `signature.publicKey.${coordinate}`);
  if (typeof value.value !== "string" || !hexPattern.test(value.value)) invalid("signature.value: hex bytes 필요");
  return {
    version: 1,
    algorithm: value.algorithm,
    publicKey: { kty: "EC", crv: "P-256", x: value.publicKey.x, y: value.publicKey.y },
    value: value.value,
  };
}

function freezeTree(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const entry of Object.values(value)) freezeTree(entry);
  return Object.freeze(value);
}

export function createWebMachineManifestContent(value) {
  return freezeTree(normalizeContent(value));
}

export function createWebMachineManifest(content, { contentDigest, signature }) {
  const normalizedContent = normalizeContent(content);
  if (typeof contentDigest !== "string" || !digestPattern.test(contentDigest)) invalid("integrity.contentDigest: SHA-256 형식 불일치");
  const manifest = {
    ...normalizedContent,
    integrity: { algorithm: "SHA-256", contentDigest },
    signature: normalizeSignature(signature),
  };
  return freezeTree(manifest);
}

export function validateWebMachineManifest(value) {
  assertExactKeys(value, [
    "format",
    "schemaVersion",
    "groupId",
    "createdAt",
    "machines",
    "devices",
    "blobs",
    "integrity",
    "signature",
  ], "image manifest");
  assertExactKeys(value.integrity, ["algorithm", "contentDigest"], "integrity");
  if (value.integrity.algorithm !== "SHA-256") invalid("integrity.algorithm 불일치");
  const content = {
    format: value.format,
    schemaVersion: value.schemaVersion,
    groupId: value.groupId,
    createdAt: value.createdAt,
    machines: value.machines,
    devices: value.devices,
    blobs: value.blobs,
  };
  return createWebMachineManifest(content, {
    contentDigest: value.integrity.contentDigest,
    signature: value.signature,
  });
}

export function getWebMachineManifestContent(manifest) {
  const normalized = validateWebMachineManifest(manifest);
  return createWebMachineManifestContent({
    format: normalized.format,
    schemaVersion: normalized.schemaVersion,
    groupId: normalized.groupId,
    createdAt: normalized.createdAt,
    machines: normalized.machines,
    devices: normalized.devices,
    blobs: normalized.blobs,
  });
}
