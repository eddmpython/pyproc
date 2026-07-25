// 공개 package surface와 문서 import 예제를 실제 모듈 export에 대조한다.
import { existsSync, readFileSync } from "node:fs";
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

function targetOf(value) {
  return typeof value === "string" ? value : value.default;
}

function typesOf(value) {
  return typeof value === "object" ? value.types : null;
}

function importedNames(markdown) {
  const imports = [];
  const pattern = /import\s+(?!type\b)\{([\s\S]*?)\}\s+from\s+["'](pyproc(?:\/[^"']+)?)["']/g;
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
  for (const file of [
    "README.md",
    "README.ko.md",
    "docs/consuming/contract.md",
    "docs/consuming/compatibility.md",
    "docs/reference/api.md",
  ]) {
    const markdown = readFileSync(join(ROOT, file), "utf8");
    for (const statement of importedNames(markdown)) {
      const module = modules.get(statement.specifier);
      if (!module) throw new Error(`${file}: 미공개 specifier ${statement.specifier}`);
      for (const name of statement.names) {
        if (!(name in module)) throw new Error(`${file}: ${statement.specifier}에 ${name} 값-export 없음`);
      }
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
