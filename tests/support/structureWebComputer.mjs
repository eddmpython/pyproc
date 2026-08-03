// structureWebComputer.mjs - [구조] 절에서 나온 검사 묶음.
//
// 크기가 아니라 책임으로 나눴다: 이 묶음의 검사들은 자기 상수만 쓰고, 러너가 주는 것은 공용
// 헬퍼와 check뿐이다. 절 이름과 검사 이름은 그대로라 게이트 층 하한은 움직이지 않는다.
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

export function assertWebComputerStructure({ check, ROOT, collect, rel, jsModuleRefs, moduleTarget, machineRoot }) {
const webComputerRoot = join(ROOT, "apps", "webComputer");
check("Web Computer 제품 composition root 고정", () => {
  const requiredFiles = [
    "index.html",
    "styles.css",
    "app.js",
    "webComputerRuntime.js",
    "webComputerContext.js",
    "webComputerPersistence.js",
    "machineConfig.js",
    "identityStore.js",
    "imageTrust.js",
    "ps2Keyboard.js",
    "gate.js",
    "assetCatalog.json",
  ];
  const missing = requiredFiles.filter((file) => !existsSync(join(webComputerRoot, file)));
  if (missing.length) throw new Error(`제품 파일 누락: ${missing.join(", ")}`);
  const html = readFileSync(join(webComputerRoot, "index.html"), "utf8");
  for (const id of ["saveButton", "exportButton", "importButton", "pythonCode", "linuxCommand", "linuxDisplay", "trustDialog"]) {
    if (!html.includes(`id="${id}"`)) throw new Error(`제품 UI 누락: ${id}`);
  }
  if (html.includes("importmap") || html.includes("@web-machine")) throw new Error("제품에 죽은 import map 잔존: 공개 표면은 /index.js 하나다");
});

check("Web Computer durable lifecycle는 공개 computer 핸들에만 있다", () => {
  const runtime = readFileSync(join(webComputerRoot, "webComputerRuntime.js"), "utf8");
  const context = readFileSync(join(webComputerRoot, "webComputerContext.js"), "utf8");
  const policy = readFileSync(join(webComputerRoot, "webComputerPersistence.js"), "utf8");
  if (existsSync(join(webComputerRoot, "webComputerContextSwap.js"))) {
    throw new Error("제품 context swap 사본 재등장: createWebComputer.importImage()에 위임한다");
  }
  for (const symbol of ["MachineCommitCoordinator", "MachineEnvelopeCoordinator", "WebLockOwnerCoordinator", "swapWebComputerContext"]) {
    if (runtime.includes(symbol) || context.includes(symbol) || policy.includes(symbol)) {
      throw new Error(`제품에 보편 수명주기 구현 재등장: ${symbol}`);
    }
  }
  for (const method of ["initialize", "save", "exportImage", "importImage", "dispose"]) {
    if (!new RegExp(`\\.computer\\.${method}\\(`).test(runtime) && !new RegExp(`_computer\\(\\)\\.${method}\\(`).test(runtime)
      && !(method === "dispose" && new RegExp(`\\.computer\\.${method}\\(`).test(context))) {
      throw new Error(`Runtime이 공개 computer.${method}()를 호출하지 않는다`);
    }
  }
  for (const implementationVerb of ["commitPaused(", "restoreLatest(", "importVerified(", "preflightImport(", "adoptOwnership(", "invalidateOwnership("]) {
    if (runtime.includes(implementationVerb) || context.includes(implementationVerb) || policy.includes(implementationVerb)) {
      throw new Error(`제품 수명주기 사본 재등장: ${implementationVerb}`);
    }
  }
  for (const productPolicy of ["groupId:", "store,", "lockManager:", "getSigningKeyPair:", "requiredCapabilities:", "availableCapabilities:"]) {
    if (!policy.includes(productPolicy)) throw new Error(`제품 durability 정책 누락: ${productPolicy}`);
  }
});

check("Web Computer 제품은 공개 package root만 소비", () => {
  const allowedTargets = new Set([
    "index.js",
    "src/machine/index.js",
  ]);
  const files = collect(webComputerRoot, [".js"], []).filter((file) => !rel(file).includes("/assets/"));
  const problems = [];
  for (const file of files) {
    for (const ref of jsModuleRefs(file)) {
      const target = moduleTarget(file, ref.spec);
      if (!target) {
        problems.push(`${rel(file)} -> ${ref.spec}: 승인되지 않은 bare import`);
        continue;
      }
      const targetRel = rel(target);
      if (targetRel.startsWith("apps/webComputer/")) continue;
      if (!allowedTargets.has(targetRel)) problems.push(`${rel(file)} -> ${targetRel}: 제품 경계 밖 또는 deep import`);
    }
    const source = readFileSync(file, "utf8");
    if (/\btests[\\/]/.test(source)) problems.push(`${rel(file)}: tests 경로 소비`);
  }
  if (problems.length) throw new Error(problems.slice(0, 8).join("; "));
});

// 봉투는 판정이 아니라 출처를 나른다.
//
// guestManifest는 열린 JSON 서브트리라 재귀 정규화 + canonical JSON + contentDigest + 서명을
// 받는다(getWebMachineManifestContent가 machines를 통째로 싣는다). 그래서 provenance는 서명
// 대상이고 변조하면 digest가 어긋난다.
//
// channel은 싣지 않는다. 수신자는 catalog도 자산도 없어서 재계산할 수 없고, 재계산 불가능한
// 판정은 계산이 아니라 선언이다. 게다가 imageTrust가 서명 검증 "전에" manifest를 파싱해
// 신뢰 화면에 쓰므로(gate.js가 소비), 봉투의 channel을 띄우면 공격자 제어 문자열을 제품
// 판정으로 표시하게 된다. 정책: trusted signature는 출처 identity를 증명할 뿐 license
// compliance를 대신하지 않는다.
check("봉투는 출처를 나르고 채널 판정은 나르지 않는다", () => {
  const provenance = readFileSync(join(webComputerRoot, "assetProvenance.js"), "utf8");
  for (const field of ["policyVersion", "catalogId", "sbomDigest"]) {
    if (!provenance.includes(`${field}:`)) throw new Error(`assetProvenance.js: ${field} 누락`);
  }
  if (/\bchannel\s*:/.test(provenance)) throw new Error("assetProvenance.js가 channel 판정을 싣는다(재계산 불가능한 선언 금지)");
  // 게스트 manifest를 만드는 곳들이 채널을 주장하지 않는가. 예전엔 machineConfig가
  // product.channel = "development"를 서명 봉투에 실었고 아무도 안 잡았다.
  for (const file of ["machineConfig.js", "webComputerContext.js"]) {
    const src = readFileSync(join(webComputerRoot, file), "utf8");
    if (/\bchannel\s*:\s*"/.test(src)) throw new Error(`${file}: 게스트 manifest에 channel 주장이 재등장했다`);
  }
  // 두 게스트가 모두 출처를 밝히는가. 침묵하면 증거 없음이 문제 없음으로 읽힌다.
  // 두 guest의 실행 자산 전부를 같은 catalog가 기술하므로(엔진 부팅 집합 포함) 둘 다
  // 생성물 모듈의 기술된 provenance를 싣는다. 부재 명시 장치(UNDESCRIBED)는 미기술 게스트가
  // 소멸하면서 함께 은퇴했다: 재등장 = 어떤 게스트의 자산이 catalog 밖으로 샜다는 뜻이다.
  const context = readFileSync(join(webComputerRoot, "webComputerContext.js"), "utf8");
  if (!context.includes("provenance: WEB_COMPUTER_ASSET_PROVENANCE")) throw new Error("pythonOs가 기술된 자산 출처를 싣지 않는다");
  if (context.includes("UNDESCRIBED")) throw new Error("은퇴한 부재 명시 장치가 재등장했다(자산은 catalog가 기술한다)");
  if (!readFileSync(join(webComputerRoot, "machineConfig.js"), "utf8").includes("WEB_COMPUTER_ASSET_PROVENANCE")) {
    throw new Error("linuxOs가 자산 출처를 밝히지 않는다");
  }
  // provenance가 서명 대상 안에 있다는 구조 사실: content가 machines를 통째로 싣는다.
  const manifestSrc = readFileSync(join(machineRoot, "contracts", "machineManifest.js"), "utf8");
  if (!/machines:\s*normalized\.machines/.test(manifestSrc)) {
    throw new Error("machineManifest: content가 machines를 싣지 않는다(guestManifest.provenance가 서명 밖으로 샌다)");
  }
});

// 지속 정책은 _done 아카이브가 아니라 docs/에 산다(정보 구조 규칙). 그리고 봉투가 나르는
// policyVersion은 그 문서의 버전이어야 한다: 값이 어긋나면 봉투가 없는 정책을 가리킨다.
check("정책 문서의 policyVersion과 봉투가 나르는 값이 같다", () => {
  const policy = readFileSync(join(ROOT, "docs", "operations", "assetProvenance.md"), "utf8");
  const declared = /\*\*policyVersion:\s*(\d+)\.\*\*/.exec(policy);
  if (!declared) throw new Error("docs/operations/assetProvenance.md: policyVersion 선언 없음");
  const catalog = JSON.parse(readFileSync(join(ROOT, "scripts", "assetCatalog.json"), "utf8"));
  if (catalog.webComputer.policyVersion !== Number(declared[1])) {
    throw new Error(`policyVersion 불일치: 문서 ${declared[1]} vs catalog ${catalog.webComputer.policyVersion}`);
  }
  const carried = /policyVersion:\s*(\d+)/.exec(readFileSync(join(webComputerRoot, "assetProvenance.js"), "utf8"));
  if (!carried || Number(carried[1]) !== Number(declared[1])) {
    throw new Error(`봉투가 나르는 policyVersion 불일치: 문서 ${declared[1]} vs 봉투 ${carried && carried[1]}`);
  }
});

check("Web Computer 실행 자산은 검증된 development channel", () => {
  const catalog = JSON.parse(readFileSync(join(webComputerRoot, "assetCatalog.json"), "utf8"));
  if (catalog.schemaVersion !== 1 || catalog.channel !== "development" || catalog.redistribution !== "disabled") {
    throw new Error("제품 asset channel 또는 재배포 정책 불일치");
  }
  const requiredRoles = new Set(["engine-module", "engine-binary", "firmware", "guest-image", "stdlib-archive"]);
  for (const asset of catalog.assets || []) {
    requiredRoles.delete(asset.role);
    if (!/^[0-9a-f]{64}$/.test(asset.sha256) || !Number.isSafeInteger(asset.byteLength) || asset.byteLength < 1) {
      throw new Error(`${asset.name}: hash 또는 byteLength 불일치`);
    }
    if (!asset.licenseConcluded || !asset.provenanceStatus) throw new Error(`${asset.name}: compliance 필드 누락`);
  }
  if (requiredRoles.size) throw new Error(`asset role 누락: ${[...requiredRoles].join(", ")}`);
  // 제품이 실제로 부팅하는 두 엔진 바이너리가 모두 기술돼야 한다: v86.wasm(Linux 면)과
  // pyodide.asm.wasm(Python 면). 한쪽만 기술하는 catalog는 P1의 재발이다(증거 없음의 통과).
  for (const name of ["v86.wasm", "pyodide.asm.wasm"]) {
    if (!(catalog.assets || []).some((asset) => asset.name === name)) throw new Error(`제품 catalog에 ${name} 미기술`);
  }
  const trackedAssets = spawnSync("git", ["ls-files", "apps/webComputer/assets"], { cwd: ROOT, encoding: "utf8", timeout: 5000 });
  if (trackedAssets.status !== 0 || trackedAssets.stdout.trim()) throw new Error("Web Computer binary가 git에 포함됨");
  const packageManifest = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
  if (!packageManifest.scripts?.["assets:web-computer"]?.includes("prepareWebComputerAssets.mjs")) throw new Error("제품 asset 준비 script 누락");
  if (!packageManifest.scripts?.["test:web-computer"]?.includes("webComputerProduct.mjs")) throw new Error("제품 browser E2E script 누락");
});
}
