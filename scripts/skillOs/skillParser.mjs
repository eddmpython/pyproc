import { lstat, readFile, realpath, readdir } from "node:fs/promises";
import { basename, dirname, relative, resolve } from "node:path";

import { SkillOsError, containedPath, portableResourceBytes, sha256, slash, stableName, utf8Compare } from "./common.mjs";

const BODY_LIMIT = 96 * 1024;
const REFERENCE_LIMIT = 256 * 1024;
const DESCRIPTION_LIMIT = 768;
const REQUIRED_HEADINGS = Object.freeze([
  "Outcome", "Read first", "Procedure", "Verification", "Failure modes", "References",
]);
const OPTIONAL_HEADINGS = new Set([
  "Public surface", "Required authority", "Compatibility boundary", "Next skills", "Owned paths",
]);
const TEXT_DECODER = new TextDecoder("utf-8", { fatal: true });

function fail(code, message, context) { throw new SkillOsError(code, message, context); }

function parseScalar(source, key) {
  const value = source.trim();
  if (!value || /^[\[{*&!>|]/u.test(value) || /\s[#&*]\S/u.test(value)) {
    fail("SKILL_FRONTMATTER_INVALID", `${key} must be a plain or quoted scalar`);
  }
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    if (value.startsWith('"')) {
      try { return JSON.parse(value); }
      catch { fail("SKILL_FRONTMATTER_INVALID", `${key} has invalid quoted text`); }
    }
    return value.slice(1, -1).replaceAll("''", "'");
  }
  return value;
}

function parseFrontmatter(text) {
  if (!text.startsWith("---\n")) fail("SKILL_FRONTMATTER_INVALID", "SKILL.md must start with frontmatter");
  const end = text.indexOf("\n---\n", 4);
  if (end < 0) fail("SKILL_FRONTMATTER_INVALID", "SKILL.md frontmatter is not closed");
  const values = {};
  for (const line of text.slice(4, end).split("\n")) {
    if (!line.trim()) continue;
    const match = /^([A-Za-z][A-Za-z0-9_-]*):\s*(.+)$/u.exec(line);
    if (!match) fail("SKILL_FRONTMATTER_INVALID", `invalid frontmatter line: ${line}`);
    const [, key, raw] = match;
    if (!["name", "description"].includes(key)) fail("SKILL_FRONTMATTER_INVALID", `unknown frontmatter key: ${key}`);
    if (Object.hasOwn(values, key)) fail("SKILL_FRONTMATTER_INVALID", `duplicate frontmatter key: ${key}`);
    values[key] = parseScalar(raw, key);
  }
  if (typeof values.name !== "string" || typeof values.description !== "string") {
    fail("SKILL_FRONTMATTER_INVALID", "frontmatter requires name and description strings");
  }
  return { ...values, body: text.slice(end + 5) };
}

function validateBody(body) {
  const lines = body.split("\n");
  if (lines.length >= 500) fail("SKILL_RESOURCE_LIMIT", "SKILL.md must be shorter than 500 lines");
  const headingMatches = [...body.matchAll(/^##\s+(.+?)\s*$/gmu)];
  const headings = headingMatches.map((match) => match[1]);
  let cursor = -1;
  for (const required of REQUIRED_HEADINGS) {
    const index = headings.indexOf(required);
    if (index < 0 || index <= cursor) fail("SKILL_STRUCTURE_INVALID", `missing or out-of-order heading: ${required}`);
    cursor = index;
  }
  for (const [index, heading] of headings.entries()) {
    if (!REQUIRED_HEADINGS.includes(heading) && !OPTIONAL_HEADINGS.has(heading)) {
      fail("SKILL_STRUCTURE_INVALID", `unsupported level-two heading: ${heading}`);
    }
    const start = headingMatches[index].index + headingMatches[index][0].length;
    const end = headingMatches[index + 1]?.index ?? body.length;
    const section = body.slice(start, end).trim();
    if (!section) fail("SKILL_STRUCTURE_INVALID", `empty heading: ${heading}`);
  }
  for (const link of body.matchAll(/\[[^\]]*\]\(([^)]+)\)/gu)) {
    const target = link[1].trim().split("#", 1)[0];
    if (/^(?:javascript|data|file):/iu.test(target)) fail("SKILL_REFERENCE_ESCAPE", `unsafe Markdown link: ${target}`);
  }
  return headings;
}

async function validateContainedRealPath(root, path) {
  const rootReal = await realpath(root);
  const pathReal = await realpath(path);
  const fromRoot = relative(rootReal, pathReal);
  if (!fromRoot || fromRoot === ".." || fromRoot.startsWith("../") || fromRoot.startsWith("..\\")) {
    fail("SKILL_REFERENCE_ESCAPE", `resource escapes skill root: ${slash(path)}`);
  }
  const stat = await lstat(path);
  if (stat.isSymbolicLink()) fail("SKILL_REFERENCE_ESCAPE", `symlink is not allowed: ${slash(path)}`);
  return stat;
}

async function resourceFiles(skillRoot, folder, limit) {
  const directory = containedPath(skillRoot, folder);
  let entries;
  try { entries = await readdir(directory, { withFileTypes: true }); }
  catch (error) {
    if (error?.code === "ENOENT") return [];
    throw error;
  }
  const output = [];
  async function visit(current, relativeFolder) {
    for (const entry of (await readdir(current, { withFileTypes: true })).sort((a, b) => utf8Compare(a.name, b.name))) {
      const relativePath = slash(`${relativeFolder}/${entry.name}`);
      const path = containedPath(skillRoot, relativePath);
      if (entry.isSymbolicLink()) fail("SKILL_REFERENCE_ESCAPE", `symlink is not allowed: ${relativePath}`);
      if (entry.isDirectory()) await visit(path, relativePath);
      else if (entry.isFile()) {
        const stat = await validateContainedRealPath(skillRoot, path);
        if (stat.size > limit) fail("SKILL_RESOURCE_LIMIT", `${relativePath} exceeds ${limit} bytes`);
        const bytes = await readFile(path);
        if ((folder === "references" || folder === "scripts" || folder === "agents") && bytes.includes(0)) {
          fail("SKILL_STRUCTURE_INVALID", `text resource contains NUL: ${relativePath}`);
        }
        const portable = portableResourceBytes(relativePath, bytes);
        output.push(Object.freeze({ path: relativePath, bytes: portable.byteLength, sha256: sha256(portable) }));
      }
    }
  }
  if (entries.length) await visit(directory, folder);
  return output.sort((a, b) => utf8Compare(a.path, b.path));
}

export async function parseSkill(skillPath, { skillsRoot = dirname(skillPath) } = {}) {
  const path = resolve(skillPath);
  const directory = dirname(path);
  await validateContainedRealPath(resolve(skillsRoot), directory);
  const bytes = await readFile(path);
  if (bytes.byteLength > BODY_LIMIT) fail("SKILL_RESOURCE_LIMIT", "SKILL.md exceeds 96 KiB");
  if (bytes.includes(0)) fail("SKILL_STRUCTURE_INVALID", "SKILL.md contains NUL");
  let text;
  try { text = TEXT_DECODER.decode(bytes); }
  catch { fail("SKILL_STRUCTURE_INVALID", "SKILL.md is not valid UTF-8"); }
  text = text.replaceAll("\r\n", "\n").replaceAll("\r", "\n");
  const portable = Buffer.from(text);
  const frontmatter = parseFrontmatter(text);
  if (!stableName(frontmatter.name)) fail("SKILL_FRONTMATTER_INVALID", `invalid skill name: ${frontmatter.name}`);
  if (frontmatter.name !== basename(directory)) fail("SKILL_NAME_MISMATCH", `${frontmatter.name} does not match ${basename(directory)}`);
  if (Buffer.byteLength(frontmatter.description) > DESCRIPTION_LIMIT) {
    fail("SKILL_RESOURCE_LIMIT", "skill description exceeds 768 bytes");
  }
  if (!/\b(?:use|verify|build|run|manage|understand|develop|ship|control|automate|commit|transact|explore|reference)\b/iu.test(frontmatter.description)) {
    fail("SKILL_STRUCTURE_INVALID", "skill description must include an action trigger");
  }
  const headings = validateBody(frontmatter.body);
  const [references, scripts, assets, agents] = await Promise.all([
    resourceFiles(directory, "references", REFERENCE_LIMIT),
    resourceFiles(directory, "scripts", REFERENCE_LIMIT),
    resourceFiles(directory, "assets", REFERENCE_LIMIT),
    resourceFiles(directory, "agents", REFERENCE_LIMIT),
  ]);
  if (references.length > 8) fail("SKILL_RESOURCE_LIMIT", "a skill may declare at most eight direct references");
  return Object.freeze({ name: frontmatter.name, description: frontmatter.description,
    path: slash(relative(resolve(skillsRoot), path)), sourcePath: path, bytes: portable.byteLength,
    sha256: sha256(portable), normalizedSha256: sha256(portable), headings,
    references, scripts, assets, agents });
}

export const SKILL_SOURCE_LIMITS = Object.freeze({ bodyBytes: BODY_LIMIT,
  referenceBytes: REFERENCE_LIMIT, descriptionBytes: DESCRIPTION_LIMIT, directReferences: 8 });
