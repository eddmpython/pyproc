// 공개 package surface와 문서 import 예제를 실제 모듈 export에 대조한다.
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const ROOT_VALUES = Object.freeze([
  "PYPROC_ERROR_CODES",
  "PyProcError",
  "boot",
  "checkEnvironment",
  "createWebComputer",
  "open",
]);
const SUBPATHS = Object.freeze([
  "./runtime",
  "./history",
  "./machine",
  "./worker",
  "./assets",
  "./gpu",
  "./socket",
  "./wasi",
]);
const EXPERIMENTAL_SUBPATHS = Object.freeze(["./gpu", "./socket", "./wasi"]);

// 0.0.10 porcelain 개명으로 공개 표면에서 사라진 이름들. 소비자 문서가 이 이름을 지시문으로
// 쓰면 그 예제는 실행되지 않는다(2026-07-26 실측: trustPermissions.md의 신뢰 체인 최소 흐름이
// 죽은 이름 3개를 import했다). 이력 문서에서 "구 X"/"formerly X"로 언급하는 것은 허용한다.
const RETIRED_IDENTIFIERS = Object.freeze({
  openMachine: "open(blob, trustOpts)",
  openPersistentMachine: "open({ name })",
  bootSession: "boot({ deterministic: true })",
  bootEnv: "boot manifest(packages/env/setup/wheelDir)",
  runScript: "boot manifest(setup) 또는 machine.run",
  createMachineKeyPair: "createStateKeyPair(pyproc/history)",
  exportMachinePublicKey: "exportStatePublicKey(pyproc/history)",
  fingerprintMachinePublicKey: "fingerprintStatePublicKey(pyproc/history)",
});
// 이관 표의 Before 열에 나오지만 은퇴가 아닌 이름들(값-export는 아니어도 살아 있다).
// 각 항목은 판단 기록이다: 왜 금칙어가 아닌지가 여기 남아야 목록이 썩지 않는다.
const LIVE_UNEXPORTED_IDENTIFIERS = Object.freeze({
  boot: "루트 동사. 반환형만 바뀌었다",
  PyProc: "machine.proc()이 주는 풀 클래스. index.d.ts 타입으로 산다",
  Runtime: "pyproc/runtime 값-export이자 machine.runtime의 타입",
  Session: "내부 세션 클래스. 문서는 machine.history로 말한다",
  Crypto: "WebCrypto 표준 타입 이름",
  exportImage: "machine.history.export로 옮긴 메서드 이름",
});
// 이관 표가 가리키는 "구 이름"은 마커와 함께 쓸 수 있다. 마커는 단락 단위로 찾는다:
// api.md처럼 `formerly A / B / C`가 줄바꿈을 넘어 이어지는 표기를 끊지 않기 위해서다.
const MIGRATION_MARKERS = Object.freeze(["formerly", "구 ", "retired", "no longer", "->", "renamed"]);
// 내부 운영 문서는 내부 함수 이름으로 말하는 것이 정확하다(예: contractReality의 결정적 부팅
// 경로 서술). 소비자에게 "이렇게 호출하라"고 말하는 문서만 금칙어 스코프다.
const CONSUMER_DOC_ROOTS = Object.freeze(["README.md", "README.ko.md", "SECURITY.md", "docs/consuming", "docs/product", "docs/reference"]);

function collectMarkdown(dir, acc = []) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) collectMarkdown(full, acc);
    else if (entry.endsWith(".md")) acc.push(full);
  }
  return acc;
}

// CHANGELOG 이관 표의 Before 열 = 은퇴 사전의 상류. 새 이관 행이 들어오면 그 이름이 사전이나
// 살아있는 표면에 등재되도록 강제한다(사전을 손으로 유지하면 다음 릴리즈에 표류한다).
function migrationBeforeIdentifiers(changelog) {
  const names = new Set();
  for (const line of changelog.split("\n")) {
    const row = /^\|\s*(.+?)\s*\|\s*(.+?)\s*\|\s*$/.exec(line);
    if (!row || row[1] === "Before" || /^-+$/.test(row[1])) continue;
    for (const span of row[1].matchAll(/`([^`]+)`/g)) {
      // 호출 표기(`name(`)와 단독 식별자만 본다. `rt.enableJournal(cfg)`처럼 수신자에 붙은
      // 메서드는 이름을 클래스가 갖고 있으므로 은퇴 판정 대상이 아니다.
      const call = /^(?:new\s+)?([A-Za-z_$][\w$]*)\s*\(/.exec(span[1]);
      if (call) names.add(call[1]);
      else if (/^[A-Za-z_$][\w$]*$/.test(span[1])) names.add(span[1]);
    }
  }
  return names;
}

function paragraphsOf(markdown) {
  return markdown.split(/\n\s*\n/);
}

function targetOf(value) {
  return typeof value === "string" ? value : value.default;
}

function typesOf(value) {
  return typeof value === "object" ? value.types : null;
}

// 문서의 import 예제에서 (specifier, 이름들)을 뽑는다. 이름 목록에 따옴표와 중괄호를 금지하는
// 것이 이 함수의 정확성 조건이다: `[\s\S]*?`로 열어두면 pyproc이 아닌 specifier를 쓴 앞 블록의
// `import {`가 한참 뒤의 `} from "pyproc"`과 짝지어져 그 사이 본문 전체를 "이름"으로 삼는다.
// 그러면 없는 이름을 신고하는 오탐이 나고, 더 나쁘게는 그 사이에 있던 진짜 import 예제가 한 번도
// 개별 검사되지 않고 삼켜진다. 실제 이름 목록에는 따옴표도 중괄호도 절대 오지 않으므로 안전하다.
function importedNames(markdown) {
  const imports = [];
  const pattern = /import\s+(?!type\b)\{([^{}"'`]*?)\}\s+from\s+["'](pyproc(?:\/[^"']+)?)["']/g;
  for (const match of markdown.matchAll(pattern)) {
    imports.push({
      specifier: match[2],
      names: match[1].split(",").map((part) => part.trim().split(/\s+as\s+/)[0]).filter(Boolean),
    });
  }
  return imports;
}

export async function assertPublicSurface() {
  const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
  const rootApi = await import(pathToFileURL(join(ROOT, "index.js")).href);
  const actualRoot = Object.keys(rootApi).sort();
  if (actualRoot.join(",") !== [...ROOT_VALUES].sort().join(",")) {
    throw new Error(`root values 불일치: ${actualRoot.join(",")}`);
  }
  const exportKeys = Object.keys(pkg.exports).filter((key) => key !== ".").sort();
  if (exportKeys.join(",") !== [...SUBPATHS].sort().join(",")) {
    throw new Error(`package subpath 불일치: ${exportKeys.join(",")}`);
  }
  const modules = new Map([["pyproc", rootApi]]);
  for (const subpath of SUBPATHS) {
    const value = pkg.exports[subpath];
    const target = targetOf(value);
    if (!target || !existsSync(join(ROOT, target))) throw new Error(`${subpath}: default target 없음`);
    if (subpath !== "./worker") {
      const types = typesOf(value);
      if (!types || !existsSync(join(ROOT, types))) throw new Error(`${subpath}: types target 없음`);
    }
    if (subpath !== "./worker") {
      modules.set(`pyproc/${subpath.slice(2)}`, await import(pathToFileURL(join(ROOT, target)).href));
    }
  }
  // import 예제 대조는 추적되는 문서 전수다. 5파일 스코프였을 때 부패는 정확히 그 밖에서
  // 났다(trustPermissions.md, resumeCatalog.md, glossary.md, SECURITY.md). CHANGELOG는
  // 이력이라 옛 이름을 쓰는 것이 정확하므로 스코프 밖이다.
  const docFiles = [
    ...readdirSync(ROOT).filter((entry) => entry.endsWith(".md") && entry !== "CHANGELOG.md"),
    ...collectMarkdown(join(ROOT, "docs")).map((full) => full.slice(ROOT.length + 1)),
  ].map((relative) => relative.replaceAll("\\", "/"));
  for (const file of docFiles) {
    const markdown = readFileSync(join(ROOT, file), "utf8");
    for (const statement of importedNames(markdown)) {
      const module = modules.get(statement.specifier);
      if (!module) throw new Error(`${file}: 미공개 specifier ${statement.specifier}`);
      for (const name of statement.names) {
        if (!(name in module)) throw new Error(`${file}: ${statement.specifier}에 ${name} 값-export 없음`);
      }
    }
  }

  const liveNames = new Set();
  for (const module of modules.values()) for (const name of Object.keys(module)) liveNames.add(name);
  // 사전이 양방향으로 정직한지 본다. (1) 은퇴라고 적은 이름이 실제로 공개 표면에 없어야 하고,
  // (2) 이관 표의 Before 이름은 전부 은퇴 사전이나 살아있는 목록에 등재돼야 한다.
  for (const name of Object.keys(RETIRED_IDENTIFIERS)) {
    if (liveNames.has(name)) throw new Error(`은퇴 사전 오류: ${name}은 공개 표면에 살아 있다`);
  }
  for (const name of migrationBeforeIdentifiers(readFileSync(join(ROOT, "CHANGELOG.md"), "utf8"))) {
    if (liveNames.has(name) || name in RETIRED_IDENTIFIERS || name in LIVE_UNEXPORTED_IDENTIFIERS) continue;
    throw new Error(`이관 표의 ${name}이 은퇴 사전에도 살아있는 목록에도 없다(둘 중 하나로 판단을 기록한다)`);
  }
  for (const file of docFiles) {
    if (!CONSUMER_DOC_ROOTS.some((root) => file === root || file.startsWith(`${root}/`))) continue;
    const markdown = readFileSync(join(ROOT, file), "utf8");
    for (const paragraph of paragraphsOf(markdown)) {
      if (MIGRATION_MARKERS.some((marker) => paragraph.includes(marker))) continue;
      for (const [name, replacement] of Object.entries(RETIRED_IDENTIFIERS)) {
        if (!new RegExp(`\\b${name}\\b`).test(paragraph)) continue;
        throw new Error(`${file}: 은퇴 이름 ${name}을 지시문으로 쓴다(현재 표면: ${replacement})`);
      }
    }
  }
  // 미출하 표면 표식. README가 정확한 버전 핀을 지시하는데 그 버전에 없는 subpath를 예시로 쓰면
  // 소비자가 ERR_PACKAGE_PATH_NOT_EXPORTED를 받는다(2026-07-27: pyproc/runtime이 그 상태였다).
  // 판정 근거는 CHANGELOG의 Unreleased 절이다(git 태그 접근 없이 성립한다).
  const changelog = readFileSync(join(ROOT, "CHANGELOG.md"), "utf8");
  // 선언은 CHANGELOG의 기계 판독 주석이다. Unreleased 절의 산문에서 긁으면 Fixed 절이 언급한
  // 이미 출하된 subpath까지 잡힌다(실측: pyproc/history가 그렇게 잡혔다).
  const declared = /<!-- unreleased-subpaths:([^>]*)-->/.exec(changelog)?.[1] || "";
  const unreleasedSubpaths = declared.split(",").map((name) => name.trim()).filter(Boolean);
  const MARKERS = ["unreleased", "미출하", "SHA pin", "SHA 핀"];
  // 스코프는 손으로 적지 않는다. 3파일 고정 목록이던 판정은 소비자 진입점이 가리키는 다른
  // 문서를 못 봤다: `docs/consuming/contract.md`가 정확한 버전 핀을 지시하면서 그 버전에 없는
  // subpath의 import 예제를 표식 없이 담고 있었다(외부 감사 실측 - 소비자가 그대로 따르면
  // ERR_PACKAGE_PATH_NOT_EXPORTED다). 언어 게이트와 같은 링크 유도 스코프를 쓴다.
  const resolveHref = (fromFile, href) => {
    const dir = fromFile.includes("/") ? fromFile.slice(0, fromFile.lastIndexOf("/")) : "";
    const stack = [];
    for (const part of `${dir}/${href}`.split("/")) {
      if (part === "." || part === "") continue;
      if (part === "..") stack.pop();
      else stack.push(part);
    }
    return stack.join("/");
  };
  const markerScope = new Set(["README.md", "README.ko.md", "docs/reference/api.md"]);
  for (const entry of [...markerScope]) {
    const text = readFileSync(join(ROOT, entry), "utf8");
    for (const m of text.matchAll(/\]\((?!https?:)([A-Za-z0-9/_.-]+\.md)\)/g)) {
      const resolved = resolveHref(entry, m[1]);
      // 소비자 대면 트리만. 내부 운영 문서는 핀 지시를 하지 않는다.
      if (!resolved.startsWith("docs/consuming/") && !resolved.startsWith("docs/reference/")) continue;
      if (existsSync(join(ROOT, resolved))) markerScope.add(resolved);
    }
  }
  for (const file of markerScope) {
    const markdown = readFileSync(join(ROOT, file), "utf8");
    for (const subpath of new Set(unreleasedSubpaths)) {
      if (!markdown.includes(subpath)) continue;
      const paragraphs = paragraphsOf(markdown).filter((block) => block.includes(subpath));
      const marked = paragraphs.some((block) => MARKERS.some((marker) => block.includes(marker)));
      if (!marked) throw new Error(`${file}: 미출하 subpath ${subpath}에 표식이 없다(소비자가 핀한 버전에는 없다)`);
    }
  }

  const freeze = readFileSync(join(ROOT, "docs", "operations", "experimentalFreeze.md"), "utf8");
  for (const subpath of EXPERIMENTAL_SUBPATHS) {
    if (!freeze.includes("`pyproc/" + subpath.slice(2) + "`")) throw new Error(`동결 문서에 ${subpath} 누락`);
  }
  return { rootValues: actualRoot, subpaths: exportKeys, experimental: EXPERIMENTAL_SUBPATHS };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await assertPublicSurface();
  console.log("PASS 공개 계약: package exports, root values, types, 문서 import 예제");
}
