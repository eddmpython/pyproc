// pyproc - 역사를 가진 브라우저 컴퓨터.
// 서버 없이 브라우저 탭에서 도는 진짜 런타임 파이썬. 상태(힙·파일·장치)는 두 구역의 단일
// 역사 저장소에 살고, root가 제품의 문을 한곳에 모은다: open은 기본 내구 Machine과 부활,
// boot은 명시적 휘발 Machine, createWebComputer는 multi-guest host, checkEnvironment는 사전
// 진단이다. 상세 능력은 각 반환 handle과 이름 있는 subpath 아래에만 산다.
//
// plumbing subpath: pyproc/history(커널 계약·store·bundle), pyproc/machine(컴퓨터 상세),
// pyproc/worker(워커 자산 계약), pyproc/assets(배포 자산 무결성). 강등 표면(gpu/socket/wasi)은
// 계약 실태 표(docs/operations/contractReality.md)가 정본이다.
//
// 표면 정본: index.d.ts(시그니처)와 docs/reference/api.md(영문 레퍼런스). 여기 목록을 두지
// 않는 이유: 손 유지 목록은 실물과 표류한다(2026-07-16 실측: 8개 어긋난 채 방치).
//
// 지원: Chromium/Edge (JSPI + SharedArrayBuffer + crossOriginIsolated). Firefox/Safari 미지원.
export { boot, open } from "./src/machine/composition/pyprocMachine.js";
export { createWebComputer } from "./src/machine/index.js";
export { checkEnvironment } from "./src/composition/runtimeApi.js";
export { PyProcError, PYPROC_ERROR_CODES } from "./src/runtime/errors.js";
