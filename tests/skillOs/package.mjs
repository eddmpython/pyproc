import { readFile, readdir, rm } from "node:fs/promises";
import { join, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { canonicalJson, sha256, slash, utf8Compare } from "../../scripts/skillOs/common.mjs";
import { checkSkillCatalog } from "../../scripts/skillOs/skillCatalog.mjs";
import { readSkillResource } from "../../scripts/skillOs/skillReader.mjs";
import { installPackedPyProc, ROOT } from "../packageHarness.mjs";

function assert(condition, message) { if (!condition) throw new Error(message); }

async function filesBelow(root, directory = root) {
  const found = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) found.push(...await filesBelow(root, path));
    else if (entry.isFile()) found.push(slash(relative(root, path)));
  }
  return found.sort(utf8Compare);
}

async function assertReadableParity(sourceRoot, packedRoot, sourceCatalog, packedCatalog) {
  for (const skill of sourceCatalog.skills) {
    const paths = ["SKILL.md", ...skill.references, ...skill.scripts, ...skill.assets];
    for (const relativePath of paths) {
      const metadata = relativePath === "SKILL.md" ? skill
        : sourceCatalog.resources.find((item) => item.path === `skills/${skill.name}/${relativePath}`);
      assert(metadata, `catalog metadata missing: ${skill.name}/${relativePath}`);
      const request = { name: skill.name, relativePath, expectedSha256: metadata.sha256 };
      const [source, packed] = await Promise.all([
        readSkillResource(sourceRoot, sourceCatalog, request),
        readSkillResource(packedRoot, packedCatalog, request),
      ]);
      assert(source.sha256 === packed.sha256 && source.content === packed.content,
        `source and package differ: ${skill.name}/${relativePath}`);
    }
  }
}

export async function assertSkillPackage() {
  const sourceRoot = resolve(ROOT, "skills");
  const sourceCatalog = await checkSkillCatalog(sourceRoot);
  const installed = await installPackedPyProc("pyproc-skill-package-");
  try {
    const packageRoot = resolve(installed.appDir, "node_modules", "pyproc");
    const packedRoot = resolve(packageRoot, "skills");
    const packedCatalog = await checkSkillCatalog(packedRoot);
    assert(canonicalJson(sourceCatalog) === canonicalJson(packedCatalog),
      "source and packed catalog differ");
    assert(sourceCatalog.catalogDigest === packedCatalog.catalogDigest
      && sourceCatalog.generatedFromDigest === packedCatalog.generatedFromDigest,
    "source and packed digest chain differs");

    const files = await filesBelow(packageRoot);
    const retiredRoot = ["do", "cs"].join("");
    assert(!files.some((path) => path === retiredRoot || path.startsWith(`${retiredRoot}/`)),
      "packed package contains the retired knowledge root");
    assert(!files.some((path) => path.startsWith("mainPlan/") || path.startsWith("tests/attempts/")),
      "packed package contains a migration ledger");
    const actualBodies = files.filter((path) => /^skills\/[^/]+\/SKILL\.md$/u.test(path));
    const expectedBodies = sourceCatalog.skills.map((skill) => skill.path).sort(utf8Compare);
    assert(canonicalJson(actualBodies) === canonicalJson(expectedBodies),
      "packed package has missing or undeclared skill bodies");
    for (const entry of [...sourceCatalog.skills, ...sourceCatalog.resources]) {
      const path = entry.path || `skills/${entry.name}/SKILL.md`;
      const bytes = await readFile(resolve(packageRoot, path));
      assert(sha256(bytes) === entry.sha256, `packed digest differs: ${path}`);
    }
    await assertReadableParity(sourceRoot, packedRoot, sourceCatalog, packedCatalog);

    const readerModule = await import(pathToFileURL(resolve(packageRoot,
      "scripts/skillOs/skillReader.mjs")).href);
    const searchModule = await import(pathToFileURL(resolve(packageRoot,
      "scripts/skillOs/skillSearch.mjs")).href);
    const result = searchModule.searchSkills(packedCatalog, "ship-pyproc");
    assert(result.results[0]?.name === "ship-pyproc" && !Object.hasOwn(result.results[0], "content"),
      "installed package metadata search failed");
    const selected = result.results[0];
    const body = await readerModule.readSkillResource(packedRoot, packedCatalog,
      { name: selected.name, expectedSha256: selected.sha256, relativePath: "SKILL.md" });
    assert(body.sha256 === selected.sha256 && body.catalogDigest === packedCatalog.catalogDigest,
      "installed package digest-bound read failed");
    const reference = packedCatalog.skills.find((skill) => skill.references.length)?.references[0];
    const owner = packedCatalog.skills.find((skill) => skill.references.includes(reference));
    if (owner && reference) {
      const metadata = packedCatalog.resources.find((item) => item.path === `skills/${owner.name}/${reference}`);
      const windowsPath = reference.replaceAll("/", "\\");
      const read = await readerModule.readSkillResource(packedRoot, packedCatalog,
        { name: owner.name, expectedSha256: metadata.sha256, relativePath: windowsPath });
      assert(read.sha256 === metadata.sha256, "Windows separator changed installed resource identity");
    }
    return { skills: packedCatalog.skills.length, resources: packedCatalog.resources.length,
      catalogDigest: packedCatalog.catalogDigest, files: files.length };
  } finally {
    await rm(installed.tmp, { recursive: true, force: true });
  }
}

console.log(JSON.stringify(await assertSkillPackage()));
