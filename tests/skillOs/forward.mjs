import { cp, mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { canonicalJson, sha256 } from "../../scripts/skillOs/common.mjs";
import { checkSkillCatalog } from "../../scripts/skillOs/skillCatalog.mjs";
import { createSkillMcpSurface } from "../../scripts/skillOs/skillMcp.mjs";
import { parsePathRoutes, routeChangedPaths } from "../../scripts/skillOs/pathRouter.mjs";
import { readSkillResource } from "../../scripts/skillOs/skillReader.mjs";
import { createPublicSkillRenderModel } from "../../scripts/skillOs/skillRenderer.mjs";
import { searchSkills } from "../../scripts/skillOs/skillSearch.mjs";
import { installPackedPyProc, ROOT } from "../packageHarness.mjs";

const TASK_PATHS = Object.freeze({
  "positive-01": "CLAUDE.md",
  "positive-02": "README.md",
  "positive-03": "src/runtime/kernel/valueEnvelope.js",
  "positive-04": "tests/contracts/valueEnvelope.mjs",
  "positive-05": "tests/browser/perfBudget.json",
  "positive-06": "package.json",
  "positive-07": "scripts/assetCatalog.json",
  "positive-08": "mainPlan/12-installedControlContractParity/README.md",
  "positive-09": "src/runtime/index.js",
  "positive-10": "src/machine/composition/createWebComputer.js",
  "positive-11": "scripts/pyprocControl.mjs",
  "positive-12": "scripts/browserControl/browserAutomation.js",
  "positive-13": "scripts/perception/apxCatalog.js",
  "positive-14": "scripts/effectTransaction/effectTransaction.js",
  "positive-15": "scripts/appSpace/appSpaceCanonical.js",
  "positive-16": "scripts/replayGraph/replayGraph.js",
  "positive-17": "index.d.ts",
  "positive-18": "AGENTS.md",
  "positive-19": "README.ko.md",
  "positive-20": "src/machine/composition/kernelMachine.js",
});

function assert(condition, message) { if (!condition) throw new Error(message); }
function toolText(result) { return JSON.parse(result.content[0].text); }
async function jsonLines(path) {
  return (await readFile(path, "utf8")).trim().split(/\r?\n/u).map((line) => JSON.parse(line));
}

export async function assertForwardEvaluation() {
  const temporary = await mkdtemp(resolve(tmpdir(), "pyproc-skill-forward-"));
  const installed = await installPackedPyProc("pyproc-skill-forward-package-");
  try {
    const freshRoot = resolve(temporary, "fresh");
    await mkdir(freshRoot, { recursive: true });
    await cp(resolve(ROOT, "skills"), resolve(freshRoot, "skills"), { recursive: true });
    const sourceSkills = resolve(freshRoot, "skills");
    const packageRoot = resolve(installed.appDir, "node_modules", "pyproc");
    const packageSkills = resolve(packageRoot, "skills");
    const sourceCatalog = await checkSkillCatalog(sourceSkills);
    const packageCatalog = await checkSkillCatalog(packageSkills);
    assert(canonicalJson(sourceCatalog) === canonicalJson(packageCatalog),
      "fresh source and installed package catalog differ");

    const packageSearch = await import(pathToFileURL(resolve(packageRoot,
      "scripts/skillOs/skillSearch.mjs")).href);
    const packageReader = await import(pathToFileURL(resolve(packageRoot,
      "scripts/skillOs/skillReader.mjs")).href);
    const mcp = await createSkillMcpSurface({ skillsRoot: sourceSkills });
    const routeText = await readFile(resolve(sourceSkills, "start-pyproc/references/path-routing.md"), "utf8");
    const routes = parsePathRoutes(routeText);
    const fixtures = await jsonLines(resolve(ROOT, "tests/skillOs/positive-routing.jsonl"));
    assert(fixtures.length === 20, "forward corpus must contain 20 representative tasks");
    const totalAuthoredBytes = sourceCatalog.skills.reduce((sum, skill) => sum + skill.bytes, 0)
      + sourceCatalog.resources.reduce((sum, resource) => sum + resource.bytes, 0);
    const ratios = [];
    const episodes = [];
    for (const fixture of fixtures) {
      const [sourceRoute, packedRoute] = [
        searchSkills(sourceCatalog, fixture.task),
        packageSearch.searchSkills(packageCatalog, fixture.task),
      ];
      assert(sourceRoute.results[0]?.name === fixture.expected,
        `${fixture.id}: fresh source selected ${sourceRoute.results[0]?.name}`);
      assert(canonicalJson(sourceRoute) === canonicalJson(packedRoute),
        `${fixture.id}: packed route differs`);
      const selected = sourceRoute.results[0];
      const request = { name: selected.name, expectedSha256: selected.sha256, relativePath: "SKILL.md" };
      const [sourceBody, packedBody, mcpBody, rendered] = await Promise.all([
        readSkillResource(sourceSkills, sourceCatalog, request),
        packageReader.readSkillResource(packageSkills, packageCatalog, request),
        mcp.invoke("skills.read", request).then(toolText),
        createPublicSkillRenderModel(sourceSkills, sourceCatalog, request),
      ]);
      assert(sourceBody.content === packedBody.content && sourceBody.content === mcpBody.content
        && sourceBody.content === rendered.content && sourceBody.sha256 === rendered.sourceSha256,
      `${fixture.id}: source, package, MCP, and public render differ`);
      const pathRoute = routeChangedPaths(routes, [TASK_PATHS[fixture.id]]);
      ratios.push(sourceBody.bytes / totalAuthoredBytes);
      episodes.push({ schema: "pyproc.skill-episode.v1", episodeId: fixture.id,
        catalogDigest: sourceCatalog.catalogDigest, taskClass: fixture.expected,
        queryDigest: sha256(Buffer.from(`pyproc-forward-v1\0${fixture.task}`)),
        selectedSkill: selected.name, changedPaths: [TASK_PATHS[fixture.id]],
        requiredSkills: pathRoute.read, gates: pathRoute.run,
        reads: [{ path: sourceBody.path, bytes: sourceBody.bytes, sha256: sourceBody.sha256 }],
        failureClass: null, resultTerminal: "passed" });
    }
    const median = ratios.sort((left, right) => left - right)[Math.floor(ratios.length / 2)];
    assert(median < 0.2, `forward disclosure median is ${median}`);
    const episodePath = resolve(temporary, "episodes.jsonl");
    await writeFile(episodePath, `${episodes.map((episode) => JSON.stringify(episode)).join("\n")}\n`);
    const recorded = await jsonLines(episodePath);
    assert(recorded.length === 20 && recorded.every((episode) => episode.resultTerminal === "passed"
      && !Object.hasOwn(episode, "task") && episode.changedPaths.every((path) => !/^[/\\]|^[A-Za-z]:/u.test(path))),
    "forward episode privacy or terminal contract failed");
    return { tasks: episodes.length, terminals: "20/20", medianReadRatio: Number(median.toFixed(6)),
      catalogDigest: sourceCatalog.catalogDigest };
  } finally {
    await Promise.all([
      rm(temporary, { recursive: true, force: true }),
      rm(installed.tmp, { recursive: true, force: true }),
    ]);
  }
}

console.log(JSON.stringify(await assertForwardEvaluation()));
