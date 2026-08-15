// scanEngineIndependence.mjs - 이전 Python engine 결합 원장과 최종 zero-reference gate.
import { readFile, readdir, stat } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { dirname, extname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const INVENTORY_PATH = join(ROOT, "scripts", "engineIndependence", "couplingInventory.json");
const TOKEN = /pyodide|loadPyodide|pyproxy|pyodide\.ffi|micropip/iu;
const TEXT_EXTENSIONS = new Set([".js", ".mjs", ".cjs", ".ts", ".json", ".md", ".html", ".css", ".py", ".txt"]);
const HISTORY_ALLOWLIST = new Set([
  "CHANGELOG.md",
  "skills/evolve-pyproc/references/initiative-lessons.md",
  "scripts/engineIndependence/couplingInventory.json",
  "scripts/engineIndependence/evidenceRegister.json",
  "scripts/engineIndependence/scanEngineIndependence.mjs",
  "tests/attempts/README.md",
  "tests/attempts/envManager/README.md",
  "tests/attempts/envManager/envSnapshotProbe.html",
  "tests/attempts/envManager/freezeLockProbe.html",
  "tests/attempts/envManager/prefabSnapshotProbe.html",
  "tests/attempts/inTabTls/README.md",
  "tests/attempts/pythonMachine/README.md",
  "tests/attempts/pythonMachine/crossKernelProbe.html",
  "tests/attempts/pythonMachine/forkLiveWorker.js",
  "tests/attempts/pythonMachine/jailProbe.html",
  "tests/attempts/pythonMachine/offlineBootProbe.html",
  "tests/attempts/pythonMachine/runtimeIntegrityFrame.html",
  "tests/attempts/pythonMachine/runtimeIntegrityProbe.html",
  "tests/attempts/pythonMachine/sharedKernelWorker.js",
  "tests/attempts/pythonMachine/swOfflineSw.js",
  "tests/attempts/runtimeParity/README.md",
  "tests/attempts/runtimeParity/loadedEngineProbe.html",
  "tests/attempts/runtimeParity/reharvestProbe.html",
  "tests/attempts/runtimeParity/requestsProbe.html",
  "tests/attempts/selfHost/README.md",
  "tests/attempts/selfHost/fullStackProbe.html",
]);

async function walk(folder) {
  const files = [];
  for (const entry of await readdir(folder, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name === ".git" || entry.name === ".tmp") continue;
    const path = join(folder, entry.name);
    if (entry.isDirectory()) files.push(...await walk(path));
    else files.push(path);
  }
  return files;
}

function projectPath(path) { return relative(ROOT, path).replaceAll("\\", "/"); }

export async function sourceCouplings() {
  const files = await walk(join(ROOT, "src"));
  const matched = [];
  for (const path of files) {
    if (!TEXT_EXTENSIONS.has(extname(path))) continue;
    if (TOKEN.test(await readFile(path, "utf8"))) matched.push(projectPath(path));
  }
  return matched.sort();
}

export async function assertCouplingInventory() {
  const inventory = JSON.parse(await readFile(INVENTORY_PATH, "utf8"));
  if (inventory.schemaVersion !== 1 || !Array.isArray(inventory.entries) || inventory.entries.length !== 34) {
    throw new Error("engine independence coupling inventory must contain the 34-file baseline");
  }
  const allowed = new Set(inventory.allowedStatuses || []);
  const declared = inventory.entries.map((entry) => {
    if (!entry.path?.startsWith("src/") || !entry.responsibility || !entry.replacementOwner
      || !/^M(?:[2-9]|1[02])$/u.test(entry.deletionMilestone) || !allowed.has(entry.status)) {
      throw new Error(`invalid coupling inventory entry: ${JSON.stringify(entry)}`);
    }
    return entry.path;
  }).sort();
  if (new Set(declared).size !== declared.length) throw new Error("coupling inventory contains duplicate paths");
  const actual = await sourceCouplings();
  const complete = inventory.entries.every((entry) => entry.status === "verifiedAbsent");
  const expected = complete ? [] : declared;
  if (actual.join("\n") !== expected.join("\n")) {
    const declaredSet = new Set(declared);
    const actualSet = new Set(actual);
    const missing = expected.filter((path) => !actualSet.has(path));
    const unowned = actual.filter((path) => !declaredSet.has(path));
    throw new Error(`engine coupling inventory drift: missing=${missing.join(",") || "none"}; unowned=${unowned.join(",") || "none"}`);
  }
  return Object.freeze({ files: actual.length, entries: Object.freeze(actual), verifiedAbsent: complete });
}

export async function packedCouplings() {
  const packed = spawnSync("npm", ["pack", "--dry-run", "--json"], { cwd: ROOT, encoding: "utf8", shell: process.platform === "win32" });
  if (packed.status !== 0) throw new Error(packed.stderr || packed.stdout || "npm pack --dry-run failed");
  const report = JSON.parse(packed.stdout);
  const files = report[0]?.files?.map((entry) => entry.path).filter((path) => TEXT_EXTENSIONS.has(extname(path))) || [];
  const matched = [];
  for (const relPath of files) {
    const path = join(ROOT, relPath);
    try {
      if ((await stat(path)).isFile() && TOKEN.test(await readFile(path, "utf8"))) matched.push(relPath.replaceAll("\\", "/"));
    } catch (error) {
      throw new Error(`packed file cannot be inspected: ${relPath}`, { cause: error });
    }
  }
  return Object.freeze(matched.sort());
}

export async function repositoryCurrentCouplings() {
  const paths = [];
  for (const folder of ["src", "scripts", "tests", "skills"]) paths.push(...await walk(join(ROOT, folder)));
  for (const file of ["index.js", "README.md", "README.ko.md", "package.json", "package-lock.json", "CHANGELOG.md"]) {
    paths.push(join(ROOT, file));
  }
  const matched = [];
  for (const path of paths) {
    if (!TEXT_EXTENSIONS.has(extname(path))) continue;
    const relativePath = projectPath(path);
    if (HISTORY_ALLOWLIST.has(relativePath)) continue;
    if (TOKEN.test(await readFile(path, "utf8"))) matched.push(relativePath);
  }
  return Object.freeze(matched.sort());
}

export async function assertVerifiedAbsent() {
  const source = await sourceCouplings();
  const packed = await packedCouplings();
  const repository = await repositoryCurrentCouplings();
  if (source.length || packed.length || repository.length) {
    throw new Error(`engine independence zero-reference gate failed: source=${source.length}, packed=${packed.length}, repository=${repository.join(",") || "none"}`);
  }
  return Object.freeze({ source: 0, packed: 0, repository: 0 });
}

async function main() {
  const requireZero = process.argv.includes("--require-zero");
  if (requireZero) {
    console.log(JSON.stringify(await assertVerifiedAbsent()));
    return;
  }
  const inventory = await assertCouplingInventory();
  const packed = process.argv.includes("--packed") ? await packedCouplings() : [];
  console.log(JSON.stringify({ inventoryFiles: inventory.files, packedReferenceFiles: packed.length,
    packedFiles: packed }, null, 2));
}

if (resolve(process.argv[1] || "") === fileURLToPath(import.meta.url)) {
  main().catch((error) => { console.error(error?.stack || String(error)); process.exitCode = 1; });
}
