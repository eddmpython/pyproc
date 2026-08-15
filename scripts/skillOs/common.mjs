import { createHash } from "node:crypto";
import { extname, isAbsolute, relative, resolve, sep } from "node:path";

const PORTABLE_TEXT_EXTENSIONS = new Set([
  ".css", ".html", ".js", ".json", ".jsonl", ".md", ".mjs", ".py", ".sh", ".toml", ".txt", ".yaml", ".yml",
]);
const UTF8 = new TextDecoder("utf-8", { fatal: true });

export class SkillOsError extends Error {
  constructor(code, message, context = {}) {
    super(message);
    this.name = "SkillOsError";
    this.code = code;
    this.context = Object.freeze({ ...context });
  }
}

export const sha256 = (bytes) => `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
export const utf8Compare = (left, right) => Buffer.from(String(left)).compare(Buffer.from(String(right)));
export const slash = (value) => String(value).replaceAll("\\", "/");
export const canonicalJson = (value) => `${JSON.stringify(value, null, 2)}\n`;

export function portableResourceBytes(path, bytes) {
  const source = Buffer.from(bytes);
  if (!PORTABLE_TEXT_EXTENSIONS.has(extname(String(path)).toLowerCase())) return source;
  let text;
  try { text = UTF8.decode(source); }
  catch (error) { throw new SkillOsError("SKILL_STRUCTURE_INVALID", `text resource is not valid UTF-8: ${path}`, { cause: error }); }
  return Buffer.from(text.replaceAll("\r\n", "\n").replaceAll("\r", "\n"));
}

export function containedPath(root, relativePath, code = "SKILL_REFERENCE_ESCAPE") {
  const text = String(relativePath || "");
  if (!text || isAbsolute(text) || /^[A-Za-z]:/u.test(text) || text.startsWith("\\\\")
    || text.split(/[\\/]/u).some((part) => part === "..") || /%2e|%2f|%5c/iu.test(text)) {
    throw new SkillOsError(code, `unsafe skill path: ${text}`);
  }
  const absoluteRoot = resolve(root);
  const absolute = resolve(absoluteRoot, text);
  const pathFromRoot = relative(absoluteRoot, absolute);
  if (!pathFromRoot || pathFromRoot === "." || pathFromRoot.startsWith(`..${sep}`) || pathFromRoot === ".."
    || isAbsolute(pathFromRoot)) throw new SkillOsError(code, `skill path escapes its root: ${text}`);
  return absolute;
}

export function stableName(value) {
  return typeof value === "string" && value.length < 64 && /^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(value);
}
