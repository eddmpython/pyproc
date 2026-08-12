// tests/webMachine/run.mjs - Web Machine probe 러너. 의존성 0.
// 위치: browser/ 아래에는 probes만 둔다는 검증 트리 불변식이 있어 한 단계 위에 산다.
//
// 왜 이 파일이 생겼나: probe 14개가 게이트 폴더에 있으면서 어떤 러너도 돌리지 않았다(2026-07-27
// 감사). 구조 게이트가 그 존재와 경계를 고정하고 문서가 과거 수치를 인용하는데 실행은 0이었다.
// 깨진 채 방치되면 아무도 모르고, 지우면 구조 게이트가 RED가 되는 최악의 조합이다.
//
// 두 레인으로 나눈다. 기본 레인은 자산이 필요 없는 probe라 CI에서 그대로 돈다. --v86 레인은
// gitignore된 x86 자산(engine/firmware/guest image)을 요구하므로 로컬 전용이고, 자산이 없으면
// 조용히 통과하지 않고 명시적으로 실패한다(증거 없음은 통과가 아니다).
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const wantV86 = process.argv.includes("--v86");
const wantWasi = wantV86 || process.argv.includes("--wasi");

// 자산 없이 도는 probe: host 계약, owner 승계, Python guest networking, 내구성 계약.
const ASSET_FREE = [
  "tests/webMachine/browser/probes/hostContractProbe.html",
  "tests/webMachine/browser/probes/ownerSuccessorProbe.html",
  "tests/webMachine/browser/probes/guestNetworkProbe.html",
  // 내구 커밋의 핵(찢어진 커밋·CAS 경쟁·세대 불변성·retention gc)을 보는 probe다. x86 자산이
  // 필요 없는데(fake guest adapter + store 계약 스위트) V86_BACKED에 잘못 등재돼 있어서 CI에서
  // 한 번도 돌지 않았다(외부 감사, 2026-07-27). 크래시 안전성의 25검사가 그렇게 좌초해 있었다.
  "tests/webMachine/browser/probes/generationContractProbe.html",
  // 이식성 계약(값 경계 표면은 이미지를 건너 살고, 블로킹 표면은 뜨는 순간 거부된다). 무자산이다:
  // 세션 둘과 감옥만 쓴다. 브라우저 게이트 본편이 시간 예산 끝이라 전용 페이지로 세웠다.
  "tests/webMachine/browser/probes/imagePortabilityProbe.html",
  // 워커 호스팅 guest(캠페인 졸업). 무자산이다: 워커 둘과 내장 스위치만 쓴다.
  "tests/webMachine/browser/probes/workerHostedGuestProbe.html",
  // 공개 createWebComputer가 보편 내구 수명주기를 한 핸들에서 소유한다. fake portable guest와
  // memory store로 owner, restore-or-boot, save, signed import/export, dispose를 전부 문다.
  "tests/webMachine/browser/probes/durableComputerProbe.html",
];
const WASI_BACKED = [
  "tests/webMachine/browser/probes/dualEngineProbe.html",
];
// x86 자산이 필요한 probe. ownerSuccessorParticipant는 probe가 iframe으로 여는 참가자 페이지다.
const V86_BACKED = [
  "tests/webMachine/browser/probes/dualBootProbe.html",
  "tests/webMachine/browser/probes/deviceBackedDualBootProbe.html",
  "tests/webMachine/browser/probes/persistentDualBootProbe.html",
  "tests/webMachine/browser/probes/linuxGuestProbe.html",
  "tests/webMachine/browser/probes/clockEntropyProbe.html",
  "tests/webMachine/browser/probes/displayInputProbe.html",
  "tests/webMachine/browser/probes/framebufferPointerProbe.html",
  "tests/webMachine/browser/probes/machineEnvelopeProbe.html",
  "tests/webMachine/browser/probes/packetNetworkProbe.html",
  "tests/webMachine/browser/probes/nestedBrowserBoundaryProbe.html",
];
const V86_ASSET_DIR = join(ROOT, "tests", "webMachine", "fixtures", "v86", "assets");

// --v86은 레인을 더한다(바꾸지 않는다). 치환이면 x86 레인을 돌 때 자산 없이 도는 계약
// 3개가 빠져, 두 레인을 함께 돈 적이 한 번도 없게 된다(외부 감사 지적, 2026-07-27).
const pages = [...ASSET_FREE, ...(wantWasi ? WASI_BACKED : []), ...(wantV86 ? V86_BACKED : [])];
const WASI_ASSET_DIR = join(ROOT, "tests", "attempts", "enginePort");
if (wantWasi && (!existsSync(join(WASI_ASSET_DIR, "python-3.14.6.wasm")) || !existsSync(join(WASI_ASSET_DIR, "python314-stdlib.zip")))) {
  console.error(`FAIL WASI 자산 없음: ${WASI_ASSET_DIR}. node scripts/fetchWasiAssets.mjs를 먼저 실행한다.`);
  process.exit(1);
}
if (wantV86 && !existsSync(join(V86_ASSET_DIR, "libv86.mjs"))) {
  console.error(`FAIL v86 자산 없음: ${V86_ASSET_DIR}. npm run test:web-machine:v86가 prepareAssets를 먼저 돈다.`);
  process.exit(1);
}

let failed = 0;
for (const page of pages) {
  console.log(`\n=== ${page} ===`);
  const result = spawnSync(process.execPath, [join(ROOT, "tests", "browser", "run.mjs"), page], {
    cwd: ROOT, stdio: "inherit", env: process.env,
  });
  if (result.status !== 0) failed += 1;
}
console.log(`\n결과: ${failed ? "RED" : "GREEN"} (${pages.length - failed}/${pages.length} probe)`);
process.exit(failed ? 1 : 0);
