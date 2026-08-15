// tests/run.mjs - dependency-free repository structure gate.
import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, extname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { runContractSuites } from "./contracts/run.mjs";
import { assertAssetProvenanceArtifacts } from "../scripts/assetProvenance.mjs";
import { assertCouplingInventory, assertVerifiedAbsent }
  from "../scripts/engineIndependence/scanEngineIndependence.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const checks = [];
let failed = 0;

async function check(name, operation) {
  try {
    await operation();
    checks.push({ name, pass: true });
    console.log(`  PASS ${name}`);
  } catch (error) {
    failed += 1;
    checks.push({ name, pass: false, error: String(error?.message || error) });
    console.log(`  FAIL ${name}: ${String(error?.message || error)}`);
  }
}

function gitSurface() {
  const result = spawnSync("git", ["ls-files", "--cached", "--others", "--exclude-standard", "-z"], {
    cwd: ROOT,
    encoding: "utf8",
    timeout: 10000,
  });
  if (result.status !== 0) throw new Error(result.stderr || "git surface unavailable");
  return result.stdout.split("\0").filter(Boolean).map((path) => path.replaceAll("\\", "/"))
    .filter((path) => existsSync(join(ROOT, path)));
}

const files = gitSurface();
const textExtensions = new Set([".js", ".mjs", ".cjs", ".ts", ".json", ".md", ".html", ".css",
  ".yml", ".yaml", ".py", ".rs", ".toml", ".txt", ".sh"]);
const textFiles = files.filter((path) => textExtensions.has(extname(path).toLowerCase()));

function moduleRefs(source) {
  const refs = [];
  for (const match of source.matchAll(/^\s*(?:import|export)\s+(?:[^'"`]*?\s+from\s+)?["']([^"']+)["']/gmu)) {
    refs.push(match[1]);
  }
  for (const match of source.matchAll(/\bimport\s*\(\s*["']([^"']+)["']\s*\)/gu)) refs.push(match[1]);
  for (const match of source.matchAll(/new\s+URL\s*\(\s*["']([^"']+)["']\s*,\s*import\.meta\.url\s*\)/gu)) {
    refs.push(match[1]);
  }
  return refs;
}

function resolveModule(from, specifier) {
  if (!specifier.startsWith(".")) return null;
  const clean = specifier.split(/[?#]/u)[0];
  const target = resolve(dirname(join(ROOT, from)), clean);
  const candidates = [target, `${target}.js`, `${target}.mjs`, `${target}.json`, join(target, "index.js")];
  return candidates.find((path) => existsSync(path) && statSync(path).isFile()) || target;
}

function markdownLinks(source) {
  return [...source.matchAll(/\[[^\]]*\]\(([^)]+)\)/gu)].map((match) => match[1].trim());
}

function assertIndependentSurface(entries) {
  const forbiddenNames = ["eGxwb2Q=", "ZGFydGxhYg==", "Y29kYXJv"]
    .map((value) => Buffer.from(value, "base64").toString("utf8"));
  const forbiddenFraming = [
    "cHJvZHVjdCBjb25zdW1lcg==",
    "cGVyLWNvbnN1bWVy",
    "Y29uc3VtZXIgc3VwcG9ydA==",
    "Y29uc3VtaW5nIHByb2R1Y3Q=",
    "cGVyLXByb2R1Y3Q=",
    "Y29uc3VtcHRpb24gY29udHJhY3Q=",
  ].map((value) => Buffer.from(value, "base64").toString("utf8"));
  forbiddenFraming.push(
    String.fromCodePoint(0xc18c, 0xbe44, 0xc790, 0x20, 0xc9c0, 0xc6d0),
    String.fromCodePoint(0xc18c, 0xbe44, 0x20, 0xc81c, 0xd488),
    String.fromCodePoint(0xc18c, 0xbe44, 0x20, 0xacc4, 0xc57d),
  );
  const forbiddenLegacyNames = [
    "dGVzdDpjb25zdW1lcg==",
    "cHJvZHVjdGNvbnN1bWVy",
    "cGFja2FnZWNvbnN1bWVy",
    "Y29uc3VtZXJhZG9wdA==",
  ].map((value) => Buffer.from(value, "base64").toString("utf8"));
  for (const [path, source] of entries) {
    const lowered = source.toLowerCase();
    const loweredPath = path.toLowerCase();
    if (forbiddenNames.some((name) => lowered.includes(name))) {
      throw new Error(`named external repository remains: ${path}`);
    }
    if (forbiddenFraming.some((term) => lowered.includes(term))) {
      throw new Error(`external support framing remains: ${path}`);
    }
    if (forbiddenLegacyNames.some((term) => lowered.includes(term) || loweredPath.includes(term))) {
      throw new Error(`retired compatibility identifier remains: ${path}`);
    }
  }
}

console.log("pyproc gate\n");

await check("root value surface", async () => {
  const api = await import(pathToFileURL(join(ROOT, "index.js")).href);
  const expected = ["PYPROC_ERROR_CODES", "PyProcError", "boot", "checkEnvironment", "createWebComputer", "open"];
  const actual = Object.keys(api).sort();
  if (actual.join(",") !== expected.sort().join(",")) throw new Error(actual.join(","));
});

await check("package exports and bins resolve", () => {
  const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
  for (const [specifier, value] of Object.entries(pkg.exports || {})) {
    const target = typeof value === "string" ? value : value.default;
    if (!target || !existsSync(join(ROOT, target))) throw new Error(`${specifier}: missing default target`);
    if (typeof value === "object" && (!value.types || !existsSync(join(ROOT, value.types)))) {
      throw new Error(`${specifier}: missing type target`);
    }
  }
  for (const [name, target] of Object.entries(pkg.bin || {})) {
    if (!existsSync(join(ROOT, target))) throw new Error(`${name}: missing bin target ${target}`);
  }
  if (pkg.dependencies && Object.keys(pkg.dependencies).length) throw new Error("runtime dependency count is not zero");
});

await check("contract suites", async () => {
  const result = await runContractSuites();
  if (result.suites !== 36) throw new Error(`expected 36 suites, got ${result.suites}`);
});

await check("engine deletion inventory and packed zero reference", async () => {
  const inventory = await assertCouplingInventory();
  if (!inventory.verifiedAbsent || inventory.files !== 0) throw new Error("deletion inventory is not verified absent");
  const result = await assertVerifiedAbsent();
  if (result.source !== 0 || result.packed !== 0 || result.repository !== 0) throw new Error(JSON.stringify(result));
});

await check("relative module references resolve", () => {
  const problems = [];
  for (const path of files.filter((file) => /\.(?:js|mjs|cjs|ts)$/u.test(file))) {
    if (path.startsWith("tests/attempts/") || path.startsWith("mainPlan/")) continue;
    const source = readFileSync(join(ROOT, path), "utf8");
    for (const specifier of moduleRefs(source)) {
      const target = resolveModule(path, specifier);
      if (target && !existsSync(target)) problems.push(`${path} -> ${specifier}`);
    }
  }
  if (problems.length) throw new Error(problems.slice(0, 12).join(", "));
});

await check("deleted implementation files remain absent", () => {
  const deleted = [
    "src/runtime/runtime.js",
    "src/session/session.js",
    "src/processOs/worker.js",
    "src/processOs/pyProc.js",
    "src/composition/envManager.js",
    "src/capabilities/syscallBridge.js",
    "src/capabilities/wheelCache.js",
    "src/machine/composition/pyprocMachine.js",
  ];
  const present = deleted.filter((path) => existsSync(join(ROOT, path)));
  if (present.length) throw new Error(present.join(", "));
});

await check("text has no forbidden dash or control character", () => {
  for (const path of textFiles) {
    const source = readFileSync(join(ROOT, path), "utf8");
    if (source.includes(String.fromCodePoint(0x2013)) || source.includes(String.fromCodePoint(0x2014))) {
      throw new Error(`forbidden dash: ${path}`);
    }
    for (let index = 0; index < source.length; index += 1) {
      const code = source.charCodeAt(index);
      if (code < 32 && ![9, 10, 13].includes(code)) throw new Error(`control U+${code.toString(16)}: ${path}`);
    }
  }
});

await check("relative markdown links resolve", () => {
  const broken = [];
  for (const path of files.filter((file) => file.endsWith(".md")
    && !file.startsWith("mainPlan/") && !file.startsWith("tests/attempts/"))) {
    const source = readFileSync(join(ROOT, path), "utf8");
    for (const href of markdownLinks(source)) {
      if (!href || href.startsWith("#") || /^[a-z][a-z0-9+.-]*:/iu.test(href)) continue;
      const clean = href.replace(/^<|>$/gu, "").split(/[?#]/u)[0];
      if (!clean || clean.includes("{") || clean.includes("}")) continue;
      const target = resolve(dirname(join(ROOT, path)), decodeURIComponent(clean));
      if (!existsSync(target)) broken.push(`${path} -> ${href}`);
    }
  }
  if (broken.length) throw new Error(broken.slice(0, 12).join(", "));
});

await check("workflow actions use exact commits", () => {
  const workflows = files.filter((path) => path.startsWith(".github/workflows/") && /\.ya?ml$/u.test(path));
  for (const path of workflows) {
    const source = readFileSync(join(ROOT, path), "utf8");
    for (const match of source.matchAll(/\buses:\s*([^\s#]+)@([^\s#]+)/gu)) {
      if (match[1].startsWith("./")) continue;
      if (!/^[0-9a-f]{40}$/u.test(match[2])) throw new Error(`${path}: ${match[0]}`);
    }
  }
});

await check("asset provenance derived files", () => assertAssetProvenanceArtifacts());

await check("TypeScript surface", () => {
  const tsc = join(ROOT, "node_modules", "typescript", "bin", "tsc");
  const result = spawnSync(process.execPath, [tsc, "-p", "tests/tsconfig.json"], {
    cwd: ROOT,
    encoding: "utf8",
    timeout: 120000,
  });
  if (result.status !== 0) throw new Error((result.stderr || result.stdout).slice(-3000));
});

await check("public surface has no named external repository", () => {
  assertIndependentSurface(textFiles.map((path) => [path, readFileSync(join(ROOT, path), "utf8")]));
});

console.log(`\nresult: ${failed ? "RED" : "GREEN"} (${checks.length - failed}/${checks.length})`);
process.exit(failed ? 1 : 0);
