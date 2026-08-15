import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { readSkillCatalog } from "../../scripts/skillOs/skillCatalog.mjs";
import { searchSkills } from "../../scripts/skillOs/skillSearch.mjs";
import { parsePathRoutes, routeChangedPaths } from "../../scripts/skillOs/pathRouter.mjs";

const root = resolve(import.meta.dirname, "../..");
const catalog = await readSkillCatalog(resolve(root, "skills"));
const load = async (name) => (await readFile(resolve(import.meta.dirname, name), "utf8")).trim()
  .split(/\r?\n/u).map((line) => JSON.parse(line));
let positive = 0;
let forbidden = 0;
let omissions = 0;
for (const fixture of await load("positive-routing.jsonl")) {
  if (searchSkills(catalog, fixture.task).results[0]?.name === fixture.expected) positive += 1;
}
for (const fixture of await load("negative-routing.jsonl")) {
  if (searchSkills(catalog, fixture.task).results[0]?.name === fixture.forbidden) forbidden += 1;
}
const routes = parsePathRoutes(await readFile(resolve(root, "skills/start-pyproc/references/path-routing.md"), "utf8"));
for (const fixture of await load("changed-path-routing.jsonl")) {
  const routed = routeChangedPaths(routes, fixture.paths);
  if (!fixture.requiredSkills.every((value) => routed.read.includes(value))
    || !fixture.requiredGates.every((value) => routed.run.includes(value))) omissions += 1;
}
if (positive !== 20 || forbidden !== 0 || omissions !== 0) {
  throw new Error(`skill routing failed: positive=${positive}/20 forbidden=${forbidden} omissions=${omissions}`);
}
console.log(JSON.stringify({ positive: `${positive}/20`, forbidden, omissions,
  catalogDigest: catalog.catalogDigest }));
