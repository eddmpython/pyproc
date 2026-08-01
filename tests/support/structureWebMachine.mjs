// structureWebMachine.mjs - [구조] 절에서 나온 검사 묶음.
//
// 크기가 아니라 책임으로 나눴다: 이 묶음의 검사들은 자기 상수만 쓰고, 러너가 주는 것은 공용
// 헬퍼와 check뿐이다. 절 이름과 검사 이름은 그대로라 게이트 층 하한은 움직이지 않는다.
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";

function assertBuildrootReleaseEvidence(catalog, releaseAssetsBytes) {
  const component = catalog.components.find((item) => item.componentId === "buildroot-pyproc-i686-v2");
  const releaseAssets = JSON.parse(releaseAssetsBytes);
  const digest = createHash("sha256").update(releaseAssetsBytes).digest("hex");
  if (component?.evidenceManifest?.sha256 !== digest) throw new Error("Buildroot release evidence manifest digest 표류");
  if (component.evidenceManifest.byteLength !== releaseAssetsBytes.byteLength) throw new Error("Buildroot release evidence manifest 크기 표류");
  if (component.evidenceManifest.assetCount !== releaseAssets.assets.length) throw new Error("Buildroot release evidence asset 수 표류");
  if (!component.evidence.includes(component.evidenceManifest.url)) throw new Error("Buildroot release evidence URL 누락");
  const legal = releaseAssets.legalInfoInventory;
  if (!legal || legal.checksumRows !== legal.files) throw new Error("Buildroot legal-info checksum row와 file 수가 다르다");
  for (const field of ["missing", "extra", "duplicates", "checksumMismatches"]) {
    if (legal[field] !== 0) throw new Error(`Buildroot legal-info ${field}가 0이 아니다`);
  }
  const releaseImage = releaseAssets.assets.find((asset) => asset.name === "buildroot-pyproc-i686.bin");
  const catalogImage = catalog.assets.find((asset) => asset.componentId === component.componentId);
  if (releaseImage?.sha256 !== catalogImage?.sha256 || releaseImage?.byteLength !== catalogImage?.byteLength) {
    throw new Error("Buildroot release manifest와 runtime catalog가 다르다");
  }
}

export async function assertWebMachineStructure({ check, checkAsync, ROOT, collect, rel, stripComments, jsModuleRefs, moduleTarget, findCycles, machineRoot, machinePureFiles, machineFileRank, runMemoryMachineStoreContract, runDurableComputerContract }) {
const webMachineTestRoot = join(ROOT, "tests", "webMachine");
const webMachineSourceRoots = [machineRoot, webMachineTestRoot];
// 엔진·브라우저를 모르는 순수 집합. 옛 @web-machine/core의 경계가 파일 불변식으로 남는다
// (폴더가 아니라 파일인 이유: snapshotEnvelope/machineManifest는 image/에 살지만 계약 층이다.
//  contracts와 host가 이 둘을 import하는 것이 실측 edge라 폴더 단위 rank는 성립하지 않는다).

check("Web Machine 층과 검증 트리 구조 고정", () => {
  // packages/ 감옥은 철거됐다. 플랫폼은 pyproc의 machine 층이다.
  if (existsSync(join(ROOT, "packages"))) throw new Error("packages/ 잔존: Web Machine은 src/machine 층이다");
  const entries = readdirSync(machineRoot).sort();
  const expected = ["composition", "contracts", "coordination", "devices", "guests", "host", "image", "index.d.ts", "index.js", "persistence"];
  if (entries.join("\n") !== expected.join("\n")) throw new Error(`machine 층 경계 불일치: ${entries.join(", ")}`);
  const testEntries = readdirSync(webMachineTestRoot).sort();
  // run.mjs = probe 러너. probe가 게이트 폴더에 있으면서 아무도 안 돌리던 상태를 끝낸 자리다
  // (2026-07-27). browser/ 아래에는 probes만 둔다는 불변식이 있어 러너는 이 층에 산다.
  const expectedTestEntries = ["README.md", "browser", "contracts", "fixtures", "run.mjs"];
  if (testEntries.join("\n") !== expectedTestEntries.join("\n")) throw new Error(`검증 경계 불일치: ${testEntries.join(", ")}`);
  if (readdirSync(join(webMachineTestRoot, "browser")).join("\n") !== "probes") {
    throw new Error("tests/webMachine/browser에는 probes만 둔다");
  }
  const requiredFiles = [
    "tests/webMachine/fixtures/v86/prepareAssets.mjs",
  ];
  const missing = requiredFiles.filter((file) => !existsSync(join(ROOT, file)));
  if (missing.length) throw new Error(`필수 경계 누락: ${missing.join(", ")}`);

  const forbiddenFolderNames = new Set(["utils", "common", "shared", "helpers"]);
  const walk = (dir) => {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (!statSync(full).isDirectory()) continue;
      if (forbiddenFolderNames.has(entry)) throw new Error(`책임 없는 공유 폴더 금지: ${rel(full)}`);
      walk(full);
    }
  };
  for (const root of webMachineSourceRoots) walk(root);
});

check("Web Machine public 표면은 machine 배럴 하나", () => {
  const rootPackage = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
  if (rootPackage.workspaces) throw new Error("workspaces 잔존: pyproc은 단일 package다");
  const machineExport = rootPackage.exports?.["./machine"];
  if ((typeof machineExport === "string" ? machineExport : machineExport?.default) !== "./src/machine/index.js") {
    throw new Error("pyproc/machine subpath가 machine 배럴을 가리켜야 한다");
  }
  const barrelPath = join(machineRoot, "index.js");
  const barrelSource = readFileSync(barrelPath, "utf8");
  if (!barrelSource.trim()) throw new Error("machine 배럴이 비어 있음");
  for (const ref of jsModuleRefs(barrelPath)) {
    if (!ref.spec.startsWith("./") || !ref.spec.endsWith(".js")) throw new Error(`machine 배럴은 자기 층만 export해야 한다: ${ref.spec}`);
    const target = moduleTarget(barrelPath, ref.spec);
    if (!target || !existsSync(target)) throw new Error(`machine 배럴 export 대상 없음: ${ref.spec}`);
  }
  const typesSource = readFileSync(join(machineRoot, "index.d.ts"), "utf8");
  if (!typesSource.trim()) throw new Error("machine type 표면이 비어 있음");
  // 루트 표면: 컴퓨터 진입점 하나를 게시한다
  const rootIndex = readFileSync(join(ROOT, "index.js"), "utf8");
  if (!rootIndex.includes("createWebComputer")) throw new Error("루트 표면에 createWebComputer가 없음");
});
await checkAsync("Web Machine memory MachineStore contract", runMemoryMachineStoreContract);
await checkAsync("Web Computer durable import atomicity contract", runDurableComputerContract);
check("Web Machine public type와 runtime store 의미 일치", () => {
  const source = readFileSync(join(machineRoot, "index.d.ts"), "utf8");
  for (const required of [
    "interface GenerationHead",
    "prev: string | null",
    "ownerEpoch: number",
    "class MemoryMachineStore",
    "class IndexedDbMachineStore",
    "Promise<Uint8Array>",
  ]) {
    if (!source.includes(required)) throw new Error(`type contract 누락: ${required}`);
  }
  if (/\bprevious\s*:/.test(source)) throw new Error("GenerationHead previous key 재등장");
  for (const removed of ["MemoryGenerationStore", "IndexedDbGenerationStore", "IndexedDbOwnerEpochStore"]) {
    if (source.includes(removed)) throw new Error(`흡수된 public type 잔존: ${removed}`);
  }
  const memorySource = readFileSync(join(machineRoot, "persistence", "memoryMachineStore.js"), "utf8");
  const indexedSource = readFileSync(join(machineRoot, "persistence", "indexedDbMachineStore.js"), "utf8");
  if (!memorySource.includes("WEB_MACHINE_OWNER_STALE") || !indexedSource.includes("WEB_MACHINE_OWNER_STALE")) {
    throw new Error("MachineStore stale owner runtime contract 누락");
  }
});

// machine 오류 코드 union이 실제 throw 집합과 정확히 같은가. 전임 검사는 `WEB_MACHINE_OWNER_STALE`을
// 순회에 넣고 조건에서 스스로 제외해 영원히 통과했고, 그 뒤에 진짜 공백이 있었다: d.ts의 code가
// string이라 소비자가 코드로 분기할 수 없었다. 양방향으로 대조해야 한쪽만 늘어나는 표류가 잡힌다.
check("Web Machine 오류 코드 union = 실제 throw 집합", () => {
  const dts = readFileSync(join(machineRoot, "index.d.ts"), "utf8");
  const unionBlock = /export type WebMachineErrorCode =([\s\S]*?);\r?\n/.exec(dts);
  if (!unionBlock) throw new Error("WebMachineErrorCode union 선언 없음");
  const declared = new Set([...unionBlock[1].matchAll(/"(WEB_MACHINE_[A-Z_]+)"/g)].map((m) => m[1]));
  const thrown = new Set();
  for (const file of collect(machineRoot, [".js"], [])) {
    for (const m of readFileSync(file, "utf8").matchAll(/"(WEB_MACHINE_[A-Z_]+)"/g)) thrown.add(m[1]);
  }
  const missing = [...thrown].filter((code) => !declared.has(code)).sort();
  const extra = [...declared].filter((code) => !thrown.has(code)).sort();
  if (missing.length) throw new Error(`union에 없는 throw 코드: ${missing.slice(0, 6).join(", ")}`);
  if (extra.length) throw new Error(`throw되지 않는 union 코드: ${extra.slice(0, 6).join(", ")}`);
  if (!/readonly code: WebMachineErrorCode/.test(dts)) throw new Error("WebMachineError.code가 union 타입이 아니다");
});

check("Web Machine third-party fixture는 미번들 provenance/SBOM 고정", () => {
  const fixtureRoot = join(webMachineTestRoot, "fixtures", "v86");
  const audit = spawnSync(process.execPath, [join(ROOT, "scripts", "assetProvenance.mjs"), "--check"], {
    cwd: ROOT,
    encoding: "utf8",
    timeout: 10000,
  });
  if (audit.status !== 0) throw new Error(audit.stderr || audit.stdout || "fixture SBOM audit 실패");
  const catalog = JSON.parse(readFileSync(join(ROOT, "scripts", "assetCatalog.json"), "utf8"));
  if (catalog.packagePolicy?.thirdPartyBinaryBundling !== "forbidden") throw new Error("third-party binary bundling 금지 정책 없음");
  const releaseAssetsPath = join(ROOT, "scripts", "buildroot", "releaseAssets.json");
  const releaseAssetsBytes = readFileSync(releaseAssetsPath);
  assertBuildrootReleaseEvidence(catalog, releaseAssetsBytes);
  // 엔진 부팅 집합은 상류 CDN을 참조하고, 자체 Buildroot guest만 complete source/legal과
  // 함께 프로젝트 release asset으로 배포한다. 나머지 third-party 자산은 로컬 시험 전용이다.
  for (const asset of catalog.assets) {
    if (!asset.bundleBlockers?.length) throw new Error(`${asset.name}: bundle blocker가 없다`);
    const expected = asset.componentId.startsWith("pyodide-release-")
      ? "upstream-cdn-runtime-reference"
      : asset.componentId === "buildroot-pyproc-i686-v2"
        ? "project-release-runtime-reference"
        : "local-test-only";
    if (asset.distribution !== expected) throw new Error(`${asset.name}: distribution은 ${expected}여야 한다(현재 ${asset.distribution})`);
  }
  const guestAssets = catalog.assets.filter((asset) => asset.role === "guest-image");
  if (!guestAssets.length || guestAssets.some((asset) => asset.licenseConcluded !== "NOASSERTION")) {
    throw new Error("guest image license를 단일 식별자로 추정하면 안 된다");
  }
  const prepareSource = readFileSync(join(fixtureRoot, "prepareAssets.mjs"), "utf8");
  if (prepareSource.includes("https://") || /[0-9a-f]{64}/.test(prepareSource)) {
    throw new Error("prepareAssets에 URL/hash 중복 금지, assetCatalog가 SSOT");
  }
  const trackedAssets = spawnSync("git", ["ls-files", "tests/webMachine/fixtures/v86/assets"], {
    cwd: ROOT,
    encoding: "utf8",
    timeout: 5000,
  });
  if (trackedAssets.status !== 0 || trackedAssets.stdout.trim()) throw new Error("third-party fixture binary가 git에 포함됨");
});

check("탐지기가 문다: Buildroot release evidence 변조", () => {
  const catalog = JSON.parse(readFileSync(join(ROOT, "scripts", "assetCatalog.json"), "utf8"));
  const releaseAssets = JSON.parse(readFileSync(join(ROOT, "scripts", "buildroot", "releaseAssets.json"), "utf8"));
  const image = releaseAssets.assets.find((asset) => asset.name === "buildroot-pyproc-i686.bin");
  image.sha256 = "0".repeat(64);
  const tamperedBytes = Buffer.from(`${JSON.stringify(releaseAssets, null, 2)}\n`);
  const tamperedCatalog = structuredClone(catalog);
  const component = tamperedCatalog.components.find((item) => item.componentId === "buildroot-pyproc-i686-v2");
  component.evidenceManifest.sha256 = createHash("sha256").update(tamperedBytes).digest("hex");
  component.evidenceManifest.byteLength = tamperedBytes.byteLength;
  let caught = false;
  try { assertBuildrootReleaseEvidence(tamperedCatalog, tamperedBytes); } catch { caught = true; }
  if (!caught) throw new Error("Buildroot release evidence 음성 fixture를 놓쳤다");
  const badLegal = structuredClone(releaseAssets);
  badLegal.legalInfoInventory.checksumMismatches = 1;
  const badLegalBytes = Buffer.from(`${JSON.stringify(badLegal, null, 2)}\n`);
  const badLegalCatalog = structuredClone(catalog);
  const badLegalComponent = badLegalCatalog.components.find((item) => item.componentId === "buildroot-pyproc-i686-v2");
  badLegalComponent.evidenceManifest.sha256 = createHash("sha256").update(badLegalBytes).digest("hex");
  badLegalComponent.evidenceManifest.byteLength = badLegalBytes.byteLength;
  caught = false;
  try { assertBuildrootReleaseEvidence(badLegalCatalog, badLegalBytes); } catch { caught = true; }
  if (!caught) throw new Error("Buildroot legal-info inventory 음성 fixture를 놓쳤다");
});
check("Web Machine clock/entropy 공급원은 생성자 주입", () => {
  const deviceRoot = join(machineRoot, "devices");
  const clockSource = readFileSync(join(deviceRoot, "browserClockDevice.js"), "utf8");
  const entropySource = readFileSync(join(deviceRoot, "browserEntropyDevice.js"), "utf8");
  if (/\b(?:Date|performance)\s*\.|\b(?:setTimeout|clearTimeout|setInterval|clearInterval)\s*\(/.test(clockSource)) {
    throw new Error("browserClockDevice가 ambient 시간원 또는 scheduler에 직접 접근");
  }
  if (/\b(?:crypto|globalThis|window)\b/.test(entropySource)) {
    throw new Error("browserEntropyDevice가 ambient entropy source에 직접 접근");
  }
});
check("Web Machine host는 guest와 browser 구현을 모름", () => {
  // 옛 @web-machine/core의 경계. 순수 집합(contracts/host + 순수 image 2파일)은
  // 엔진 이름도 브라우저 전역도 모르고, 자기들끼리만 import한다.
  const guestTerms = /\b(?:pyproc|pyodide|wasi|v86|x86|linux|buildroot)\b/i;
  const browserTerms = /\b(?:window|document|navigator|location|indexedDB|localStorage|sessionStorage|caches|fetch|XMLHttpRequest|WebSocket|BroadcastChannel|Worker|SharedWorker|MessageChannel|crypto|performance|Date|setTimeout|setInterval)\b/;
  const problems = [];
  for (const relPath of machinePureFiles) {
    const file = join(ROOT, relPath);
    const source = readFileSync(file, "utf8");
    if (guestTerms.test(source)) problems.push(`${relPath}: guest/engine 이름`);
    if (browserTerms.test(source)) problems.push(`${relPath}: browser 구현 직접 접근`);
    for (const ref of jsModuleRefs(file)) {
      const target = moduleTarget(file, ref.spec);
      if (!target || !machinePureFiles.has(rel(target))) {
        problems.push(`${relPath} -> ${ref.spec}: 순수 집합 밖 import`);
      }
    }
  }
  if (problems.length) throw new Error(problems.slice(0, 8).join("; "));
});
check("Web Machine 층 내부 import는 아래로만", () => {
  // 옛 3개 package 경계가 파일 rank로 남는다: pure(0) <- platform(1) <- guests(2) <- composition(3).
  // 두 강화 조항이 옛 감옥의 실제 규칙이다:
  //  - guests는 pure만 소비한다(옛 guest package는 core barrel만 알았다). platform 직접 접근 금지.
  //  - machine 밖(src/session 등)으로 나가는 것은 조립 지점 composition만 허용된다.
  const problems = [];
  for (const file of collect(machineRoot, [".js"], [])) {
    const fromRel = rel(file);
    const fromRank = machineFileRank(fromRel);
    for (const ref of jsModuleRefs(file)) {
      const target = moduleTarget(file, ref.spec);
      if (!target) { problems.push(`${fromRel} -> ${ref.spec}: bare import 금지`); continue; }
      const targetRel = rel(target);
      if (!targetRel.startsWith("src/machine/")) {
        if (fromRank !== 3) problems.push(`${fromRel} -> ${targetRel}: machine 밖 import는 composition만`);
        continue;
      }
      const toRank = machineFileRank(targetRel);
      if (toRank > fromRank) problems.push(`${fromRel} -> ${targetRel}: rank ${fromRank} -> ${toRank} 위로 향함`);
      else if (fromRank === 2 && toRank === 1) problems.push(`${fromRel} -> ${targetRel}: guest가 platform 직접 소비(pure 계약만 허용)`);
    }
  }
  if (problems.length) throw new Error(problems.slice(0, 8).join("; "));
});
// guest는 자기 선언 밖의 장치를 해석하지 않는다. 예전에는 선언과 명령형 검사가 갈려서
// host가 아는 요구가 실제보다 약했다(선언에 없던 메서드 요구를 어댑터만 알았다).
check("guest는 선언(requiredDevices)으로만 장치를 해석한다", () => {
  const problems = [];
  for (const file of collect(join(machineRoot, "guests"), [".js"], [])) {
    const code = stripComments(readFileSync(file, "utf8"));
    if (!/_context\??\.devices/.test(code)) continue;
    // 허용되는 유일한 형태: 해석 함수에 devices 맵을 넘기는 것. 직접 색인은 선언 우회다.
    const direct = [...code.matchAll(/_context\??\.devices\s*\??\.?\s*\[/g)];
    if (direct.length) problems.push(`${rel(file)}: devices 직접 색인 ${direct.length}곳`);
    if (!/resolveRequiredDevice\(/.test(code)) problems.push(`${rel(file)}: 선언 기반 해석 미사용`);
  }
  if (problems.length) throw new Error(problems.join("; "));
});
check("Web Machine 장치·지속층은 guest를 모름", () => {
  // 옛 @web-machine/browser의 경계: 장치/지속성/조율은 어떤 게스트 이름도 모른다.
  const guestTerms = /\b(?:pyodide|wasi|v86|x86|buildroot)\b/i;
  const problems = [];
  for (const folder of ["devices", "persistence", "coordination"]) {
    for (const file of collect(join(machineRoot, folder), [".js"], [])) {
      if (guestTerms.test(readFileSync(file, "utf8"))) problems.push(`${rel(file)}: guest/engine 이름`);
    }
  }
  if (problems.length) throw new Error(problems.slice(0, 8).join("; "));
});
check("Web Machine 조립은 composition과 probes에만 존재", () => {
  const problems = [];
  for (const root of webMachineSourceRoots) for (const file of collect(root, [".js", ".mjs", ".html"], [])) {
    if (rel(file).includes("/fixtures/v86/assets/")) continue;
    const source = readFileSync(file, "utf8");
    const fileRel = rel(file);
    if (source.includes(".registerAdapter(")
      && !fileRel.startsWith("tests/webMachine/browser/probes/")
      && !fileRel.startsWith("src/machine/composition/")
      && fileRel !== "src/machine/host/webMachineHost.js") {
      problems.push(fileRel);
    }
  }
  if (problems.length) throw new Error(`composition root 밖 adapter 등록: ${problems.join(", ")}`);
});
check("Web Machine source는 named ESM과 명시 확장자", () => {
  const problems = [];
  for (const root of webMachineSourceRoots) for (const file of collect(root, [".js", ".mjs", ".html"], [])) {
    if (rel(file).includes("/fixtures/v86/assets/")) continue;
    const source = readFileSync(file, "utf8");
    if (/\bexport\s+default\b/.test(source)) problems.push(`${rel(file)}: default export`);
    for (const ref of jsModuleRefs(file)) {
      if (!ref.spec.startsWith(".")) continue;
      const clean = ref.spec.split(/[?#]/)[0];
      if (!/\.(?:js|mjs)$/.test(clean)) problems.push(`${rel(file)} -> ${ref.spec}: 명시 확장자 없음`);
    }
  }
  if (problems.length) throw new Error(problems.slice(0, 8).join("; "));
});
check("Web Machine 검증은 machine 배럴만 소비", () => {
  const problems = [];
  for (const file of collect(webMachineTestRoot, [".js", ".mjs", ".html"], [])) {
    if (rel(file).includes("/fixtures/v86/assets/")) continue;
    for (const ref of jsModuleRefs(file)) {
      const target = moduleTarget(file, ref.spec);
      if (!target) continue;
      const targetRel = rel(target);
      if (targetRel.startsWith("src/machine/") && targetRel !== "src/machine/index.js") {
        problems.push(`${rel(file)} -> ${targetRel}: machine 배럴 밖 deep import`);
      }
    }
  }
  if (problems.length) throw new Error(problems.slice(0, 8).join("; "));
});
check("Web Machine import graph cycle 없음", () => {
  const files = webMachineSourceRoots.flatMap((root) => collect(root, [".js", ".mjs", ".html"], []))
    .filter((file) => !rel(file).includes("/fixtures/v86/assets/"));
  const byRel = new Set(files.map(rel));
  const graph = new Map(files.map((file) => [rel(file), []]));
  for (const file of files) {
    for (const ref of jsModuleRefs(file)) {
      const target = moduleTarget(file, ref.spec);
      if (!target) continue;
      const targetRel = rel(target);
      if (byRel.has(targetRel)) graph.get(rel(file)).push(targetRel);
    }
  }
  const cycles = findCycles(graph);
  if (cycles.length) throw new Error(cycles.slice(0, 4).map((cycle) => cycle.join(" -> ")).join("; "));
});

}
