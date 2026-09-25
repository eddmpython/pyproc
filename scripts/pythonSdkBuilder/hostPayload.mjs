// hostPayload.mjs - platform wheel이 싣는 host를 읽는다: lock의 SHA-256과 맞는 공식 Node runtime, 같은 commit의
// canonical npm package tree, 그리고 win_amd64에는 lock이 고정한 사용자 브라우저 native host(프로젝트 release 자산).
// checksum이 다르면 어떤 byte도 wheel로 넘어가지 않는다.
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { unzipWheel } from "../../src/runtime/engines/wasi/wheelUnzip.js";

const MANYLINUX = /^manylinux_(\d+)_(\d+)_x86_64$/u;

function platformLockOf(hostNode, platform) {
  const platformLock = hostNode.platforms[platform];
  if (!platformLock) throw new TypeError(`unsupported host wheel platform: ${platform}`);
  return platformLock;
}

function assertArchive(bytes, platformLock, source = "input") {
  const actual = createHash("sha256").update(bytes).digest("hex");
  if (actual !== platformLock.sha256) {
    throw new Error(`Node runtime checksum mismatch for ${platformLock.archive} from ${source}: ${actual}`);
  }
}

// tar는 작업 폴더 안의 상대 경로로만 부른다. GNU tar가 Windows 드라이브 문자를 원격 host로 읽지 않게 한다.
async function untarGz(bytes, members = []) {
  const workspace = await mkdtemp(join(tmpdir(), "pyproc-host-payload-"));
  try {
    await writeFile(join(workspace, "archive.tar.gz"), bytes);
    await mkdir(join(workspace, "tree"));
    const result = spawnSync("tar", ["-xzf", "archive.tar.gz", "-C", "tree", ...members],
      { cwd: workspace, encoding: "utf8" });
    if (result.status !== 0) throw new Error(`tar extraction failed: ${String(result.stderr || "").trim()}`);
    const paths = members.length ? members : await treeFiles(join(workspace, "tree"), "");
    return Promise.all(paths.map(async (path) => ({ path, bytes: await readFile(join(workspace, "tree", path)) })));
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
}

async function treeFiles(directory, prefix) {
  const found = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) found.push(...await treeFiles(join(directory, entry.name), path));
    else if (entry.isFile()) found.push(path);
    else throw new Error(`host payload contains a non-regular file: ${path}`);
  }
  return found;
}

// cache의 archive도 매번 checksum을 다시 본다. 새로 받은 byte는 확인된 뒤에만 임시 파일을 거쳐 cache로 옮긴다.
export async function fetchNodeArchive(hostNode, platform, cacheDir) {
  const platformLock = platformLockOf(hostNode, platform);
  const cached = join(cacheDir, platformLock.archive);
  if (existsSync(cached)) {
    const bytes = await readFile(cached);
    assertArchive(bytes, platformLock, cached);
    return bytes;
  }
  const response = await fetch(new URL(platformLock.archive, hostNode.distUrl));
  if (!response.ok) throw new Error(`Node runtime download failed(${response.status}): ${platformLock.archive}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  assertArchive(bytes, platformLock, response.url);
  await mkdir(cacheDir, { recursive: true });
  const partial = `${cached}.${process.pid}.partial`;
  await writeFile(partial, bytes);
  await rename(partial, cached);
  return bytes;
}

/** The highest GLIBC symbol version an ELF binary names; a manylinux_X_Y tag is honest only at or below X.Y. */
export function requiredGlibc(binary) {
  let highest = [0, 0];
  for (const match of Buffer.from(binary).toString("latin1").matchAll(/GLIBC_(\d+)\.(\d+)/gu)) {
    const version = [Number(match[1]), Number(match[2])];
    if (version[0] > highest[0] || (version[0] === highest[0] && version[1] > highest[1])) highest = version;
  }
  return highest;
}

export async function extractNodeRuntime(bytes, hostNode, platform) {
  const platformLock = platformLockOf(hostNode, platform);
  assertArchive(bytes, platformLock);
  const members = [platformLock.binary, platformLock.license];
  let files;
  if (platformLock.archive.endsWith(".zip")) {
    const entries = new Map(await unzipWheel(bytes));
    files = members.map((path) => ({ path, bytes: entries.get(path) }));
  } else if (platformLock.archive.endsWith(".tar.gz")) {
    files = await untarGz(bytes, members);
  } else {
    throw new Error(`unsupported Node runtime archive: ${platformLock.archive}`);
  }
  const [binary, license] = files.map((file) => {
    if (!file.bytes?.byteLength) throw new Error(`Node runtime archive has no ${file.path}`);
    return Buffer.from(file.bytes);
  });
  const manylinux = MANYLINUX.exec(platform);
  if (manylinux) {
    const [major, minor] = requiredGlibc(binary);
    const [tagMajor, tagMinor] = [Number(manylinux[1]), Number(manylinux[2])];
    if (major === 0 || major > tagMajor || (major === tagMajor && minor > tagMinor)) {
      throw new Error(`Node runtime needs glibc ${major}.${minor}, which ${platform} does not promise`);
    }
  }
  return Object.freeze({
    version: hostNode.version,
    archive: platformLock.archive,
    archiveSha256: platformLock.sha256,
    binaryName: platformLock.binary.split("/").at(-1),
    binary,
    license,
  });
}

function assertUserBrowserHostArchive(bytes, lockEntry, source = "input") {
  const actual = createHash("sha256").update(bytes).digest("hex");
  if (actual !== lockEntry.sha256) {
    throw new Error(`user-browser host checksum mismatch for ${lockEntry.archive} from ${source}: ${actual}`);
  }
}

// Node와 같다: cache의 byte도 매번 다시 보고, 새로 받은 byte는 확인된 뒤에만 cache로 옮긴다.
export async function fetchUserBrowserHost(lockEntry, cacheDir) {
  const cached = join(cacheDir, lockEntry.archive);
  if (existsSync(cached)) {
    const bytes = await readFile(cached);
    assertUserBrowserHostArchive(bytes, lockEntry, cached);
    return bytes;
  }
  const response = await fetch(lockEntry.url);
  if (!response.ok) throw new Error(`user-browser host download failed(${response.status}): ${lockEntry.url}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  assertUserBrowserHostArchive(bytes, lockEntry, response.url);
  await mkdir(cacheDir, { recursive: true });
  const partial = `${cached}.${process.pid}.partial`;
  await writeFile(partial, bytes);
  await rename(partial, cached);
  return bytes;
}

/** The host and its notices from the verified release zip, whose identity must name the source tree the lock pins. */
export async function extractUserBrowserHost(bytes, lockEntry) {
  assertUserBrowserHostArchive(bytes, lockEntry);
  const entries = new Map(await unzipWheel(bytes));
  const digest = (value) => createHash("sha256").update(value).digest("hex");
  const identity = JSON.parse(Buffer.from(entries.get("userBrowserHost.json") || "null").toString("utf8"));
  const binary = entries.get(identity?.host?.file);
  const notices = entries.get(identity?.notices?.file);
  if (identity?.sourceTree !== lockEntry.sourceTree || !binary || !notices
    || digest(binary) !== identity.host.sha256 || digest(notices) !== identity.notices.sha256) {
    throw new Error(`user-browser host ${lockEntry.archive} does not hold the host of source tree ${lockEntry.sourceTree}`);
  }
  return Object.freeze({
    sourceTree: identity.sourceTree,
    archive: lockEntry.archive,
    archiveSha256: lockEntry.sha256,
    binaryName: identity.host.file,
    binary: Buffer.from(binary),
    sha256: identity.host.sha256,
    notices: Buffer.from(notices),
  });
}

/** Every regular file of an npm package tarball, as `package/...` paths. */
export async function readPackageTree(tarball) {
  const files = await untarGz(tarball);
  if (!files.length || files.some((file) => !file.path.startsWith("package/"))) {
    throw new Error("npm package tarball must hold only package/ files");
  }
  return files;
}
