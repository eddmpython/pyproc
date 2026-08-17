// Buildroot guest profile 정본. build 스크립트와 계약이 같은 identity를 쓴다.
export const BUILDROOT = Object.freeze({
  version: "2025.02.16",
  revision: "2d05bb10d08410c59856ff4022ba8b762f77441a",
  commit: "135af563b945b8c3d18f8fd370370075b9edb140",
  repository: "https://gitlab.com/buildroot.org/buildroot.git",
  sourceUrl: "https://buildroot.org/downloads/buildroot-2025.02.16.tar.xz",
  sourceSha256: "15305e3d366eeaf4a5ecaf2ed42f685fd6af7fe5dbf1f62e1de5f46ee83225e2",
  sourceDateEpoch: 1784143163,
});

export const NODE_RUNTIME = Object.freeze({
  name: "node",
  version: "22.22.0",
  revision: "6add85e4c46b8be383c8b637102d6b6fd206adce",
  repository: "https://github.com/nodejs/node.git",
  sourceUrl: "https://nodejs.org/dist/v22.22.0/node-v22.22.0.tar.xz",
  sourceSha256: "4c138012bb5352f49822a8f3e6d1db71e00639d0c36d5b6756f91e4c6f30b683",
  oracle: Object.freeze({
    source: "pyproc-node-guest",
    sha256: "b3aed4be1f24f10fa77253e267fe69403144d97072cfe305c828a7ce0c8589c0",
  }),
});

// CPython 3.12.13은 Buildroot 2025.02.16 package/python3 정본이다.
// source SHA-256은 그 package의 python3.hash, revision은 cpython tag v3.12.13 commit.
export const PYTHON_RUNTIME = Object.freeze({
  name: "python",
  version: "3.12.13",
  revision: "3bb231a6a5dc02b95658877318bf61501a7209e9",
  repository: "https://github.com/python/cpython.git",
  sourceUrl: "https://www.python.org/ftp/python/3.12.13/Python-3.12.13.tar.xz",
  sourceSha256: "c08bc65a81971c1dd5783182826503369466c7e67374d1646519adf05207b684",
  pipVersion: "25.2",
  oracle: Object.freeze({
    source: "pyproc-linux-python",
    sha256: "7db90ff6cb9fbe037eee80ca9ed8c5bc516b51d1f9745dd0900a66269fcf7d9f",
  }),
});

export const PROFILES = Object.freeze({
  linux: Object.freeze({
    recipe: "pyproc-buildroot-i686-v2",
    outputName: "buildroot-pyproc-i686.bin",
    configFragments: Object.freeze([]),
    runtime: null,
    requiredConfig: Object.freeze([]),
    oracleExecutable: null,
  }),
  node: Object.freeze({
    recipe: "pyproc-buildroot-node-i686-v1",
    outputName: "buildroot-pyproc-node-i686.bin",
    configFragments: Object.freeze(["node.fragment"]),
    runtime: NODE_RUNTIME,
    requiredConfig: Object.freeze([
      "BR2_TOOLCHAIN_BUILDROOT_CXX=y",
      "BR2_INSTALL_LIBSTDCPP=y",
      "BR2_PACKAGE_NODEJS=y",
      "BR2_PACKAGE_OPENSSL=y",
      "BR2_PACKAGE_HOST_QEMU=y",
      "BR2_PACKAGE_HOST_QEMU_LINUX_USER_MODE=y",
    ]),
    oracleExecutable: Object.freeze(["usr", "bin", "node"]),
  }),
  python: Object.freeze({
    recipe: "pyproc-buildroot-python-i686-v1",
    outputName: "buildroot-pyproc-python-i686.bin",
    configFragments: Object.freeze(["python.fragment"]),
    runtime: PYTHON_RUNTIME,
    requiredConfig: Object.freeze([
      "BR2_PACKAGE_PYTHON3=y",
      "BR2_PACKAGE_PYTHON3_SSL=y",
      "BR2_PACKAGE_PYTHON_PIP=y",
      "BR2_PACKAGE_OPENSSL=y",
      "BR2_PACKAGE_HOST_QEMU=y",
      "BR2_PACKAGE_HOST_QEMU_LINUX_USER_MODE=y",
    ]),
    oracleExecutable: Object.freeze(["usr", "bin", "python3"]),
  }),
});

export function expectedRuntimeOracleVersion(runtime) {
  if (!runtime) return null;
  return runtime.name === "node" ? `v${runtime.version}` : runtime.version;
}

export function nodeOracleProgram(source) {
  return [
    "const crypto = require('node:crypto')",
    `const sha256 = crypto.createHash('sha256').update(${JSON.stringify(source)}).digest('hex')`,
    "process.stdout.write(JSON.stringify({ version: process.version, sha256 }))",
  ].join(";");
}

export function pythonOracleProgram(source) {
  return [
    "import hashlib,json,sys",
    `print(json.dumps({"version":sys.version.split()[0],"sha256":hashlib.sha256(${JSON.stringify(source)}.encode()).hexdigest()}),end="")`,
  ].join(";");
}
