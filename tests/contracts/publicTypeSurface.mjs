// 공개 타입 표면(root와 subpath의 d.ts export)이 줄면 CHANGELOG Unreleased의 Breaking 표가 그 이름과
// 대체 경로를 공시해야 한다. 값 export만 보던 publicSurface.mjs는 0.0.22에서 root 이름 81개와 subpath 이름
// 34개가 사라진 것을 못 봤고, 그 릴리즈 노트는 "root는 그대로 6개"라고 적었다(소비 저장소 빌드가 깨진 실측).
// 기준선은 마지막 릴리즈의 타입 표면이고, 릴리즈 커밋이 `--write`로 같은 버전으로 갱신한다.
import { createRequire } from "node:module";
import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..", "..");
const BASELINE = join(HERE, "publicTypeSurface.json");
const QUALIFIED = /^(pyproc(?:\/[a-z]+)?): ([A-Za-z_$][\w$]*)$/;

function specifierOf(subpath) {
  return subpath === "." ? "pyproc" : `pyproc/${subpath.slice(2)}`;
}

// package.json exports의 types 대상마다 컴파일러가 보는 export 이름 집합이다. 값과 타입을 함께 센다:
// 소비자의 `import type`과 `import`가 모두 이 집합에서 해석되기 때문이다.
export function currentTypeSurface(root = ROOT) {
  const ts = createRequire(join(root, "package.json"))("typescript");
  const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
  const entries = Object.entries(pkg.exports)
    .filter(([, target]) => typeof target === "object" && target.types)
    .map(([subpath, target]) => [specifierOf(subpath), resolve(root, target.types)]);
  const program = ts.createProgram(entries.map(([, file]) => file), {
    noEmit: true, strict: true, skipLibCheck: false, allowJs: false,
    target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler, lib: ["lib.es2022.d.ts", "lib.dom.d.ts"],
  });
  const checker = program.getTypeChecker();
  const surfaces = {};
  for (const [specifier, file] of entries) {
    const source = program.getSourceFile(file);
    const symbol = source && checker.getSymbolAtLocation(source);
    if (!symbol) throw new Error(`${specifier}: 타입 진입점을 모듈로 읽지 못했다 (${file})`);
    surfaces[specifier] = checker.getExportsOfModule(symbol).map((entry) => entry.getName()).sort();
  }
  return surfaces;
}

function unreleasedSection(changelog) {
  const start = changelog.indexOf("\n## Unreleased");
  if (start < 0) throw new Error("CHANGELOG에 Unreleased 절이 없다");
  const next = changelog.indexOf("\n## ", start + 1);
  return changelog.slice(start, next < 0 ? undefined : next);
}

// Breaking 표 행의 첫 열은 `pyproc/<subpath>: Name` 형태의 code span 하나 이상, 둘째 열은 대체 경로다.
// 값 이관 표(publicSurface.mjs의 Before 열)는 맨 식별자만 읽으므로 두 표는 서로의 이름을 빌리지 않는다.
export function disclosedRemovals(section) {
  const rows = [];
  let inBreaking = false;
  for (const line of section.split("\n")) {
    if (line.startsWith("### ")) inBreaking = line.trim() === "### Breaking";
    if (!inBreaking) continue;
    const row = /^\|\s*(.+?)\s*\|\s*(.+?)\s*\|\s*$/.exec(line);
    if (!row || /^-+$/.test(row[1]) || row[1] === "Removed") continue;
    const names = [...row[1].matchAll(/`([^`]+)`/g)].map((span) => span[1]);
    if (names.length === 0 || names.some((name) => !QUALIFIED.test(name))) {
      throw new Error(`Breaking 표 행의 첫 열은 \`pyproc/<subpath>: Name\` code span이어야 한다: ${line}`);
    }
    const replacement = row[2].trim();
    if (!replacement || replacement === "-") throw new Error(`Breaking 표 행에 대체 경로가 없다(없으면 none과 이유): ${line}`);
    for (const name of names) rows.push({ name, replacement });
  }
  return rows;
}

// 기준선에 있고 현재 표면에 없는 이름은 공시돼야 하고, 공시된 이름은 실제로 사라진 이름이어야 한다.
export function assessTypeSurface({ baseline, current, disclosed }) {
  const removed = [];
  for (const [specifier, names] of Object.entries(baseline)) {
    const now = new Set(current[specifier] || []);
    for (const name of names) if (!now.has(name)) removed.push(`${specifier}: ${name}`);
  }
  const disclosedNames = new Set(disclosed.map((row) => row.name));
  const removedNames = new Set(removed);
  return {
    removed,
    undisclosed: removed.filter((name) => !disclosedNames.has(name)),
    stale: [...disclosedNames].filter((name) => !removedNames.has(name)),
  };
}

function collectMarkdown(dir, acc = []) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) collectMarkdown(full, acc);
    else if (entry.endsWith(".md")) acc.push(full);
  }
  return acc;
}

// 문서의 `import type { ... } from "pyproc..."` 예제는 현재 타입 표면으로 해석돼야 한다. 값 import는
// publicSurface.mjs가 실제 모듈로 대조한다.
function typeImports(markdown) {
  const pattern = /import\s+type\s+\{([^{}"'`]*?)\}\s+from\s+["'](pyproc(?:\/[^"']+)?)["']/g;
  return [...markdown.matchAll(pattern)].map((match) => ({
    specifier: match[2],
    names: match[1].split(",").map((part) => part.trim().split(/\s+as\s+/)[0]).filter(Boolean),
  }));
}

function assertTeeth() {
  const baseline = { pyproc: ["A", "B"], "pyproc/runtime": ["C"] };
  const bite = assessTypeSurface({ baseline, current: { pyproc: ["A"], "pyproc/runtime": ["C"] }, disclosed: [] });
  if (bite.undisclosed.join() !== "pyproc: B") throw new Error("음성 시험: 공시 없는 제거를 잡지 못했다");
  const gone = assessTypeSurface({ baseline, current: { pyproc: ["A", "B"] }, disclosed: [] });
  if (gone.undisclosed.join() !== "pyproc/runtime: C") throw new Error("음성 시험: subpath 제거를 잡지 못했다");
  const added = assessTypeSurface({ baseline, current: { pyproc: ["A", "B", "D"], "pyproc/runtime": ["C", "E"] }, disclosed: [] });
  if (added.undisclosed.length || added.stale.length) throw new Error("음성 시험: 추가만 한 표면을 거절했다");
  const stale = assessTypeSurface({ baseline, current: baseline, disclosed: [{ name: "pyproc: A", replacement: "none" }] });
  if (stale.stale.join() !== "pyproc: A") throw new Error("음성 시험: 사라지지 않은 이름의 공시를 잡지 못했다");
  const rows = disclosedRemovals("## Unreleased\n### Breaking\n| Removed | Replacement |\n|---|---|\n| `pyproc: B` | `pyproc: A` |\n");
  if (rows.length !== 1 || rows[0].name !== "pyproc: B") throw new Error("음성 시험: Breaking 표를 읽지 못했다");
  let rejected = false;
  try { disclosedRemovals("### Breaking\n| `B` | none |\n"); } catch { rejected = true; }
  if (!rejected) throw new Error("음성 시험: 한정되지 않은 이름을 받아들였다");
}

export async function assertPublicTypeSurface() {
  assertTeeth();
  const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
  const baseline = JSON.parse(readFileSync(BASELINE, "utf8"));
  if (baseline.version !== pkg.version) {
    throw new Error(`타입 표면 기준선 ${baseline.version}이 package ${pkg.version}과 다르다: 릴리즈 커밋이 `
      + "`node tests/contracts/publicTypeSurface.mjs --write`로 기준선을 갱신한다");
  }
  const current = currentTypeSurface();
  const changelog = readFileSync(join(ROOT, "CHANGELOG.md"), "utf8");
  const verdict = assessTypeSurface({
    baseline: baseline.surfaces, current, disclosed: disclosedRemovals(unreleasedSection(changelog)),
  });
  if (verdict.undisclosed.length) {
    throw new Error(`공개 타입 ${verdict.undisclosed.length}개가 사라졌는데 CHANGELOG Unreleased Breaking 표에 없다: `
      + verdict.undisclosed.slice(0, 20).join(", "));
  }
  if (verdict.stale.length) {
    throw new Error(`Breaking 표가 사라지지 않은 이름을 공시한다: ${verdict.stale.join(", ")}`);
  }
  const docFiles = [
    ...readdirSync(ROOT).filter((entry) => entry.endsWith(".md") && entry !== "CHANGELOG.md").map((entry) => join(ROOT, entry)),
    ...collectMarkdown(join(ROOT, "skills")),
  ];
  for (const file of docFiles) {
    for (const statement of typeImports(readFileSync(file, "utf8"))) {
      const names = new Set(current[statement.specifier] || []);
      if (!current[statement.specifier]) throw new Error(`${file}: 타입 표면에 없는 specifier ${statement.specifier}`);
      for (const name of statement.names) {
        if (!names.has(name)) throw new Error(`${file}: ${statement.specifier}에 타입 export ${name}이 없다`);
      }
    }
  }
  return { specifiers: Object.keys(current).length, removed: verdict.removed.length };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.includes("--write")) {
    const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
    writeFileSync(BASELINE, `${JSON.stringify({ version: pkg.version, surfaces: currentTypeSurface() }, null, 1)}\n`);
    console.log(`WROTE 공개 타입 표면 기준선 ${pkg.version}`);
  } else {
    const result = await assertPublicTypeSurface();
    console.log(`PASS 공개 타입 표면: ${result.specifiers} specifier, 공시된 제거 ${result.removed}개`);
  }
}
