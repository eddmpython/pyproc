// machineHome.js - Layer 2: Session image와 MachineJournal이 공유하는 /home 스냅샷 계약.
// Pyodide의 MEMFS 디렉터리와 파일 메타는 WASM 선형 메모리 밖에도 있으므로 힙 페이지만
// 저장해서는 머신의 파일 상태가 부활하지 않는다. 두 영속 경로가 같은 검증과 적용을 쓴다.
import { PyProcError } from "../runtime/errors.js";
import { bytesToMb, compareNames } from "../runtime/memoryLayout.js";

export const DEFAULT_MACHINE_HOME_PATH = "/home/web";

const HOME_MAX_BYTES = 512 * 1024 * 1024;
const HOME_MAX_ENTRIES = 10000;
const PATH_MAX_BYTES = 4096;

function normalizeMachineHomeRoot(path, label = "home path") {
  if (typeof path !== "string" || !path.startsWith("/") || path.includes("\0")) throw new PyProcError("PYPROC_MACHINE_FORMAT_INVALID", `machine: malformed ${label}`);
  const trimmed = path.replace(/\/+$/, "") || "/";
  if (trimmed === "/") throw new PyProcError("PYPROC_MACHINE_FORMAT_INVALID", `machine: ${label} cannot be the root`);
  if (new TextEncoder().encode(trimmed).length > PATH_MAX_BYTES) throw new PyProcError("PYPROC_MACHINE_FORMAT_INVALID", `machine: ${label} is too long`);
  const parts = trimmed.split("/").filter(Boolean);
  if (parts.some((p) => p === "." || p === ".." || p === "")) throw new PyProcError("PYPROC_MACHINE_FORMAT_INVALID", `machine: ${label} has an invalid path segment`);
  return trimmed;
}

function validateRelativePath(path) {
  if (typeof path !== "string" || path === "" || path.startsWith("/") || path.includes("\0") || path.includes("\\")) {
    throw new PyProcError("PYPROC_MACHINE_FORMAT_INVALID", "machine: malformed home entry path");
  }
  if (new TextEncoder().encode(path).length > PATH_MAX_BYTES) throw new PyProcError("PYPROC_MACHINE_FORMAT_INVALID", "machine: home entry path is too long");
  const parts = path.split("/");
  if (parts.some((p) => p === "" || p === "." || p === "..")) throw new PyProcError("PYPROC_MACHINE_FORMAT_INVALID", "machine: home entry path has an invalid segment");
}

export function validateMachineHomeMeta(home, binLen) {
  if (typeof home !== "object" || home === null) throw new PyProcError("PYPROC_MACHINE_FORMAT_INVALID", "machine: home meta is not an object");
  if (home.version !== 1) throw new PyProcError("PYPROC_MACHINE_FORMAT_INVALID", `machine: unsupported home version (${home.version})`);
  normalizeMachineHomeRoot(home.path, "home path");
  if (!Number.isInteger(home.bytes) || home.bytes < 0 || home.bytes > HOME_MAX_BYTES || home.bytes !== binLen) throw new PyProcError("PYPROC_MACHINE_FORMAT_INVALID", "machine: home bytes out of range");
  if (!Array.isArray(home.entries) || home.entries.length > HOME_MAX_ENTRIES) throw new PyProcError("PYPROC_MACHINE_FORMAT_INVALID", "machine: home entries out of range");
  const seen = new Set();
  let nextOffset = 0;
  for (const entry of home.entries) {
    if (typeof entry !== "object" || entry === null) throw new PyProcError("PYPROC_MACHINE_FORMAT_INVALID", "machine: malformed home entry");
    validateRelativePath(entry.path);
    if (seen.has(entry.path)) throw new PyProcError("PYPROC_MACHINE_FORMAT_INVALID", `machine: duplicate home entry (${entry.path})`);
    seen.add(entry.path);
    if (entry.type === "dir") continue;
    if (entry.type !== "file") throw new PyProcError("PYPROC_MACHINE_FORMAT_INVALID", `machine: invalid home entry type (${entry.type})`);
    if (!Number.isInteger(entry.offset) || !Number.isInteger(entry.size) || entry.offset !== nextOffset || entry.size < 0) throw new PyProcError("PYPROC_MACHINE_FORMAT_INVALID", "machine: invalid home file offset");
    nextOffset += entry.size;
    if (nextOffset > binLen) throw new PyProcError("PYPROC_MACHINE_FORMAT_INVALID", "machine: home file range exceeded");
  }
  if (nextOffset !== binLen) throw new PyProcError("PYPROC_MACHINE_FORMAT_INVALID", "machine: home pack size mismatch");
}

function joinPath(base, name) {
  return `${base.replace(/\/+$/, "")}/${name}`;
}

function parentPath(path) {
  const i = path.lastIndexOf("/");
  return i <= 0 ? "/" : path.slice(0, i);
}

function concatBytes(parts, total) {
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) { out.set(part, offset); offset += part.length; }
  return out;
}

export function collectMachineHome(fs, path = DEFAULT_MACHINE_HOME_PATH, opts = {}) {
  const root = normalizeMachineHomeRoot(path, "home path");
  if (!fs.exists(root)) {
    if (opts.required) throw new PyProcError("PYPROC_INPUT_INVALID", `${opts.errorPrefix || "machineHome"}: ${root} does not exist, so no /home snapshot can be taken`);
    return null;
  }
  const rootStat = fs.stat(root);
  if (!rootStat.isDir) throw new PyProcError("PYPROC_INPUT_INVALID", `${opts.errorPrefix || "machineHome"}: ${root} is not a directory`);
  const entries = [];
  const chunks = [];
  let total = 0;
  const visit = (dir, rel) => {
    for (const name of fs.readdir(dir).slice().sort()) {
      validateRelativePath(name);
      const full = joinPath(dir, name);
      const childRel = rel ? `${rel}/${name}` : name;
      const st = fs.stat(full);
      if (st.isDir) {
        entries.push({ path: childRel, type: "dir" });
        visit(full, childRel);
      } else if (st.isFile) {
        const data = fs.readFile(full);
        if (!(data instanceof Uint8Array)) throw new PyProcError("PYPROC_MACHINE_FORMAT_INVALID", `${opts.errorPrefix || "machineHome"}: ${childRel} read returned an unexpected type`);
        if (total + data.length > HOME_MAX_BYTES) throw new PyProcError("PYPROC_MACHINE_FORMAT_INVALID", `${opts.errorPrefix || "machineHome"}: the home snapshot exceeded its size limit`);
        entries.push({ path: childRel, type: "file", offset: total, size: data.length });
        chunks.push(data);
        total += data.length;
      } else {
        throw new PyProcError("PYPROC_MACHINE_FORMAT_INVALID", `${opts.errorPrefix || "machineHome"}: ${childRel} is neither a file nor a directory`);
      }
      if (entries.length > HOME_MAX_ENTRIES) throw new PyProcError("PYPROC_MACHINE_FORMAT_INVALID", `${opts.errorPrefix || "machineHome"}: the home entry count exceeded its limit`);
    }
  };
  visit(root, "");
  const meta = { version: 1, path: root, entries, bytes: total };
  validateMachineHomeMeta(meta, total);
  return { meta, bin: concatBytes(chunks, total) };
}

function removeTree(fs, path) {
  if (!fs.exists(path)) return;
  const st = fs.stat(path);
  if (st.isFile) { fs.unlink(path); return; }
  for (const name of fs.readdir(path)) removeTree(fs, joinPath(path, name));
  fs.rmdir(path);
}

export function applyMachineHome(fs, home, bin) {
  validateMachineHomeMeta(home, bin.length);
  const root = normalizeMachineHomeRoot(home.path, "home path");
  removeTree(fs, root);
  fs.mkdirTree(root);
  const dirs = home.entries.filter((entry) => entry.type === "dir").sort((a, b) => compareNames(a.path, b.path));
  for (const entry of dirs) fs.mkdirTree(joinPath(root, entry.path));
  const files = home.entries.filter((entry) => entry.type === "file");
  for (const entry of files) {
    const path = joinPath(root, entry.path);
    fs.mkdirTree(parentPath(path));
    fs.writeFile(path, bin.subarray(entry.offset, entry.offset + entry.size));
  }
  return { files: files.length, dirs: dirs.length, mb: bytesToMb(bin.length) };
}
