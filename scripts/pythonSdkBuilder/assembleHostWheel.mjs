// assembleHostWheel.mjs - 순수 pyproc-control wheel에 같은 commit의 npm package tree와 고정 Node runtime을 더해
// platform wheel 한 개의 byte를 만든다. I/O가 없는 순수 함수라 같은 입력이면 같은 byte다.
// setuptools는 dist-info 글을 text mode로 써서 Windows에서는 CRLF가 된다. 그 글은 LF로 맞춰 build host와 무관하게 한다.
import { createHash } from "node:crypto";
import { createDeterministicZip } from "../engineBuilder/deterministicZip.mjs";

const HOST = "pyprocControl/host";
const COMMANDS = Object.freeze({
  "pyproc-control": "package/scripts/pyprocControl.mjs",
  "pyproc-mcp": "package/scripts/pyprocMcp.mjs",
});
const ENTRY_MODULE = "pyprocControl/bundledHost.py";
const ENTRY_POINTS = [
  "[console_scripts]",
  "pyproc-control = pyprocControl.bundledHost:controlMain",
  "pyproc-mcp = pyprocControl.bundledHost:mcpMain",
  "",
].join("\n");

function recordHash(bytes) {
  return createHash("sha256").update(bytes).digest("base64url");
}

// RECORD는 CSV다. 쉼표나 따옴표가 든 경로는 따옴표로 감싼다.
function recordPath(path) {
  return /[",\r\n]/u.test(path) ? `"${path.replaceAll('"', '""')}"` : path;
}

function lineFeeds(bytes) {
  return Buffer.from(Buffer.from(bytes).toString("utf8").replaceAll("\r\n", "\n"));
}

// METADATA 머리말 끝(첫 빈 줄) 안에서 마지막 License-File 뒤에 host가 싣는 license 고지들을 더한다.
function withLicenses(metadata, licenseFiles) {
  const headerEnd = metadata.indexOf("\n\n");
  const header = headerEnd < 0 ? metadata : metadata.slice(0, headerEnd);
  const lines = header.split("\n");
  const last = lines.findLastIndex((line) => line.startsWith("License-File: "));
  if (last < 0) throw new Error("pure wheel METADATA declares no License-File");
  lines.splice(last + 1, 0, ...licenseFiles.map((file) => `License-File: ${file}`));
  return `${lines.join("\n")}${headerEnd < 0 ? "" : metadata.slice(headerEnd)}`;
}

/**
 * Build one platform wheel.
 * pureWheel: { filename, files: [[path, bytes]] } from the setuptools build of the same commit.
 * packageFiles: [{ path: "package/...", bytes }] from the canonical npm package tarball.
 * packageIdentity: { name, version, filename, sha256, integrity } of that tarball.
 * nodeRuntime: the checksum-verified result of extractNodeRuntime.
 * userBrowserHost: the verified result of extractUserBrowserHost, which exactly the win_amd64 wheel carries.
 */
export function assembleHostWheel({ platform, pureWheel, packageFiles, packageIdentity, nodeRuntime, userBrowserHost = null,
  sourceDateEpoch }) {
  if (!/^(win_amd64|manylinux_\d+_\d+_x86_64)$/u.test(platform)) throw new TypeError(`unsupported wheel platform: ${platform}`);
  if ((platform === "win_amd64") !== Boolean(userBrowserHost)) {
    throw new Error(`the user-browser native host belongs in exactly the win_amd64 wheel, not ${platform}`);
  }
  if (!Number.isSafeInteger(sourceDateEpoch) || sourceDateEpoch < 315532800) {
    throw new TypeError("sourceDateEpoch must be a Unix time from 1980 onward");
  }
  const match = /^pyproc_control-(\d+\.\d+\.\d+)-py3-none-any\.whl$/u.exec(pureWheel.filename);
  if (!match) throw new Error(`unexpected pure wheel: ${pureWheel.filename}`);
  const version = match[1];
  if (packageIdentity.name !== "pyproc" || packageIdentity.version !== version) {
    throw new Error(`host package ${packageIdentity.name}@${packageIdentity.version} does not match wheel ${version}`);
  }
  const distInfo = `pyproc_control-${version}.dist-info`;
  const entries = [];
  let metadata = null;
  for (const [path, bytes] of pureWheel.files) {
    if (path === `${distInfo}/WHEEL` || path === `${distInfo}/RECORD`) continue;
    if (path === `${distInfo}/entry_points.txt`) {
      throw new Error("the pure wheel must not declare commands; only a wheel that carries the host may");
    }
    if (path.startsWith(`${HOST}/`) || path.startsWith(`${distInfo}/licenses/node/`)) {
      throw new Error(`the pure wheel already holds host content: ${path}`);
    }
    if (path === `${distInfo}/METADATA`) metadata = lineFeeds(bytes).toString("utf8");
    else entries.push({ path, bytes: path.startsWith(`${distInfo}/`) ? lineFeeds(bytes) : bytes });
  }
  if (metadata === null) throw new Error("pure wheel has no METADATA");
  if (!entries.some((entry) => entry.path === ENTRY_MODULE)) {
    throw new Error(`the pure wheel has no ${ENTRY_MODULE}, which the platform wheel commands run`);
  }

  const packagePaths = new Set(packageFiles.map((file) => file.path));
  for (const script of Object.values(COMMANDS)) {
    if (!packagePaths.has(script)) throw new Error(`host package has no ${script}`);
  }
  for (const file of packageFiles) {
    if (!file.path.startsWith("package/")) throw new Error(`host package file outside package/: ${file.path}`);
    entries.push({ path: `${HOST}/${file.path}`, bytes: file.bytes });
  }
  const nodePath = `node/${nodeRuntime.binaryName}`;
  const descriptor = {
    schemaVersion: 1,
    platform,
    node: { version: nodeRuntime.version, path: nodePath, archive: nodeRuntime.archive,
      archiveSha256: nodeRuntime.archiveSha256 },
    package: { name: packageIdentity.name, version: packageIdentity.version, filename: packageIdentity.filename,
      sha256: packageIdentity.sha256, integrity: packageIdentity.integrity },
    commands: COMMANDS,
  };
  const licenseFiles = ["node/LICENSE"];
  if (userBrowserHost) {
    // The installer finds the host through host.json and checks its SHA-256 before installing it.
    const hostPath = `userBrowserHost/${userBrowserHost.binaryName}`;
    descriptor.userBrowserHost = { path: hostPath, sha256: userBrowserHost.sha256, sourceTree: userBrowserHost.sourceTree,
      archive: userBrowserHost.archive, archiveSha256: userBrowserHost.archiveSha256 };
    licenseFiles.push("userBrowserHost/THIRD-PARTY-NOTICES.txt");
    entries.push(
      { path: `${HOST}/${hostPath}`, bytes: userBrowserHost.binary, mode: 0o755 },
      { path: `${distInfo}/licenses/userBrowserHost/THIRD-PARTY-NOTICES.txt`, bytes: userBrowserHost.notices },
    );
  }
  entries.push(
    { path: `${HOST}/${nodePath}`, bytes: nodeRuntime.binary, mode: 0o755 },
    { path: `${HOST}/host.json`, bytes: Buffer.from(`${JSON.stringify(descriptor, null, 2)}\n`) },
    { path: `${distInfo}/METADATA`, bytes: Buffer.from(withLicenses(metadata, licenseFiles)) },
    { path: `${distInfo}/licenses/node/LICENSE`, bytes: nodeRuntime.license },
    { path: `${distInfo}/entry_points.txt`, bytes: Buffer.from(ENTRY_POINTS) },
    { path: `${distInfo}/WHEEL`, bytes: Buffer.from([
      "Wheel-Version: 1.0",
      "Generator: pyproc-python-distributions (1)",
      "Root-Is-Purelib: false",
      `Tag: py3-none-${platform}`,
      "",
    ].join("\n")) },
  );
  const record = entries.map((entry) =>
    `${recordPath(entry.path)},sha256=${recordHash(entry.bytes)},${entry.bytes.byteLength}`);
  record.push(`${distInfo}/RECORD,,`);
  entries.push({ path: `${distInfo}/RECORD`, bytes: Buffer.from(`${record.sort().join("\n")}\n`) });
  return Object.freeze({
    filename: `pyproc_control-${version}-py3-none-${platform}.whl`,
    bytes: createDeterministicZip(entries, sourceDateEpoch),
  });
}
