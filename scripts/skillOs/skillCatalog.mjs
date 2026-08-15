import { lstat, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { basename, resolve } from "node:path";

import { SkillOsError, canonicalJson, sha256, slash, utf8Compare } from "./common.mjs";
import { parseSkill } from "./skillParser.mjs";

export function catalogBytes(catalog) { return Buffer.from(canonicalJson(catalog)); }

export function calculateCatalogDigest(catalog) {
  const unsigned = { ...catalog };
  delete unsigned.catalogDigest;
  return sha256(Buffer.from(canonicalJson(unsigned)));
}

export function verifyCatalogDigest(catalog) {
  if (catalog?.format !== "pyproc-skill-catalog" || catalog.version !== 1
    || calculateCatalogDigest(catalog) !== catalog.catalogDigest) {
    throw new SkillOsError("SKILL_CATALOG_STALE", "skill catalog digest is invalid");
  }
  return catalog;
}

export async function buildSkillCatalog(skillsRoot) {
  const root = resolve(skillsRoot);
  const entries = (await readdir(root, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory()).sort((a, b) => utf8Compare(a.name, b.name));
  const seen = new Set();
  const parsed = [];
  for (const entry of entries) {
    const path = resolve(root, entry.name);
    const stat = await lstat(path);
    if (stat.isSymbolicLink()) throw new SkillOsError("SKILL_REFERENCE_ESCAPE", `skill directory is a symlink: ${entry.name}`);
    const record = await parseSkill(resolve(path, "SKILL.md"), { skillsRoot: root });
    const folded = record.name.normalize("NFKC").toLowerCase();
    if (seen.has(folded)) throw new SkillOsError("SKILL_NAME_DUPLICATE", `duplicate or confusable skill name: ${record.name}`);
    seen.add(folded);
    parsed.push(record);
  }
  if (!parsed.length) throw new SkillOsError("SKILL_STRUCTURE_INVALID", "skill tree is empty");
  const sourceRecords = parsed.flatMap((record) => [
    { path: `${record.name}/SKILL.md`, sha256: record.sha256 },
    ...[...record.references, ...record.scripts, ...record.assets, ...record.agents]
      .map((item) => ({ path: `${record.name}/${item.path}`, sha256: item.sha256 })),
  ]).sort((a, b) => utf8Compare(a.path, b.path));
  const generatedFromDigest = sha256(Buffer.from(canonicalJson(sourceRecords)));
  const skills = parsed.map((record) => Object.freeze({ name: record.name,
    description: record.description, path: `skills/${record.name}/SKILL.md`, sha256: record.sha256,
    bytes: record.bytes,
    references: record.references.map((item) => item.path), scripts: record.scripts.map((item) => item.path),
    assets: record.assets.map((item) => item.path) }));
  for (const entry of skills) {
    if (Buffer.byteLength(canonicalJson(entry)) > 2048) {
      throw new SkillOsError("SKILL_RESOURCE_LIMIT", `catalog entry exceeds 2 KiB: ${entry.name}`);
    }
  }
  const resources = parsed.flatMap((record) => [...record.references, ...record.scripts, ...record.assets]
    .map((item) => Object.freeze({ path: `skills/${record.name}/${item.path}`,
      bytes: item.bytes, sha256: item.sha256 }))).sort((a, b) => utf8Compare(a.path, b.path));
  const base = { format: "pyproc-skill-catalog", version: 1, generatedFromDigest, catalogDigest: "", skills, resources };
  const catalog = Object.freeze({ ...base, catalogDigest: calculateCatalogDigest(base) });
  if (catalogBytes(catalog).byteLength > 128 * 1024) {
    throw new SkillOsError("SKILL_RESOURCE_LIMIT", "skill catalog exceeds 128 KiB");
  }
  return catalog;
}

export async function readSkillCatalog(skillsRoot) {
  const path = resolve(skillsRoot, "catalog.json");
  let catalog;
  try { catalog = JSON.parse(await readFile(path, "utf8")); }
  catch (error) { throw new SkillOsError("SKILL_CATALOG_STALE", `cannot read skill catalog: ${error.message}`); }
  return verifyCatalogDigest(catalog);
}

export async function checkSkillCatalog(skillsRoot) {
  const expected = catalogBytes(await buildSkillCatalog(skillsRoot));
  let actual;
  try { actual = await readFile(resolve(skillsRoot, "catalog.json")); }
  catch { throw new SkillOsError("SKILL_CATALOG_STALE", "skills/catalog.json is missing"); }
  if (!actual.equals(expected)) throw new SkillOsError("SKILL_CATALOG_STALE", "skills/catalog.json does not match source");
  return JSON.parse(expected);
}

export async function writeSkillCatalog(skillsRoot) {
  const path = resolve(skillsRoot, "catalog.json");
  const temporary = resolve(skillsRoot, `.catalog.${process.pid}.${Date.now()}.tmp`);
  const bytes = catalogBytes(await buildSkillCatalog(skillsRoot));
  try {
    await writeFile(temporary, bytes, { flag: "wx" });
    await rename(temporary, path);
  } finally {
    await rm(temporary, { force: true }).catch(() => undefined);
  }
  return JSON.parse(bytes);
}

export function findCatalogSkill(catalog, name) {
  verifyCatalogDigest(catalog);
  const record = catalog.skills.find((entry) => entry.name === name);
  if (!record) throw new SkillOsError("SKILL_NOT_FOUND", `unknown skill: ${basename(String(name || ""))}`);
  return record;
}
