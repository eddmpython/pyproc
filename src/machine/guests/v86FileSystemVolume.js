// v86FileSystemVolume.js - v86 9P 파일 트리를 공통 block device에 저장하는 volume 형식.
const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8", { fatal: true });
const magic = encoder.encode("V86_9P_VOLUME_1\n");
const maxEntries = 10000;

import { WebMachineError } from "../contracts/webMachineError.js";
function joinPath(base, name) {
  return base === "/" ? `/${name}` : `${base}/${name}`;
}

function parentPath(path) {
  const index = path.lastIndexOf("/");
  return index <= 0 ? "/" : path.slice(0, index);
}

function baseName(path) {
  return path.slice(path.lastIndexOf("/") + 1);
}

function assertPath(path) {
  if (typeof path !== "string" || !path.startsWith("/") || path === "/" || path.includes("\\") || path.includes("\0")) {
    throw new WebMachineError("WEB_MACHINE_VOLUME_INVALID", `v86 9P volume: path 형식 위반 ${path}`);
  }
  if (path.split("/").slice(1).some((part) => !part || part === "." || part === "..")) {
    throw new WebMachineError("WEB_MACHINE_VOLUME_INVALID", `v86 9P volume: path 성분 위반 ${path}`);
  }
}

function assertDevice(device) {
  if (!device || device.kind !== "block" || typeof device.read !== "function" || typeof device.write !== "function") {
    throw new TypeError("v86 9P volume: block device 필요");
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

async function collectFileSystem(fileSystem) {
  const entries = [];
  const chunks = [];
  let payloadBytes = 0;
  const visit = async (directory) => {
    const names = fileSystem.read_dir(directory);
    if (!Array.isArray(names)) throw new WebMachineError("WEB_MACHINE_VOLUME_INVALID", `v86 9P volume: directory read 실패 ${directory}`);
    for (const name of names.slice().sort()) {
      const path = joinPath(directory, name);
      assertPath(path);
      const inodeId = fileSystem.SearchPath(path).id;
      if (inodeId < 0) throw new WebMachineError("WEB_MACHINE_VOLUME_INVALID", `v86 9P volume: inode 없음 ${path}`);
      if (fileSystem.IsDirectory(inodeId)) {
        entries.push({ path, type: "dir" });
        await visit(path);
      } else {
        const inode = fileSystem.GetInode(inodeId);
        if ((inode.mode & 61440) !== 32768) throw new WebMachineError("WEB_MACHINE_VOLUME_INVALID", `v86 9P volume: file/dir 이외 inode ${path}`);
        const bytes = await fileSystem.read_file(path);
        if (!(bytes instanceof Uint8Array)) throw new WebMachineError("WEB_MACHINE_VOLUME_INVALID", `v86 9P volume: file read 실패 ${path}`);
        entries.push({ path, type: "file", offset: payloadBytes, size: bytes.byteLength });
        chunks.push(bytes);
        payloadBytes += bytes.byteLength;
      }
      if (entries.length > maxEntries) throw new WebMachineError("WEB_MACHINE_VOLUME_CAPACITY", "v86 9P volume: 엔트리 상한 초과");
    }
  };
  await visit("/");
  const payload = new Uint8Array(payloadBytes);
  let offset = 0;
  for (const chunk of chunks) {
    payload.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return { entries, payload };
}

function validateMeta(meta, payloadBytes) {
  if (!meta || meta.version !== 1 || meta.payloadBytes !== payloadBytes || !Array.isArray(meta.entries) || meta.entries.length > maxEntries) {
    throw new WebMachineError("WEB_MACHINE_VOLUME_INVALID", "v86 9P volume: meta 불일치");
  }
  const seen = new Set();
  let nextOffset = 0;
  for (const entry of meta.entries) {
    assertPath(entry?.path);
    if (seen.has(entry.path)) throw new WebMachineError("WEB_MACHINE_VOLUME_INVALID", `v86 9P volume: 중복 경로 ${entry.path}`);
    seen.add(entry.path);
    if (entry.type === "dir") continue;
    if (entry.type !== "file" || !Number.isInteger(entry.offset) || !Number.isInteger(entry.size) || entry.offset !== nextOffset || entry.size < 0) {
      throw new WebMachineError("WEB_MACHINE_VOLUME_INVALID", `v86 9P volume: file 범위 위반 ${entry.path}`);
    }
    nextOffset += entry.size;
    if (nextOffset > payloadBytes) throw new WebMachineError("WEB_MACHINE_VOLUME_INVALID", "v86 9P volume: payload 범위 초과");
  }
  if (nextOffset !== payloadBytes) throw new WebMachineError("WEB_MACHINE_VOLUME_INVALID", "v86 9P volume: payload 크기 불일치");
}

export function serializeV86FileSystemState(fileSystem) {
  const state = fileSystem.get_state();
  if (!Array.isArray(state) || state.length !== 5 || !Array.isArray(state[0]) || !Array.isArray(state[2])) {
    throw new WebMachineError("WEB_MACHINE_VOLUME_INVALID", "v86 9P volume: 지원하지 않는 filesystem state");
  }
  return [
    state[0].map((inode) => typeof inode?.get_state === "function" ? inode.get_state() : structuredClone(inode)),
    state[1],
    state[2].map(([id, bytes]) => [id, bytes.slice()]),
    state[3],
    state[4],
  ];
}

export async function writeV86FileSystemVolume({ device, fileSystem }) {
  assertDevice(device);
  const { entries, payload } = await collectFileSystem(fileSystem);
  const meta = { version: 1, entries, payloadBytes: payload.byteLength };
  const head = encoder.encode(JSON.stringify(meta));
  const frameLength = magic.byteLength + 4 + head.byteLength + payload.byteLength;
  if (frameLength > device.byteLength) throw new WebMachineError("WEB_MACHINE_VOLUME_CAPACITY", `v86 9P volume: 용량 초과 ${frameLength}/${device.byteLength}`);
  const frame = new Uint8Array(frameLength);
  frame.set(magic, 0);
  new DataView(frame.buffer).setUint32(magic.byteLength, head.byteLength);
  frame.set(head, magic.byteLength + 4);
  frame.set(payload, magic.byteLength + 4 + head.byteLength);
  await device.write(0, frame);
  await clearTail(device, frameLength);
  return { files: entries.filter((entry) => entry.type === "file").length, bytes: payload.byteLength, frameLength };
}

export async function readV86FileSystemVolume({ device, fileSystem, emptyState, allowEmpty = false }) {
  assertDevice(device);
  const prefix = await device.read(0, magic.byteLength + 4);
  if (prefix.every((byte) => byte === 0)) {
    if (allowEmpty) return null;
    throw new WebMachineError("WEB_MACHINE_VOLUME_EMPTY", "v86 9P volume: 초기화되지 않은 block");
  }
  if (!magic.every((byte, index) => prefix[index] === byte)) throw new WebMachineError("WEB_MACHINE_VOLUME_INVALID", "v86 9P volume: magic 불일치");
  const headLength = new DataView(prefix.buffer, prefix.byteOffset + magic.byteLength, 4).getUint32(0);
  const headOffset = magic.byteLength + 4;
  if (headLength <= 0 || headOffset + headLength > device.byteLength) throw new WebMachineError("WEB_MACHINE_VOLUME_INVALID", "v86 9P volume: head 범위 위반");
  const meta = JSON.parse(decoder.decode(await device.read(headOffset, headLength)));
  const payloadOffset = headOffset + headLength;
  if (!Number.isInteger(meta?.payloadBytes) || meta.payloadBytes < 0 || payloadOffset + meta.payloadBytes > device.byteLength) {
    throw new WebMachineError("WEB_MACHINE_VOLUME_INVALID", "v86 9P volume: payload 길이 위반");
  }
  const payload = await device.read(payloadOffset, meta.payloadBytes);
  validateMeta(meta, payload.byteLength);
  fileSystem.set_state(emptyState);
  const directories = meta.entries.filter((entry) => entry.type === "dir")
    .sort((left, right) => left.path.split("/").length - right.path.split("/").length || left.path.localeCompare(right.path));
  for (const entry of directories) {
    const parentId = fileSystem.SearchPath(parentPath(entry.path)).id;
    if (parentId < 0) throw new WebMachineError("WEB_MACHINE_VOLUME_INVALID", `v86 9P volume: parent 없음 ${entry.path}`);
    fileSystem.CreateDirectory(baseName(entry.path), parentId);
  }
  const files = meta.entries.filter((entry) => entry.type === "file");
  for (const entry of files) {
    const parentId = fileSystem.SearchPath(parentPath(entry.path)).id;
    if (parentId < 0) throw new WebMachineError("WEB_MACHINE_VOLUME_INVALID", `v86 9P volume: parent 없음 ${entry.path}`);
    await fileSystem.CreateBinaryFile(baseName(entry.path), parentId, payload.subarray(entry.offset, entry.offset + entry.size));
  }
  return { files: files.length, bytes: payload.byteLength };
}
