// machineHome.js - Layer 2: Session image와 MachineJournal이 공유하는 /home 스냅샷 계약.
// Pyodide의 MEMFS 디렉터리와 파일 메타는 WASM 선형 메모리 밖에도 있으므로 힙 페이지만
// 저장해서는 머신의 파일 상태가 부활하지 않는다. 두 영속 경로가 같은 검증과 적용을 쓴다.
//
// 저장 모양은 둘이고, 쓰는 것은 v2 하나다.
//   v1(읽기 전용): 파일 바이트를 하나의 연속 팩으로 잇고 메타가 offset/size로 자른다. 파일
//     하나가 1바이트 바뀌어도 팩 전체의 주소가 바뀌므로 dedupe가 무효였다 - 커밋마다 홈 전량을
//     다시 읽고 잇고 해시하고 썼다.
//   v2(쓰기 정본): 파일마다 blob 하나다. 내용 주소가 파일 단위라 안 바뀐 파일은 이미 저장소에
//     있고 쓰기가 사라진다. 메타는 구조(디렉터리와 파일 크기)만 나른다.
// 옛 세대는 그대로 읽힌다(v1 갈래 유지). 이관 동사가 따로 없는 이유가 그것이다.
import { PyProcError } from "../../runtime/errors.js";
import { bytesToMb, compareNames } from "../../runtime/memoryLayout.js";

export const DEFAULT_MACHINE_HOME_PATH = "/home/web";

// 트리 file 엔트리의 이름 법. 루트 엔트리가 메타(구조)를 나르고, 파일마다 `home/<상대경로>`가
// 하나씩 붙는다. 저널과 세션 이미지가 같은 이름을 써야 한 쪽이 쓴 세대를 다른 쪽이 읽는다.
const MACHINE_HOME_FILE_ID = "home";
const MACHINE_HOME_FILE_PREFIX = "home/";

const HOME_MAX_BYTES = 512 * 1024 * 1024;
const HOME_MAX_ENTRIES = 10000;
const PATH_MAX_BYTES = 4096;
const EMPTY_BYTES = new Uint8Array(0);

function formatInvalid(message) {
  return new PyProcError("PYPROC_MACHINE_FORMAT_INVALID", message);
}

function normalizeMachineHomeRoot(path, label = "home path") {
  if (typeof path !== "string" || !path.startsWith("/") || path.includes("\0")) throw formatInvalid(`machine: malformed ${label}`);
  const trimmed = path.replace(/\/+$/, "") || "/";
  if (trimmed === "/") throw formatInvalid(`machine: ${label} cannot be the root`);
  if (new TextEncoder().encode(trimmed).length > PATH_MAX_BYTES) throw formatInvalid(`machine: ${label} is too long`);
  const parts = trimmed.split("/").filter(Boolean);
  if (parts.some((p) => p === "." || p === ".." || p === "")) throw formatInvalid(`machine: ${label} has an invalid path segment`);
  return trimmed;
}

function validateRelativePath(path) {
  if (typeof path !== "string" || path === "" || path.startsWith("/") || path.includes("\0") || path.includes("\\")) {
    throw formatInvalid("machine: malformed home entry path");
  }
  if (new TextEncoder().encode(path).length > PATH_MAX_BYTES) throw formatInvalid("machine: home entry path is too long");
  const parts = path.split("/");
  if (parts.some((p) => p === "" || p === "." || p === "..")) throw formatInvalid("machine: home entry path has an invalid segment");
}

// 공통 골격 판정(두 판 모두): 루트 경로, 엔트리 수, 경로 중복, 타입.
function validateHomeShape(home) {
  if (typeof home !== "object" || home === null) throw formatInvalid("machine: home meta is not an object");
  if (home.version !== 1 && home.version !== 2) throw formatInvalid(`machine: unsupported home version (${home.version})`);
  normalizeMachineHomeRoot(home.path, "home path");
  if (!Array.isArray(home.entries) || home.entries.length > HOME_MAX_ENTRIES) throw formatInvalid("machine: home entries out of range");
  const seen = new Set();
  for (const entry of home.entries) {
    if (typeof entry !== "object" || entry === null) throw formatInvalid("machine: malformed home entry");
    validateRelativePath(entry.path);
    if (seen.has(entry.path)) throw formatInvalid(`machine: duplicate home entry (${entry.path})`);
    seen.add(entry.path);
    if (entry.type !== "dir" && entry.type !== "file") throw formatInvalid(`machine: invalid home entry type (${entry.type})`);
  }
}

// payload는 판에 따라 다르다: v1은 팩 바이트 길이(number 또는 Uint8Array), v2는 경로 -> 바이트 Map.
// 두 판 모두 "메타가 말하는 바이트가 실제로 다 있는가"를 여기서 끝낸다(부분 적용 방지).
export function validateMachineHomeMeta(home, payload) {
  validateHomeShape(home);
  const files = home.entries.filter((entry) => entry.type === "file");
  if (home.version === 2) {
    if (!(payload instanceof Map)) throw formatInvalid("machine: home v2 needs a path-to-bytes map");
    let total = 0;
    for (const entry of files) {
      if (!Number.isInteger(entry.size) || entry.size < 0) throw formatInvalid(`machine: invalid home file size (${entry.path})`);
      const bytes = payload.get(entry.path);
      if (!(bytes instanceof Uint8Array)) throw formatInvalid(`machine: home file blob is missing (${entry.path})`);
      if (bytes.length !== entry.size) throw formatInvalid(`machine: home file size mismatch (${entry.path})`);
      total += entry.size;
      if (total > HOME_MAX_BYTES) throw formatInvalid("machine: home bytes out of range");
    }
    if (payload.size !== files.length) throw formatInvalid("machine: home has blobs no entry claims");
    return;
  }
  const binLen = payload instanceof Uint8Array ? payload.length : payload;
  if (!Number.isInteger(home.bytes) || home.bytes < 0 || home.bytes > HOME_MAX_BYTES || home.bytes !== binLen) throw formatInvalid("machine: home bytes out of range");
  let nextOffset = 0;
  for (const entry of files) {
    if (!Number.isInteger(entry.offset) || !Number.isInteger(entry.size) || entry.offset !== nextOffset || entry.size < 0) throw formatInvalid("machine: invalid home file offset");
    nextOffset += entry.size;
    if (nextOffset > binLen) throw formatInvalid("machine: home file range exceeded");
  }
  if (nextOffset !== binLen) throw formatInvalid("machine: home pack size mismatch");
}

function joinPath(base, name) {
  return `${base.replace(/\/+$/, "")}/${name}`;
}

function parentPath(path) {
  const i = path.lastIndexOf("/");
  return i <= 0 ? "/" : path.slice(0, i);
}

// 파일 트리를 v2 모양으로 수집한다: 구조는 meta가, 바이트는 파일마다 하나씩.
export function collectMachineHome(fs, path = DEFAULT_MACHINE_HOME_PATH, opts = {}) {
  const label = opts.errorPrefix || "machineHome";
  const root = normalizeMachineHomeRoot(path, "home path");
  if (!fs.exists(root)) {
    if (opts.required) throw new PyProcError("PYPROC_INPUT_INVALID", `${label}: ${root} does not exist, so no /home snapshot can be taken`);
    return null;
  }
  const rootStat = fs.stat(root);
  if (!rootStat.isDir) throw new PyProcError("PYPROC_INPUT_INVALID", `${label}: ${root} is not a directory`);
  const entries = [];
  const blobs = new Map();
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
        if (!(data instanceof Uint8Array)) throw formatInvalid(`${label}: ${childRel} read returned an unexpected type`);
        if (total + data.length > HOME_MAX_BYTES) throw formatInvalid(`${label}: the home snapshot exceeded its size limit`);
        entries.push({ path: childRel, type: "file", size: data.length });
        blobs.set(childRel, data);
        total += data.length;
      } else {
        throw formatInvalid(`${label}: ${childRel} is neither a file nor a directory`);
      }
      if (entries.length > HOME_MAX_ENTRIES) throw formatInvalid(`${label}: the home entry count exceeded its limit`);
    }
  };
  visit(root, "");
  const meta = { version: 2, path: root, entries };
  validateMachineHomeMeta(meta, blobs);
  return { meta, blobs, bytes: total };
}

// 수집분을 tree의 file 엔트리 배열로 바꾼다. 루트 엔트리는 구조만 나르므로 바이트가 없고
// (빈 blob의 주소는 하나뿐이라 저장소에서 한 번만 산다), 파일마다 엔트리 하나가 붙는다.
export function machineHomeFileEntries(home) {
  if (!home) return [];
  const files = [{ id: MACHINE_HOME_FILE_ID, bytes: EMPTY_BYTES, meta: home.meta }];
  for (const [path, bytes] of home.blobs) files.push({ id: MACHINE_HOME_FILE_PREFIX + path, bytes, meta: null });
  return files;
}

// tree의 file 엔트리에서 홈 페이로드를 되읽는다. v1 세대는 팩 하나를, v2 세대는 파일마다
// 하나를 담고 있고, 판정은 meta.version이 한다(저장된 모양이 스스로 말한다).
export function readMachineHomePayload(files) {
  const root = files && files.get(MACHINE_HOME_FILE_ID);
  if (!root) return null;
  const meta = root.meta;
  if (meta && meta.version === 1) return { meta, payload: root.bytes };
  const blobs = new Map();
  for (const [id, entry] of files) {
    if (id.startsWith(MACHINE_HOME_FILE_PREFIX)) blobs.set(id.slice(MACHINE_HOME_FILE_PREFIX.length), entry.bytes);
  }
  return { meta, payload: blobs };
}

function removeTree(fs, path) {
  if (!fs.exists(path)) return;
  const st = fs.stat(path);
  if (st.isFile) { fs.unlink(path); return; }
  for (const name of fs.readdir(path)) removeTree(fs, joinPath(path, name));
  fs.rmdir(path);
}

// payload는 v1이면 팩 바이트, v2면 경로 -> 바이트 Map이다.
export function applyMachineHome(fs, home, payload) {
  validateMachineHomeMeta(home, payload);
  const root = normalizeMachineHomeRoot(home.path, "home path");
  removeTree(fs, root);
  fs.mkdirTree(root);
  const dirs = home.entries.filter((entry) => entry.type === "dir").sort((a, b) => compareNames(a.path, b.path));
  for (const entry of dirs) fs.mkdirTree(joinPath(root, entry.path));
  const files = home.entries.filter((entry) => entry.type === "file");
  let bytes = 0;
  for (const entry of files) {
    const path = joinPath(root, entry.path);
    fs.mkdirTree(parentPath(path));
    const data = home.version === 2 ? payload.get(entry.path) : payload.subarray(entry.offset, entry.offset + entry.size);
    fs.writeFile(path, data);
    bytes += data.length;
  }
  return { files: files.length, dirs: dirs.length, mb: bytesToMb(bytes) };
}
