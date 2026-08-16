// v86AssetIntegrity.js - Layer 5/guests: 선언된 V86 boot asset을 byte 검증 뒤 engine option으로 만든다.
import { WebMachineError } from "../../contracts/webMachineError.js";

const DIGEST_PATTERN = /^sha256:[0-9a-f]{64}$/;
const SUPPORTED_TARGETS = new Set(["bios", "bzimage", "cdrom", "fda", "vga_bios"]);
const MAX_ASSETS = 8;
const MAX_ASSET_BYTES = 512 * 1024 * 1024;
const MAX_TOTAL_BYTES = 768 * 1024 * 1024;

function exactKeys(value, expected, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new WebMachineError("WEB_MACHINE_GUEST_BOOT", `${label}: object is required`);
  }
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (actual.join(",") !== wanted.join(",")) {
    throw new WebMachineError("WEB_MACHINE_GUEST_BOOT", `${label}: keys do not match`, { actual, expected: wanted });
  }
}

function normalizeDescriptor(value, index) {
  const label = `v86.assets[${index}]`;
  exactKeys(value, ["byteLength", "sha256", "target", "url"], label);
  if (typeof value.target !== "string" || typeof value.url !== "string" || typeof value.sha256 !== "string") {
    throw new WebMachineError("WEB_MACHINE_GUEST_BOOT", `${label}: target, url, and sha256 must be strings`);
  }
  const target = value.target;
  if (!SUPPORTED_TARGETS.has(target)) {
    throw new WebMachineError("WEB_MACHINE_GUEST_BOOT", `${label}.target is unsupported: ${target}`);
  }
  const url = value.url;
  if (!url || url.length > 4096) throw new WebMachineError("WEB_MACHINE_GUEST_BOOT", `${label}.url is invalid`);
  if (!Number.isSafeInteger(value.byteLength) || value.byteLength < 1 || value.byteLength > MAX_ASSET_BYTES) {
    throw new WebMachineError("WEB_MACHINE_GUEST_BOOT", `${label}.byteLength is outside the supported range`);
  }
  const sha256 = value.sha256;
  if (!DIGEST_PATTERN.test(sha256)) throw new WebMachineError("WEB_MACHINE_GUEST_BOOT", `${label}.sha256 is invalid`);
  return Object.freeze({ target, url, byteLength: value.byteLength, sha256 });
}

function asBytes(value, target) {
  if (value instanceof Uint8Array) return new Uint8Array(value);
  if (value instanceof ArrayBuffer) return new Uint8Array(value.slice(0));
  if (ArrayBuffer.isView(value)) {
    return new Uint8Array(new Uint8Array(value.buffer, value.byteOffset, value.byteLength));
  }
  throw new WebMachineError("WEB_MACHINE_GUEST_BOOT", `${target}: asset loader must return bytes`);
}

export async function resolveV86AssetOptions({ options, assets, loadAsset, digestBytes }) {
  const sourceOptions = options && typeof options === "object" && !Array.isArray(options) ? { ...options } : null;
  if (!sourceOptions) throw new WebMachineError("WEB_MACHINE_GUEST_BOOT", "x86 adapter: manifest.v86.options is missing");
  if (assets === undefined) return Object.freeze({ options: sourceOptions, assets: Object.freeze([]) });
  if (!Array.isArray(assets) || assets.length < 1 || assets.length > MAX_ASSETS) {
    throw new WebMachineError("WEB_MACHINE_GUEST_BOOT", `v86.assets must contain 1 to ${MAX_ASSETS} entries`);
  }
  if (typeof loadAsset !== "function" || typeof digestBytes !== "function") {
    throw new WebMachineError("WEB_MACHINE_GUEST_BOOT", "v86.assets requires loadAsset and digestBytes functions");
  }
  const descriptors = assets.map(normalizeDescriptor).sort((left, right) => left.target.localeCompare(right.target));
  const targets = descriptors.map((entry) => entry.target);
  if (new Set(targets).size !== targets.length) throw new WebMachineError("WEB_MACHINE_GUEST_BOOT", "v86.assets target is duplicated");
  if (descriptors.some((entry) => Object.hasOwn(sourceOptions, entry.target))) {
    throw new WebMachineError("WEB_MACHINE_GUEST_BOOT", "v86 asset target cannot also appear in v86.options");
  }
  const totalBytes = descriptors.reduce((sum, entry) => sum + entry.byteLength, 0);
  if (totalBytes > MAX_TOTAL_BYTES) throw new WebMachineError("WEB_MACHINE_GUEST_BOOT", "v86.assets total byte limit exceeded");

  const inspected = [];
  for (const descriptor of descriptors) {
    let loaded;
    try { loaded = await loadAsset(descriptor.url, descriptor); }
    catch (error) {
      throw new WebMachineError("WEB_MACHINE_GUEST_BOOT", `${descriptor.target}: asset load failed`, {
        target: descriptor.target,
        reason: String(error?.message || error),
      });
    }
    const bytes = asBytes(loaded, descriptor.target);
    if (bytes.byteLength !== descriptor.byteLength) {
      throw new WebMachineError("WEB_MACHINE_ASSET_INTEGRITY", `${descriptor.target}: asset byteLength mismatch`, {
        target: descriptor.target,
        expected: descriptor.byteLength,
        actual: bytes.byteLength,
      });
    }
    let actual;
    try { actual = await digestBytes(bytes); }
    catch (error) {
      throw new WebMachineError("WEB_MACHINE_GUEST_BOOT", `${descriptor.target}: asset digest failed`, {
        target: descriptor.target,
        reason: String(error?.message || error),
      });
    }
    if (typeof actual !== "string" || !DIGEST_PATTERN.test(actual)) {
      throw new WebMachineError("WEB_MACHINE_GUEST_BOOT", `${descriptor.target}: asset digest must be a SHA-256 string`);
    }
    if (actual !== descriptor.sha256) {
      throw new WebMachineError("WEB_MACHINE_ASSET_INTEGRITY", `${descriptor.target}: asset SHA-256 mismatch`, {
        target: descriptor.target,
        expected: descriptor.sha256,
        actual,
      });
    }
    sourceOptions[descriptor.target] = {
      buffer: bytes.buffer,
      async: false,
    };
    inspected.push(Object.freeze({ ...descriptor, state: "verified" }));
  }
  return Object.freeze({ options: sourceOptions, assets: Object.freeze(inspected) });
}
