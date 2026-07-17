import { fingerprintWebMachinePublicKey } from "/src/machine/index.js";

const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8", { fatal: true });
const magic = encoder.encode("WEBMACHINE1\n");
const prefixByteLength = magic.byteLength + 4;
const maximumManifestBytes = 16 * 1024 * 1024;

function sameBytes(left, right) {
  return left.byteLength === right.byteLength && left.every((byte, index) => byte === right[index]);
}

export async function inspectUntrustedWebMachine(file) {
  if (!file || typeof file.slice !== "function" || file.size < prefixByteLength) throw new TypeError("A .webmachine file is required");
  const prefix = new Uint8Array(await file.slice(0, prefixByteLength).arrayBuffer());
  if (!sameBytes(prefix.subarray(0, magic.byteLength), magic)) throw new TypeError("This is not a Web Computer image");
  const headerBytes = new DataView(prefix.buffer, prefix.byteOffset + magic.byteLength, 4).getUint32(0, false);
  if (!headerBytes || headerBytes > maximumManifestBytes || prefixByteLength + headerBytes > file.size) {
    throw new TypeError("The machine image header is invalid");
  }
  const manifest = JSON.parse(decoder.decode(new Uint8Array(await file.slice(prefixByteLength, prefixByteLength + headerBytes).arrayBuffer())));
  const publicKey = manifest?.signature?.publicKey;
  const fingerprint = await fingerprintWebMachinePublicKey(crypto, publicKey);
  return Object.freeze({
    publicKey,
    fingerprint,
    groupId: String(manifest.groupId || ""),
    machines: Object.freeze((manifest.machines || []).map((entry) => String(entry.machineId || ""))),
    devices: Object.freeze((manifest.devices || []).map((entry) => String(entry.name || ""))),
    permissions: Object.freeze(Object.fromEntries((manifest.machines || []).map((entry) => [entry.machineId, { devices: [...(entry.permissions?.devices || [])] }]))),
    byteLength: file.size,
  });
}

export function shortFingerprint(value) {
  const text = String(value || "").replace(/^sha256:/, "");
  return `${text.slice(0, 12)}…${text.slice(-12)}`;
}
