#!/usr/bin/env node
import { existsSync } from "node:fs";
import { readFile, readdir } from "node:fs/promises";
import { dirname, relative, resolve } from "node:path";

import { SkillOsError, sha256, slash, utf8Compare } from "./common.mjs";
import { checkSkillCatalog } from "./skillCatalog.mjs";

const defaultRoot = resolve(import.meta.dirname, "../..");
const TEXT_EXTENSIONS = new Set([".css", ".html", ".js", ".json", ".jsonl", ".md", ".mjs", ".py",
  ".toml", ".ts", ".yaml", ".yml"]);

async function filesBelow(directory) {
  const found = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.isDirectory() && [".git", ".tmp", "node_modules", "vendor"].includes(entry.name)) continue;
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) found.push(...await filesBelow(path));
    else if (entry.isFile()) found.push(path);
  }
  return found;
}

function normalizeNormative(value) {
  return value.normalize("NFKC").toLowerCase().replace(/`[^`]+`/gu, " code ")
    .replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

async function validateSkillLinks(catalog, skillsRoot) {
  const failures = [];
  for (const skill of catalog.skills) {
    const resources = ["SKILL.md", ...skill.references];
    for (const resource of resources) {
      const path = resolve(skillsRoot, skill.name, resource);
      const text = await readFile(path, "utf8");
      if (resource !== "SKILL.md" && text.split(/\r?\n/u).length > 100 && !/^## Contents$/mu.test(text)) {
        failures.push(`${skill.name}/${resource}: long reference has no Contents heading`);
      }
      for (const match of text.matchAll(/!?\[[^\]]*\]\(([^)]+)\)/gu)) {
        const target = match[1].trim().split("#", 1)[0];
        if (!target || /^(?:https?|mailto):/iu.test(target)) continue;
        if (/^(?:javascript|data|file):/iu.test(target)) failures.push(`${skill.name}/${resource}: unsafe link ${target}`);
        else if (!existsSync(resolve(dirname(path), target))) failures.push(`${skill.name}/${resource}: missing link ${target}`);
      }
    }
  }
  if (failures.length) throw new SkillOsError("SKILL_STRUCTURE_INVALID", failures.slice(0, 20).join("\n"));
}

async function validateNormativeOwners(catalog, skillsRoot) {
  const owners = new Map();
  for (const skill of catalog.skills) {
    for (const resource of ["SKILL.md", ...skill.references]) {
      const text = await readFile(resolve(skillsRoot, skill.name, resource), "utf8");
      for (const paragraph of text.split(/\n\s*\n/gu)) {
        const normalized = normalizeNormative(paragraph);
        if (normalized.length < 120 || !/(?:must|only|required|forbid|금지|필수|해야|허용하지)/iu.test(paragraph)) continue;
        const names = owners.get(normalized) || new Set();
        names.add(skill.name);
        owners.set(normalized, names);
      }
    }
  }
  const duplicates = [...owners].filter(([, names]) => names.size > 1);
  if (duplicates.length) throw new SkillOsError("SKILL_OWNER_DUPLICATE",
    duplicates.slice(0, 10).map(([, names]) => [...names].join(",")).join("\n"));
}

async function validateLandingDuplication(catalog, root, skillsRoot) {
  const skillParagraphs = new Set();
  for (const skill of catalog.skills) {
    for (const resource of ["SKILL.md", ...skill.references]) {
      const text = await readFile(resolve(skillsRoot, skill.name, resource), "utf8");
      for (const paragraph of text.split(/\n\s*\n/gu)) {
        const normalized = normalizeNormative(paragraph);
        if (normalized.length >= 120) skillParagraphs.add(normalized);
      }
    }
  }
  for (const name of ["README.md", "README.ko.md"]) {
    const path = resolve(root, name);
    const text = await readFile(path, "utf8");
    if (Buffer.byteLength(text) > 16 * 1024) {
      throw new SkillOsError("SKILL_RESOURCE_LIMIT", `${name} exceeds the landing-page budget`);
    }
    const duplicate = text.split(/\n\s*\n/gu).map(normalizeNormative)
      .find((paragraph) => paragraph.length >= 120 && skillParagraphs.has(paragraph));
    if (duplicate) throw new SkillOsError("SKILL_OWNER_DUPLICATE", `${name} duplicates a skill paragraph`);
  }
}

async function validateNoFullBodyProjection(catalog, root) {
  const bodyDigests = new Set(catalog.skills.map((skill) => skill.sha256));
  const violations = [];
  for (const path of await filesBelow(root)) {
    const relativePath = slash(relative(root, path));
    if (relativePath.startsWith("skills/") || relativePath.startsWith("mainPlan/")
      || relativePath.startsWith("tests/attempts/")) continue;
    const dot = path.lastIndexOf(".");
    if (!TEXT_EXTENSIONS.has(dot < 0 ? "" : path.slice(dot).toLowerCase())) continue;
    const bytes = await readFile(path);
    if (bodyDigests.has(sha256(bytes))) violations.push(relativePath);
  }
  if (violations.length) throw new SkillOsError("SKILL_OWNER_DUPLICATE",
    `full skill body projections remain: ${violations.sort(utf8Compare).join(", ")}`);
}

async function validateNoOldKnowledgeRoot(root) {
  if (existsSync(resolve(root, "docs"))) throw new SkillOsError("SKILL_OLD_ROOT_PRESENT", "docs directory still exists");
  const violations = [];
  for (const path of await filesBelow(root)) {
    const relativePath = slash(relative(root, path));
    if (relativePath === "CHANGELOG.md") continue;
    const dot = path.lastIndexOf(".");
    if (!TEXT_EXTENSIONS.has(dot < 0 ? "" : path.slice(dot).toLowerCase())) continue;
    const text = await readFile(path, "utf8");
    if (/(?:^|["'`(\s])docs[\\/]/mu.test(text)) violations.push(relativePath);
  }
  if (violations.length) throw new SkillOsError("SKILL_OLD_REFERENCE_PRESENT",
    `active docs references remain: ${violations.sort(utf8Compare).join(", ")}`);
}

export async function validateSkillOs({ repositoryRoot = defaultRoot,
  skillsRoot = resolve(repositoryRoot, "skills") } = {}) {
  const startedAt = performance.now();
  const catalog = await checkSkillCatalog(skillsRoot);
  await Promise.all([validateSkillLinks(catalog, skillsRoot), validateNormativeOwners(catalog, skillsRoot),
    validateLandingDuplication(catalog, repositoryRoot, skillsRoot),
    validateNoFullBodyProjection(catalog, repositoryRoot), validateNoOldKnowledgeRoot(repositoryRoot)]);
  return Object.freeze({ skills: catalog.skills.length, resources: catalog.resources.length,
    authoredBytes: catalog.skills.reduce((sum, skill) => sum + skill.bytes, 0)
      + catalog.resources.reduce((sum, resource) => sum + resource.bytes, 0),
    catalogDigest: catalog.catalogDigest, durationMs: Math.round(performance.now() - startedAt) });
}

if (resolve(process.argv[1] || "") === resolve(import.meta.filename)) {
  console.log(JSON.stringify(await validateSkillOs()));
}
