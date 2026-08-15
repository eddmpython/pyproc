import { lstat, readFile, realpath } from "node:fs/promises";
import { dirname, relative, resolve } from "node:path";

import { SkillOsError, containedPath, portableResourceBytes, sha256, slash } from "./common.mjs";
import { findCatalogSkill, readSkillCatalog } from "./skillCatalog.mjs";

const BODY_LIMIT = 96 * 1024;
const REFERENCE_LIMIT = 256 * 1024;

function declaredResource(catalog, record, relativePath) {
  if (relativePath === "SKILL.md") return { path: "SKILL.md", bytes: record.bytes, sha256: record.sha256, kind: "body" };
  for (const [kind, resources] of [["reference", record.references], ["script", record.scripts],
    ["asset", record.assets]]) {
    if (resources.includes(relativePath)) {
      const found = catalog.resources.find((resource) => resource.path === `skills/${record.name}/${relativePath}`);
      if (!found) throw new SkillOsError("SKILL_CATALOG_STALE", `resource metadata is missing: ${relativePath}`);
      return { ...found, path: relativePath, kind };
    }
  }
  throw new SkillOsError("SKILL_RESOURCE_UNDECLARED", `resource is not declared: ${relativePath}`);
}

function mediaType(path, kind) {
  if (path.endsWith(".md")) return "text/markdown; charset=utf-8";
  if (path.endsWith(".json")) return "application/json";
  if (path.endsWith(".jsonl")) return "application/x-ndjson";
  if (path.endsWith(".yaml") || path.endsWith(".yml")) return "application/yaml";
  if (path.endsWith(".js") || path.endsWith(".mjs")) return "text/javascript; charset=utf-8";
  return kind === "asset" ? "application/octet-stream" : "text/plain; charset=utf-8";
}

export async function readSkillResource(skillsRoot, catalog, request) {
  if (!request || typeof request !== "object") throw new SkillOsError("SKILL_READ_INVALID", "skill read request is required");
  const record = findCatalogSkill(catalog, request.name);
  const relativePath = String(request.relativePath || "SKILL.md").replaceAll("\\", "/");
  containedPath(resolve(skillsRoot, record.name), relativePath);
  const declared = declaredResource(catalog, record, relativePath);
  if (request.expectedSha256 !== declared.sha256) {
    throw new SkillOsError("SKILL_READ_STALE", `expected digest does not match ${record.name}/${relativePath}`);
  }
  const root = resolve(skillsRoot);
  const path = containedPath(root, `${record.name}/${relativePath}`);
  const skillDirectory = containedPath(root, record.name);
  const [rootReal, skillReal, pathReal, stat] = await Promise.all([
    realpath(root), realpath(skillDirectory), realpath(path), lstat(path),
  ]);
  if (stat.isSymbolicLink() || relative(skillReal, pathReal).startsWith("..")
    || relative(rootReal, pathReal).startsWith("..")) {
    throw new SkillOsError("SKILL_REFERENCE_ESCAPE", `resource escapes skill root: ${relativePath}`);
  }
  const limit = declared.kind === "body" ? BODY_LIMIT : REFERENCE_LIMIT;
  if (stat.size > limit) throw new SkillOsError("SKILL_RESOURCE_LIMIT", `${relativePath} exceeds read limit`);
  const sourceBytes = await readFile(path);
  const bytes = portableResourceBytes(relativePath, sourceBytes);
  if (bytes.byteLength !== declared.bytes || sha256(bytes) !== declared.sha256) {
    throw new SkillOsError("SKILL_READ_STALE", `resource bytes do not match catalog: ${relativePath}`);
  }
  const type = mediaType(relativePath, declared.kind);
  if (!type.startsWith("application/octet-stream") && bytes.includes(0)) {
    throw new SkillOsError("SKILL_STRUCTURE_INVALID", `text resource contains NUL: ${relativePath}`);
  }
  return Object.freeze({ name: record.name, path: slash(`${record.name}/${relativePath}`),
    mediaType: type, bytes: bytes.byteLength, sha256: declared.sha256,
    catalogDigest: catalog.catalogDigest,
    content: type === "application/octet-stream" ? bytes.toString("base64") : bytes.toString("utf8") });
}

export async function openSkillReader(skillsRoot) {
  const catalog = await readSkillCatalog(skillsRoot);
  return Object.freeze({ catalog, read: (request) => readSkillResource(skillsRoot, catalog, request) });
}
