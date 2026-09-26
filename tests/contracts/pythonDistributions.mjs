// pythonDistributions.mjs - platform wheel 조립, Node runtime과 native host의 checksum, 교차 host 대조의 계약을
// 합성 입력으로 고정한다.
// 실제 Node와 npm package를 싣은 wheel의 설치와 세션은 tests/pythonSdk/run.mjs의 제품 게이트가 본다.
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { unzipWheel } from "../../src/runtime/engines/wasi/wheelUnzip.js";
import { createDeterministicZip } from "../../scripts/engineBuilder/deterministicZip.mjs";
import { assembleHostWheel } from "../../scripts/pythonSdkBuilder/assembleHostWheel.mjs";
import { extractNativeHost, extractNodeRuntime, fetchNativeHost, fetchNodeArchive, readPackageTree }
  from "../../scripts/pythonSdkBuilder/hostPayload.mjs";
import { nativeHostArchiveName, nativeHostSourceTree } from "../../scripts/nativeHostBuilder/buildNativeHost.mjs";
import { verifyPythonDistributions } from "../../scripts/pythonSdkBuilder/verifyPythonDistributions.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function rejects(action, pattern) {
  let message = "";
  try { await action(); }
  catch (error) { message = String(error?.message || error); }
  assert(pattern.test(message), `expected ${pattern}, got ${message || "success"}`);
}

function tarGz(directory, archive, members) {
  const result = spawnSync("tar", ["-czf", archive, ...members], { cwd: directory, encoding: "utf8" });
  assert(result.status === 0, `fixture tar failed: ${result.stderr}`);
}

// 중앙 디렉터리의 external attributes에서 Unix 권한 비트를 읽는다.
function zipModes(bytes) {
  const end = bytes.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  const modes = new Map();
  let offset = bytes.readUInt32LE(end + 16);
  for (let index = 0; index < bytes.readUInt16LE(end + 10); index += 1) {
    const nameLength = bytes.readUInt16LE(offset + 28);
    const name = bytes.toString("utf8", offset + 46, offset + 46 + nameLength);
    modes.set(name, Math.floor(bytes.readUInt32LE(offset + 38) / 0x10000));
    offset += 46 + nameLength + bytes.readUInt16LE(offset + 30) + bytes.readUInt16LE(offset + 32);
  }
  return modes;
}

// newline은 setuptools가 dist-info 글을 쓰는 줄바꿈이다. Windows build는 METADATA를 CRLF로 쓴다.
function pureWheelFixture(extra = [], { newline = "\n", without = null } = {}) {
  const distInfo = "pyproc_control-1.2.3.dist-info";
  const lines = (value) => Buffer.from(value.replaceAll("\n", newline));
  return {
    filename: "pyproc_control-1.2.3-py3-none-any.whl",
    files: [
      ["pyprocControl/__init__.py", Buffer.from("from .client import PyProcClient\n")],
      ["pyprocControl/bundledHost.py", Buffer.from("HOST_ROOT = None\n")],
      [`${distInfo}/METADATA`, lines("Metadata-Version: 2.4\nName: pyproc-control\nVersion: 1.2.3\n"
        + "License-Expression: MPL-2.0\nLicense-File: LICENSE.txt\n\nlong description\n")],
      [`${distInfo}/WHEEL`, Buffer.from("Wheel-Version: 1.0\nRoot-Is-Purelib: true\nTag: py3-none-any\n")],
      [`${distInfo}/RECORD`, Buffer.from("stale\n")],
      [`${distInfo}/top_level.txt`, lines("pyprocControl\n")],
      [`${distInfo}/licenses/LICENSE.txt`, Buffer.from("MPL-2.0\n")],
      ...extra,
    ].filter(([path]) => path !== without),
  };
}

async function manifestFixture(directory, wheelBytes) {
  const filename = "pyproc_control-1.2.3-py3-none-win_amd64.whl";
  await writeFile(join(directory, filename), wheelBytes);
  const manifest = {
    schemaVersion: 1,
    recipe: "pyproc-python-distributions-v1",
    source: { commit: "a".repeat(40), tree: "b".repeat(40), sourceDateEpoch: 1790000000 },
    hostPackage: { name: "pyproc", version: "1.2.3" },
    hostNode: { version: "9.9.9" },
    nativeHosts: { userBrowserHost: { sourceTree: "d".repeat(40), archiveSha256: "f".repeat(64) } },
    distributions: [{ filename, kind: "hostWheel", platform: "win_amd64", byteLength: wheelBytes.byteLength,
      sha256: sha256(wheelBytes) }],
  };
  await writeFile(join(directory, "python-distributions-manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
}

export async function assertPythonDistributions() {
  const lock = JSON.parse(await readFile(join(root, "scripts/pythonSdkBuilder/pythonDistributionLock.json"), "utf8"));
  assert(lock.recipe === "pyproc-python-distributions-v1"
    && Object.keys(lock.hostNode.platforms).join(",") === "win_amd64,manylinux_2_28_x86_64"
    && Object.values(lock.hostNode.platforms).every((item) => /^[0-9a-f]{64}$/u.test(item.sha256)
      && item.archive.startsWith(`node-v${lock.hostNode.version}-`)),
  "Python distribution lock must pin a checksum for each official Node archive");
  // The lock pins each host built from exactly this commit's host source; changing a source needs a new pinned build.
  assert(/^\d+\.\d+\.\d+$/u.test(lock.nativeHosts?.toolchain || "") && lock.nativeHosts.target === "x86_64-pc-windows-msvc",
    "Python distribution lock must pin the Rust toolchain of the native hosts");
  for (const [component, pinned] of Object.entries(lock.nativeHosts.components)) {
    assert(/^[0-9a-f]{64}$/u.test(pinned?.sha256 || "") && pinned.sourceTree === nativeHostSourceTree(component, "HEAD", root)
      && pinned.archive === nativeHostArchiveName(component, pinned.sourceTree)
      && pinned.url === `https://github.com/eddmpython/pyproc/releases/download/${pinned.archive.slice(0, -4)}/${
        pinned.archive}`,
    `Python distribution lock must pin the released ${component} of this commit's host source`);
  }

  const temporary = await mkdtemp(join(tmpdir(), "pyproc-python-distributions-contract-"));
  try {
    const winRoot = "node-v9.9.9-win-x64";
    const winArchive = createDeterministicZip([
      { path: `${winRoot}/node.exe`, bytes: Buffer.from("MZ fake node") },
      { path: `${winRoot}/LICENSE`, bytes: Buffer.from("Node license\r\n") },
      { path: `${winRoot}/node_modules/npm/index.js`, bytes: Buffer.from("npm") },
    ], 1790000000);
    const linuxRoot = "node-v9.9.9-linux-x64";
    await mkdir(join(temporary, linuxRoot, "bin"), { recursive: true });
    await writeFile(join(temporary, linuxRoot, "LICENSE"), "Node license\n");
    await writeFile(join(temporary, linuxRoot, "bin", "node"), "\x7fELF GLIBC_2.17\0GLIBC_2.28\0");
    tarGz(temporary, "linux.tar.gz", [linuxRoot]);
    const linuxArchive = await readFile(join(temporary, "linux.tar.gz"));
    await writeFile(join(temporary, linuxRoot, "bin", "node"), "\x7fELF GLIBC_2.17\0GLIBC_2.34\0");
    tarGz(temporary, "linuxNew.tar.gz", [linuxRoot]);
    const linuxNewArchive = await readFile(join(temporary, "linuxNew.tar.gz"));
    const hostNode = {
      version: "9.9.9",
      distUrl: "https://nodejs.invalid/dist/v9.9.9/",
      platforms: {
        win_amd64: { archive: `${winRoot}.zip`, sha256: sha256(winArchive), binary: `${winRoot}/node.exe`,
          license: `${winRoot}/LICENSE` },
        manylinux_2_28_x86_64: { archive: `${linuxRoot}.tar.gz`, sha256: sha256(linuxArchive),
          binary: `${linuxRoot}/bin/node`, license: `${linuxRoot}/LICENSE` },
      },
    };

    // 음성: checksum이 한 byte라도 다르면 runtime은 wheel로 넘어가지 않는다. cache의 byte도 다시 본다.
    const tampered = Buffer.from(winArchive);
    tampered[tampered.length - 30] ^= 1;
    await rejects(() => extractNodeRuntime(tampered, hostNode, "win_amd64"), /checksum mismatch/u);
    const cacheDir = join(temporary, "cache");
    await mkdir(cacheDir);
    await writeFile(join(cacheDir, `${winRoot}.zip`), tampered);
    await rejects(() => fetchNodeArchive(hostNode, "win_amd64", cacheDir), /checksum mismatch/u);
    await writeFile(join(cacheDir, `${winRoot}.zip`), winArchive);
    assert((await fetchNodeArchive(hostNode, "win_amd64", cacheDir)).equals(winArchive),
      "a verified cached Node archive was not reused");
    // 음성: manylinux 태그가 약속한 glibc보다 새 symbol을 요구하는 binary는 거절한다.
    await rejects(() => extractNodeRuntime(linuxNewArchive,
      { ...hostNode, platforms: { manylinux_2_28_x86_64: { ...hostNode.platforms.manylinux_2_28_x86_64,
        sha256: sha256(linuxNewArchive) } } }, "manylinux_2_28_x86_64"), /glibc 2\.34/u);

    await writeFile(join(temporary, "package.json"), "{}");
    await mkdir(join(temporary, "package", "scripts"), { recursive: true });
    await writeFile(join(temporary, "package", "package.json"), "{\"name\":\"pyproc\",\"version\":\"1.2.3\"}");
    await writeFile(join(temporary, "package", "scripts", "pyprocControl.mjs"), "control");
    await writeFile(join(temporary, "package", "scripts", "pyprocMcp.mjs"), "mcp");
    await writeFile(join(temporary, "package", "a,b.txt"), "comma");
    tarGz(temporary, "pyproc-1.2.3.tgz", ["package"]);
    const packageFiles = await readPackageTree(await readFile(join(temporary, "pyproc-1.2.3.tgz")));
    assert(packageFiles.map((file) => file.path).sort().join("|")
      === "package/a,b.txt|package/package.json|package/scripts/pyprocControl.mjs|package/scripts/pyprocMcp.mjs",
    "npm package tree was not read exactly");
    const packageIdentity = { name: "pyproc", version: "1.2.3", filename: "pyproc-1.2.3.tgz",
      sha256: "c".repeat(64), integrity: "sha512-fixture" };

    // A native host rides only in the win_amd64 wheel, from a release zip whose checksum and identity match.
    const hostTree = "d".repeat(40);
    const hostZip = (identity) => createDeterministicZip([
      { path: "fake-host.exe", bytes: Buffer.from("MZ fake host"), mode: 0o755 },
      { path: "THIRD-PARTY-NOTICES.txt", bytes: Buffer.from("crate notices\n") },
      { path: "userBrowserHost.json", bytes: Buffer.from(JSON.stringify(identity)) },
    ], 1790000000);
    const identity = { sourceTree: hostTree, host: { file: "fake-host.exe", sha256: sha256(Buffer.from("MZ fake host")) },
      notices: { file: "THIRD-PARTY-NOTICES.txt", sha256: sha256(Buffer.from("crate notices\n")) } };
    const hostArchive = hostZip(identity);
    const hostLock = { sourceTree: hostTree, archive: nativeHostArchiveName("userBrowserHost", hostTree),
      sha256: sha256(hostArchive), url: "https://pyproc.invalid/host.zip" };
    const userBrowserHost = await extractNativeHost("userBrowserHost", hostArchive, hostLock);
    const tamperedHost = Buffer.from(hostArchive);
    tamperedHost[tamperedHost.length - 30] ^= 1;
    await rejects(() => extractNativeHost("userBrowserHost", tamperedHost, hostLock), /host checksum mismatch/u);
    const otherTree = hostZip({ ...identity, sourceTree: "e".repeat(40) });
    await rejects(() => extractNativeHost("userBrowserHost", otherTree, { ...hostLock, sha256: sha256(otherTree) }),
      /does not hold the host of source tree d{40}/u);
    // An archive holds the identity of the host it was built as; another host's name finds none.
    await rejects(() => extractNativeHost("browserDesktop", hostArchive, hostLock),
      /does not hold the host of source tree d{40}/u);
    await writeFile(join(cacheDir, hostLock.archive), tamperedHost);
    await rejects(() => fetchNativeHost("userBrowserHost", hostLock, cacheDir), /host checksum mismatch/u);
    await writeFile(join(cacheDir, hostLock.archive), hostArchive);
    assert((await fetchNativeHost("userBrowserHost", hostLock, cacheDir)).equals(hostArchive),
      "a verified cached host was not reused");

    const build = async (platform, archive, overrides = {}) => assembleHostWheel({
      platform,
      pureWheel: pureWheelFixture(),
      packageFiles,
      packageIdentity,
      nodeRuntime: await extractNodeRuntime(archive, hostNode, platform),
      nativeHosts: platform === "win_amd64" ? [userBrowserHost] : [],
      sourceDateEpoch: 1790000000,
      ...overrides,
    });

    const windows = await build("win_amd64", winArchive);
    const reordered = await build("win_amd64", winArchive, { packageFiles: [...packageFiles].reverse() });
    assert(windows.filename === "pyproc_control-1.2.3-py3-none-win_amd64.whl"
      && windows.bytes.equals(reordered.bytes), "the platform wheel depends on input order");
    const crlfBuilt = await build("win_amd64", winArchive, { pureWheel: pureWheelFixture([], { newline: "\r\n" }) });
    assert(crlfBuilt.bytes.equals(windows.bytes), "the platform wheel depends on the build host's line endings");
    const files = new Map((await unzipWheel(windows.bytes)).map(([path, bytes]) => [path, Buffer.from(bytes)]));
    const distInfo = "pyproc_control-1.2.3.dist-info";
    const text = (path) => files.get(path)?.toString("utf8");
    assert(text(`${distInfo}/WHEEL`).includes("Root-Is-Purelib: false\nTag: py3-none-win_amd64\n"),
      "platform wheel tag is wrong");
    assert(text(`${distInfo}/entry_points.txt`) === "[console_scripts]\n"
      + "pyproc-control = pyprocControl.bundledHost:controlMain\npyproc-mcp = pyprocControl.bundledHost:mcpMain\n",
    "platform wheel commands are wrong");
    assert(text(`${distInfo}/METADATA`).startsWith("Metadata-Version: 2.4\nName: pyproc-control\nVersion: 1.2.3\n"
      + "License-Expression: MPL-2.0\nLicense-File: LICENSE.txt\nLicense-File: node/LICENSE\n"
      + "License-File: userBrowserHost/THIRD-PARTY-NOTICES.txt\n\nlong description"),
    "platform wheel METADATA must add the Node and user-browser host notices after the existing notices");
    assert(text(`${distInfo}/licenses/node/LICENSE`) === "Node license\r\n", "Node license notice is missing");
    assert(text(`${distInfo}/licenses/userBrowserHost/THIRD-PARTY-NOTICES.txt`) === "crate notices\n",
      "user-browser host notices are missing");
    const descriptor = JSON.parse(text("pyprocControl/host/host.json"));
    assert(descriptor.node.path === "node/node.exe" && descriptor.node.archiveSha256 === sha256(winArchive)
      && descriptor.package.integrity === "sha512-fixture"
      && descriptor.commands["pyproc-control"] === "package/scripts/pyprocControl.mjs"
      && files.get("pyprocControl/host/node/node.exe")?.toString() === "MZ fake node"
      && text("pyprocControl/host/package/scripts/pyprocMcp.mjs") === "mcp"
      && !files.has("pyprocControl/host/node_modules/npm/index.js")
      && descriptor.userBrowserHost.path === "userBrowserHost/fake-host.exe"
      && descriptor.userBrowserHost.sha256 === identity.host.sha256 && descriptor.userBrowserHost.sourceTree === hostTree
      && files.get("pyprocControl/host/userBrowserHost/fake-host.exe")?.toString() === "MZ fake host"
      && zipModes(windows.bytes).get("pyprocControl/host/userBrowserHost/fake-host.exe") === 0o100755,
    "platform wheel host layout is wrong");
    const record = text(`${distInfo}/RECORD`).trim().split("\n");
    assert(record.length === files.size && record.includes(`${distInfo}/RECORD,,`), "RECORD does not list every file");
    assert(record.some((line) => line.startsWith('"pyprocControl/host/package/a,b.txt",sha256=')),
      "RECORD must quote a path that holds a comma");
    for (const line of record.filter((item) => !item.endsWith(",,"))) {
      const quoted = /^"((?:[^"]|"")*)",(.*)$/u.exec(line);
      const [path, hash, size] = quoted ? [quoted[1].replaceAll('""', '"'), ...quoted[2].split(",")] : line.split(",");
      const bytes = files.get(path);
      assert(bytes && hash === `sha256=${createHash("sha256").update(bytes).digest("base64url")}`
        && Number(size) === bytes.byteLength, `RECORD hash is wrong for ${path}`);
    }

    const linux = await build("manylinux_2_28_x86_64", linuxArchive);
    const modes = zipModes(linux.bytes);
    assert(linux.filename === "pyproc_control-1.2.3-py3-none-manylinux_2_28_x86_64.whl"
      && modes.get("pyprocControl/host/node/node") === 0o100755
      && modes.get("pyprocControl/host/host.json") === 0o100644
      && ![...modes.keys()].some((path) => path.includes("userBrowserHost")),
    "the Linux node binary must install executable, every other file must not, and no user-browser host rides along");
    await rejects(() => build("win_amd64", winArchive, { nativeHosts: [] }), /exactly the win_amd64 wheel/u);
    await rejects(() => build("manylinux_2_28_x86_64", linuxArchive, { nativeHosts: [userBrowserHost] }),
      /exactly the win_amd64 wheel/u);

    await rejects(() => build("win_amd64", winArchive, { pureWheel: pureWheelFixture([
      [`${distInfo}/entry_points.txt`, Buffer.from("[console_scripts]\n")]]) }), /must not declare commands/u);
    await rejects(() => build("win_amd64", winArchive, {
      packageFiles: packageFiles.filter((file) => !file.path.endsWith("pyprocMcp.mjs")) }), /no package\/scripts\/pyprocMcp/u);
    await rejects(() => build("win_amd64", winArchive, { packageIdentity: { ...packageIdentity, version: "1.2.4" } }),
      /does not match wheel/u);
    await rejects(() => build("win_amd64", winArchive, { platform: "macosx_11_0_arm64" }),
      /unsupported wheel platform/u);
    await rejects(() => build("win_amd64", winArchive, {
      pureWheel: pureWheelFixture([], { without: "pyprocControl/bundledHost.py" }) }), /no pyprocControl\/bundledHost\.py/u);

    const left = join(temporary, "ubuntu");
    const right = join(temporary, "windows");
    await mkdir(left);
    await mkdir(right);
    await manifestFixture(left, windows.bytes);
    await manifestFixture(right, windows.bytes);
    await writeFile(join(right, windows.filename), Buffer.concat([windows.bytes, Buffer.from([0])]));
    await rejects(() => verifyPythonDistributions({ leftDir: left, rightDir: right, leftOs: "ubuntu",
      rightOs: "windows" }), /integrity mismatch/u);
    await writeFile(join(right, windows.filename), windows.bytes);
    const rightManifestPath = join(right, "python-distributions-manifest.json");
    const rightManifest = await readFile(rightManifestPath, "utf8");
    await writeFile(rightManifestPath, rightManifest.replace('"version": "9.9.9"', '"version": "9.9.8"'));
    await rejects(() => verifyPythonDistributions({ leftDir: left, rightDir: right, leftOs: "ubuntu",
      rightOs: "windows" }), /hostNode differs/u);
    await writeFile(rightManifestPath, rightManifest.replace('"sourceTree": "d', '"sourceTree": "e'));
    await rejects(() => verifyPythonDistributions({ leftDir: left, rightDir: right, leftOs: "ubuntu",
      rightOs: "windows" }), /nativeHosts differs/u);
    await writeFile(rightManifestPath, rightManifest);
    const receipt = await verifyPythonDistributions({ leftDir: left, rightDir: right, leftOs: "ubuntu",
      rightOs: "windows" });
    assert(receipt.byteIdentical && receipt.wheels[0].sha256 === sha256(windows.bytes),
      "cross-host platform wheel receipt is incomplete");
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}
