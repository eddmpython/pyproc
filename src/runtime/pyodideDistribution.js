// pyodideDistribution.js - Layer 0: 기본 Python engine distribution의 주소와 trust anchor.
// 버전·same-origin 경로·핵심 바이트 해시는 한 계약이다. 배포 준비는 같은 값을
// scripts/assetCatalog.json과 대조하고, runtime은 부팅 전에 SRI로 다시 확인한다.

export const PYODIDE_VERSION = "314.0.2";
export const DEFAULT_INDEX = "/vendor/pyodide/";
export const EVALUATION_INDEX = `https://cdn.jsdelivr.net/pyodide/v${PYODIDE_VERSION}/full/`;

export const DEFAULT_ENGINE_SCRIPT_INTEGRITY = "sha256-lfxN5g9RXj9cSprNhoSQaPjlzAgYZSwJY+Q94IubLzA=";

// package wheel은 pyodide-lock.json이 별도 SHA-256을 소유한다. 이 map은 CPython을 실제로
// 부팅하는 core graph를 fail-closed로 봉인하고, package 파일은 lock의 검증 경로에 맡긴다.
export const DEFAULT_CORE_INTEGRITY = Object.freeze({
  required: false,
  files: Object.freeze({
    "pyodide.js": DEFAULT_ENGINE_SCRIPT_INTEGRITY,
    "pyodide.mjs": "sha256-lV0giLu3/HmnPEgCrKI3DB2Vv9+v+kEh4Prr2isOo/k=",
    "pyodide.asm.mjs": "sha256-x+zN/reoQZ1h+RDwaFtFzVYQt/9bvoRMPBBQ7mYjtkE=",
    "pyodide.asm.wasm": "sha256-96ihaeUTeR4Y+geQ+2nW8mVrd56QErpX4D6XPw3ws58=",
    "python_stdlib.zip": "sha256-EBqclMpjBMFHjIm3tZUTa5pRtCib3FtGfYbbVT7+6bM=",
    "pyodide-lock.json": "sha256-yWPSKFj2vLj0FYaiFC8DkFqzcMiOoiqGonNulfrCqPM=",
  }),
});
