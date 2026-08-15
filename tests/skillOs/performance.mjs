import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { checkSkillCatalog } from "../../scripts/skillOs/skillCatalog.mjs";
import { parsePathRoutes, routeChangedPaths } from "../../scripts/skillOs/pathRouter.mjs";
import { readSkillResource } from "../../scripts/skillOs/skillReader.mjs";
import { searchSkills } from "../../scripts/skillOs/skillSearch.mjs";
import { validateSkillOs } from "../../scripts/skillOs/validate.mjs";

const root = resolve(import.meta.dirname, "../..");
const skillsRoot = resolve(root, "skills");

function assert(condition, message) { if (!condition) throw new Error(message); }
function rounded(value) { return Number(value.toFixed(3)); }
function statistics(samples) {
  const ordered = [...samples].sort((left, right) => left - right);
  return Object.freeze({ medianMs: rounded(ordered[Math.floor(ordered.length / 2)]),
    p95Ms: rounded(ordered[Math.min(ordered.length - 1, Math.ceil(ordered.length * 0.95) - 1)]) });
}
async function measure(samples, action) {
  const results = [];
  for (let index = 0; index < samples; index += 1) {
    const startedAt = performance.now();
    await action(index);
    results.push(performance.now() - startedAt);
  }
  return results;
}

export async function assertSkillPerformance() {
  const catalogSamples = await measure(7, () => checkSkillCatalog(skillsRoot));
  const catalog = await checkSkillCatalog(skillsRoot);
  const searchSamples = await measure(101, () => searchSkills(catalog, "browser evidence verification"));
  const selected = catalog.skills.find((skill) => skill.name === "start-pyproc");
  const readSamples = await measure(21, () => readSkillResource(skillsRoot, catalog,
    { name: selected.name, expectedSha256: selected.sha256, relativePath: "SKILL.md" }));
  const routes = parsePathRoutes(await readFile(resolve(skillsRoot,
    "start-pyproc/references/path-routing.md"), "utf8"));
  const paths = Array.from({ length: 1000 }, (_, index) => index % 2
    ? "src/runtime/kernel/valueEnvelope.js" : "scripts/browserControl/browserAutomation.js");
  const routeSamples = await measure(11, () => routeChangedPaths(routes, paths));
  const fullSamples = await measure(3, () => validateSkillOs());
  const metrics = Object.freeze({ catalog: statistics(catalogSamples), search: statistics(searchSamples),
    read: statistics(readSamples), route1000: statistics(routeSamples), full: statistics(fullSamples) });
  // Windows hosted runners and Defender-backed worktrees have wider filesystem and scheduler
  // variance. Linux keeps the original ceilings; Windows gets bounded 1.5x release-lane margin.
  const platformBudgetFactor = process.platform === "win32" ? 1.5 : 1;

  assert(catalogSamples[0] <= 250 * platformBudgetFactor
    && metrics.catalog.medianMs <= 100 * platformBudgetFactor,
    `catalog performance budget exceeded: ${JSON.stringify(metrics.catalog)}`);
  assert(searchSamples[0] <= 20 * platformBudgetFactor
    && metrics.search.medianMs <= 5 * platformBudgetFactor,
    `search performance budget exceeded: ${JSON.stringify(metrics.search)}`);
  assert(readSamples[0] <= 20 * platformBudgetFactor
    && metrics.read.medianMs <= 5 * platformBudgetFactor,
    `read performance budget exceeded: ${JSON.stringify(metrics.read)}`);
  assert(routeSamples[0] <= 50 * platformBudgetFactor
    && metrics.route1000.medianMs <= 20 * platformBudgetFactor,
    `path routing performance budget exceeded: ${JSON.stringify(metrics.route1000)}`);
  assert(fullSamples[0] <= 2000 * platformBudgetFactor
    && metrics.full.medianMs <= 1000 * platformBudgetFactor,
    `full validation performance budget exceeded: ${JSON.stringify(metrics.full)}`);
  return metrics;
}

console.log(JSON.stringify(await assertSkillPerformance()));
