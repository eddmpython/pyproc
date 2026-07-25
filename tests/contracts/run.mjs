import { readdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const HELPERS = new Set(["engineConformance.mjs", "run.mjs"]);

export async function runContractSuites() {
  const files = (await readdir(HERE))
    .filter((name) => name.endsWith(".mjs") && !HELPERS.has(name))
    .sort();
  let suites = 0;
  for (const file of files) {
    const module = await import(pathToFileURL(resolve(HERE, file)).href);
    const runners = Object.entries(module)
      .filter(([name, value]) => name.startsWith("assert") && typeof value === "function");
    if (runners.length !== 1) {
      throw new Error(`${file}: assert* suite export가 정확히 하나여야 한다`);
    }
    await runners[0][1]();
    suites++;
  }
  if (!suites) throw new Error("contract suite가 없다");
  return Object.freeze({ suites, files: Object.freeze(files) });
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : "";
if (invokedPath === fileURLToPath(import.meta.url)) {
  const result = await runContractSuites();
  console.log(`PASS contracts: ${result.suites} suites`);
}
