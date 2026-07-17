// pyprocHomeVolume.js - 공개 Runtime.fs와 block device 사이의 /home volume 형식.
const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8", { fatal: true });
const magic = encoder.encode("PYPROC_HOME_VOLUME_1\n");
const maxEntries = 10000;

import { WebMachineError } from "../contracts/webMachineError.js";
function joinPath(base, name) {
  return `${base.replace(/\/+$/, "")}/${name}`;
}

function assertRelativePath(path) {
  if (typeof path !== "string" || !path || path.startsWith("/") || path.includes("\\") || path.includes("\0")) {
    throw new WebMachineError("WEB_MACHINE_VOLUME_INVALID", "pyproc home volume: 상대 경로 형식 위반");
  }
  const parts = path.split("/");
  if (parts.some((part) => !part || part === "." || part === "..")) {
    throw new WebMachineError("WEB_MACHINE_VOLUME_INVALID", `pyproc home volume: 경로 성분 위반 ${path}`);
  }
}

function collectHome(fs, root) {
  const entries = [];
  const chunks = [];
  let payloadBytes = 0;
  const visit = (directory, relative) => {
    for (const name of fs.readdir(directory).slice().sort()) {
      assertRelativePath(name);
      const path = joinPath(directory, name);
      const entryPath = relative ? `${relative}/${name}` : name;
      const stat = fs.stat(path);
      if (stat.isDir) {
        entries.push({ path: entryPath, type: "dir" });
        visit(path, entryPath);
      } else if (stat.isFile) {
        const bytes = fs.readFile(path);
        if (!(bytes instanceof Uint8Array)) throw new WebMachineError("WEB_MACHINE_VOLUME_INVALID", `pyproc home volume: binary read 실패 ${entryPath}`);
        entries.push({ path: entryPath, type: "file", offset: payloadBytes, size: bytes.byteLength });
        chunks.push(bytes);
        payloadBytes += bytes.byteLength;
      } else {
        throw new WebMachineError("WEB_MACHINE_VOLUME_INVALID", `pyproc home volume: file/dir 이외 엔트리 ${entryPath}`);
      }
      if (entries.length > maxEntries) throw new WebMachineError("WEB_MACHINE_VOLUME_CAPACITY", "pyproc home volume: 엔트리 상한 초과");
    }
  };
  visit(root, "");
  const payload = new Uint8Array(payloadBytes);
  let offset = 0;
  for (const chunk of chunks) {
    payload.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return { entries, payload };
}

function removeTree(fs, path) {
  if (!fs.exists(path)) return;
  const stat = fs.stat(path);
  if (stat.isFile) {
    fs.unlink(path);
    return;
  }
  for (const name of fs.readdir(path)) removeTree(fs, joinPath(path, name));
  fs.rmdir(path);
}

function validateMeta(meta, payloadBytes, root) {
  if (!meta || meta.version !== 1 || meta.root !== root || meta.payloadBytes !== payloadBytes) {
    throw new WebMachineError("WEB_MACHINE_VOLUME_INVALID", "pyproc home volume: meta 불일치");
  }
  if (!Array.isArray(meta.entries) || meta.entries.length > maxEntries) {
    throw new WebMachineError("WEB_MACHINE_VOLUME_INVALID", "pyproc home volume: entries 범위 위반");
  }
  const seen = new Set();
  let nextOffset = 0;
  for (const entry of meta.entries) {
    assertRelativePath(entry?.path);
    if (seen.has(entry.path)) throw new WebMachineError("WEB_MACHINE_VOLUME_INVALID", `pyproc home volume: 중복 경로 ${entry.path}`);
    seen.add(entry.path);
    if (entry.type === "dir") continue;
    if (entry.type !== "file" || !Number.isInteger(entry.offset) || !Number.isInteger(entry.size) || entry.offset !== nextOffset || entry.size < 0) {
      throw new WebMachineError("WEB_MACHINE_VOLUME_INVALID", `pyproc home volume: file 범위 위반 ${entry.path}`);
    }
    nextOffset += entry.size;
    if (nextOffset > payloadBytes) throw new WebMachineError("WEB_MACHINE_VOLUME_INVALID", "pyproc home volume: payload 범위 초과");
  }
  if (nextOffset !== payloadBytes) throw new WebMachineError("WEB_MACHINE_VOLUME_INVALID", "pyproc home volume: payload 크기 불일치");
}

function assertDevice(device) {
  if (!device || device.kind !== "block" || typeof device.read !== "function" || typeof device.write !== "function") {
    throw new TypeError("pyproc home volume: block device 필요");
  }
  if (!Number.isInteger(device.byteLength) || device.byteLength <= magic.byteLength + 4) {
    throw new WebMachineError("WEB_MACHINE_VOLUME_CAPACITY", "pyproc home volume: block 크기 부족");
  }
}

async function clearTail(device, offset) {
  const chunk = new Uint8Array(Math.min(1024 * 1024, device.byteLength - offset));
  while (offset < device.byteLength) {
    const length = Math.min(chunk.byteLength, device.byteLength - offset);
    await device.write(offset, length === chunk.byteLength ? chunk : chunk.subarray(0, length));
    offset += length;
  }
}

export async function writePyprocHomeVolume({ device, fs, root = "/home/web" }) {
  assertDevice(device);
  if (!fs.exists(root)) fs.mkdirTree(root);
  const { entries, payload } = collectHome(fs, root);
  const meta = { version: 1, root, entries, payloadBytes: payload.byteLength };
  const head = encoder.encode(JSON.stringify(meta));
  const frameLength = magic.byteLength + 4 + head.byteLength + payload.byteLength;
  if (frameLength > device.byteLength) {
    throw new WebMachineError("WEB_MACHINE_VOLUME_CAPACITY", `pyproc home volume: 용량 초과 ${frameLength}/${device.byteLength}`);
  }
  const frame = new Uint8Array(frameLength);
  frame.set(magic, 0);
  new DataView(frame.buffer).setUint32(magic.byteLength, head.byteLength);
  frame.set(head, magic.byteLength + 4);
  frame.set(payload, magic.byteLength + 4 + head.byteLength);
  await device.write(0, frame);
  await clearTail(device, frameLength);
  return { files: entries.filter((entry) => entry.type === "file").length, bytes: payload.byteLength, frameLength };
}

export async function readPyprocHomeVolume({ device, fs, root = "/home/web", allowEmpty = false }) {
  assertDevice(device);
  const prefix = await device.read(0, magic.byteLength + 4);
  if (prefix.every((byte) => byte === 0)) {
    if (allowEmpty) return null;
    throw new WebMachineError("WEB_MACHINE_VOLUME_EMPTY", "pyproc home volume: 초기화되지 않은 block");
  }
  if (!magic.every((byte, index) => prefix[index] === byte)) throw new WebMachineError("WEB_MACHINE_VOLUME_INVALID", "pyproc home volume: magic 불일치");
  const headLength = new DataView(prefix.buffer, prefix.byteOffset + magic.byteLength, 4).getUint32(0);
  const headOffset = magic.byteLength + 4;
  if (headLength <= 0 || headOffset + headLength > device.byteLength) throw new WebMachineError("WEB_MACHINE_VOLUME_INVALID", "pyproc home volume: head 범위 위반");
  const head = await device.read(headOffset, headLength);
  const meta = JSON.parse(decoder.decode(head));
  const payloadOffset = headOffset + headLength;
  if (!Number.isInteger(meta?.payloadBytes) || meta.payloadBytes < 0 || payloadOffset + meta.payloadBytes > device.byteLength) {
    throw new WebMachineError("WEB_MACHINE_VOLUME_INVALID", "pyproc home volume: payload 길이 위반");
  }
  const payload = await device.read(payloadOffset, meta.payloadBytes);
  validateMeta(meta, payload.byteLength, root);
  removeTree(fs, root);
  fs.mkdirTree(root);
  const directories = meta.entries.filter((entry) => entry.type === "dir")
    .sort((left, right) => left.path.split("/").length - right.path.split("/").length || left.path.localeCompare(right.path));
  for (const entry of directories) fs.mkdirTree(joinPath(root, entry.path));
  const files = meta.entries.filter((entry) => entry.type === "file");
  for (const entry of files) {
    const path = joinPath(root, entry.path);
    const parent = path.slice(0, path.lastIndexOf("/")) || "/";
    fs.mkdirTree(parent);
    fs.writeFile(path, payload.subarray(entry.offset, entry.offset + entry.size));
  }
  return { files: files.length, bytes: payload.byteLength };
}
