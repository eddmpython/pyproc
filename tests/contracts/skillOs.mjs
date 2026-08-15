import { cp, mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { canonicalJson } from "../../scripts/skillOs/common.mjs";
import { buildSkillCatalog, checkSkillCatalog, writeSkillCatalog } from "../../scripts/skillOs/skillCatalog.mjs";
import { parseSkill } from "../../scripts/skillOs/skillParser.mjs";
import { readSkillResource } from "../../scripts/skillOs/skillReader.mjs";
import { searchSkills } from "../../scripts/skillOs/skillSearch.mjs";
import { parsePathRoutes, routeChangedPaths } from "../../scripts/skillOs/pathRouter.mjs";
import { validateSkillOs } from "../../scripts/skillOs/validate.mjs";

const root = resolve(import.meta.dirname, "../..");
const skillsRoot = resolve(root, "skills");

function assert(condition, message) { if (!condition) throw new Error(message); }

async function rejectsCode(action, expected) {
  let code = null;
  try { await action(); }
  catch (error) { code = error?.code || String(error); }
  assert(code === expected, `expected ${expected}, got ${code}`);
}

async function jsonLines(path) {
  return (await readFile(path, "utf8")).trim().split(/\r?\n/u).map((line) => JSON.parse(line));
}

function validSkill(name, extraFrontmatter = "") {
  return `---\nname: ${name}\ndescription: Use this fixture to verify a strict skill source contract.\n${extraFrontmatter}---\n\n# Fixture\n\n## Outcome\n\nReturn a result.\n\n## Read first\n\nRead the fixture.\n\n## Procedure\n\n1. Run it.\n\n## Verification\n\nVerify it.\n\n## Failure modes\n\nStop on failure.\n\n## References\n\nNo references are required.\n`;
}

export async function assertSkillOs() {
  const catalog = await checkSkillCatalog(skillsRoot);
  const security = await jsonLines(resolve(root, "tests/skillOs/reader-security.jsonl"));
  const securityTerminals = new Map();
  assert(catalog.skills.length === 17 && Buffer.byteLength(canonicalJson(catalog)) < 128 * 1024,
    "skill catalog count or budget drifted");
  const rebuilt = await buildSkillCatalog(skillsRoot);
  assert(canonicalJson(rebuilt) === canonicalJson(catalog), "skill catalog is not deterministic");

  const positive = await jsonLines(resolve(root, "tests/skillOs/positive-routing.jsonl"));
  const negative = await jsonLines(resolve(root, "tests/skillOs/negative-routing.jsonl"));
  const readRatios = [];
  const totalAuthoredBytes = catalog.skills.reduce((sum, skill) => sum + skill.bytes, 0)
    + catalog.resources.reduce((sum, resource) => sum + resource.bytes, 0);
  for (const fixture of positive) {
    const result = searchSkills(catalog, fixture.task);
    assert(result.results[0]?.name === fixture.expected, `${fixture.id}: expected ${fixture.expected}, got ${result.results[0]?.name}`);
    assert(result.results.length <= 3 && !Object.hasOwn(result.results[0], "content")
      && Buffer.byteLength(JSON.stringify(result)) <= 4096, `${fixture.id}: first-hop disclosure budget failed`);
    const skill = catalog.skills.find((entry) => entry.name === fixture.expected);
    const body = await readSkillResource(skillsRoot, catalog,
      { name: skill.name, expectedSha256: skill.sha256, relativePath: "SKILL.md" });
    readRatios.push(body.bytes / totalAuthoredBytes);
  }
  assert(readRatios.sort((a, b) => a - b)[Math.floor(readRatios.length / 2)] < 0.2,
    "representative task disclosure median exceeds 20 percent");
  for (const fixture of negative) {
    const result = searchSkills(catalog, fixture.task);
    assert(result.results[0]?.name === fixture.expected && result.results[0]?.name !== fixture.forbidden,
      `${fixture.id}: forbidden top-1 route`);
  }

  const routeText = await readFile(resolve(skillsRoot, "start-pyproc/references/path-routing.md"), "utf8");
  const routes = parsePathRoutes(routeText);
  for (const fixture of await jsonLines(resolve(root, "tests/skillOs/changed-path-routing.jsonl"))) {
    const result = routeChangedPaths(routes, fixture.paths);
    assert(fixture.requiredSkills.every((name) => result.read.includes(name)), `${fixture.id}: required skill omitted`);
    assert(fixture.requiredGates.every((gate) => result.run.includes(gate)), `${fixture.id}: required gate omitted`);
    assert((fixture.unknown || []).every((path) => result.unknown.includes(path)), `${fixture.id}: unknown path not surfaced`);
  }

  const start = catalog.skills.find((entry) => entry.name === "start-pyproc");
  await rejectsCode(() => readSkillResource(skillsRoot, catalog,
    { name: start.name, expectedSha256: start.sha256, relativePath: "../README.md" }), "SKILL_REFERENCE_ESCAPE");
  securityTerminals.set("security-02", "SKILL_REFERENCE_ESCAPE");
  await rejectsCode(() => readSkillResource(skillsRoot, catalog,
    { name: start.name, expectedSha256: `sha256:${"0".repeat(64)}` }), "SKILL_READ_STALE");
  securityTerminals.set("security-01", "SKILL_READ_STALE");

  const temporary = await mkdtemp(resolve(tmpdir(), "pyproc-skill-os-"));
  try {
    const validDir = resolve(temporary, "valid-skill");
    await mkdir(resolve(validDir, "references"), { recursive: true });
    await writeFile(resolve(validDir, "SKILL.md"), validSkill("valid-skill"));
    assert((await parseSkill(resolve(validDir, "SKILL.md"), { skillsRoot: temporary })).name === "valid-skill",
      "valid strict fixture was rejected");
    await writeFile(resolve(validDir, "SKILL.md"), validSkill("valid-skill", "name: duplicate\n"));
    await rejectsCode(() => parseSkill(resolve(validDir, "SKILL.md"), { skillsRoot: temporary }), "SKILL_FRONTMATTER_INVALID");
    securityTerminals.set("security-03", "SKILL_FRONTMATTER_INVALID");
    await writeFile(resolve(validDir, "SKILL.md"), validSkill("other-name"));
    await rejectsCode(() => parseSkill(resolve(validDir, "SKILL.md"), { skillsRoot: temporary }), "SKILL_NAME_MISMATCH");
    securityTerminals.set("security-04", "SKILL_NAME_MISMATCH");
    await writeFile(resolve(validDir, "SKILL.md"), validSkill("valid-skill").replace("## Failure modes", "## Missing"));
    await rejectsCode(() => parseSkill(resolve(validDir, "SKILL.md"), { skillsRoot: temporary }), "SKILL_STRUCTURE_INVALID");
    securityTerminals.set("security-05", "SKILL_STRUCTURE_INVALID");
    await writeFile(resolve(validDir, "SKILL.md"), validSkill("valid-skill"));
    const outside = resolve(temporary, "outside");
    await mkdir(outside);
    await writeFile(resolve(outside, "content.md"), "outside");
    await symlink(outside, resolve(validDir, "references", "escape"), "junction");
    await rejectsCode(() => parseSkill(resolve(validDir, "SKILL.md"), { skillsRoot: temporary }), "SKILL_REFERENCE_ESCAPE");
    securityTerminals.set("security-06", "SKILL_REFERENCE_ESCAPE");
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }

  assert(security.length === 6 && security.every((fixture) => securityTerminals.get(fixture.id) === fixture.expected),
    "reader security corpus did not reach every stable terminal");

  const validatorFixture = await mkdtemp(resolve(tmpdir(), "pyproc-skill-validator-"));
  try {
    const fixtureSkills = resolve(validatorFixture, "skills");
    await cp(skillsRoot, fixtureSkills, { recursive: true });
    await Promise.all([
      writeFile(resolve(validatorFixture, "README.md"), "# Fixture\n"),
      writeFile(resolve(validatorFixture, "README.ko.md"), "# Fixture\n"),
    ]);
    const brokenBody = resolve(fixtureSkills, "start-pyproc/SKILL.md");
    await writeFile(brokenBody, `${await readFile(brokenBody, "utf8")}\n[missing](missing.md)\n`);
    await writeSkillCatalog(fixtureSkills);
    await rejectsCode(() => validateSkillOs({ repositoryRoot: validatorFixture, skillsRoot: fixtureSkills }),
      "SKILL_STRUCTURE_INVALID");
    await rm(fixtureSkills, { recursive: true, force: true });
    await cp(skillsRoot, fixtureSkills, { recursive: true });
    await mkdir(resolve(validatorFixture, "docs"));
    await rejectsCode(() => validateSkillOs({ repositoryRoot: validatorFixture, skillsRoot: fixtureSkills }),
      "SKILL_OLD_ROOT_PRESENT");
    await rm(resolve(validatorFixture, "docs"), { recursive: true, force: true });
    await writeFile(resolve(validatorFixture, "projected.md"),
      await readFile(resolve(fixtureSkills, "start-pyproc/SKILL.md")));
    await rejectsCode(() => validateSkillOs({ repositoryRoot: validatorFixture, skillsRoot: fixtureSkills }),
      "SKILL_OWNER_DUPLICATE");
  } finally {
    await rm(validatorFixture, { recursive: true, force: true });
  }

  const summary = await validateSkillOs();
  assert(summary.skills === 17 && summary.authoredBytes > 0, "repository skill validator did not complete");
}
