import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { SkillOsError, slash, utf8Compare } from "./common.mjs";

const ROUTE_BLOCK = /<!-- skill-routes:start -->\s*```json\s*([\s\S]*?)```\s*<!-- skill-routes:end -->/u;

function matches(pattern, path) {
  const normalizedPattern = slash(pattern);
  const normalizedPath = slash(path).replace(/^\.\//u, "");
  if (normalizedPattern.endsWith("/**")) return normalizedPath.startsWith(normalizedPattern.slice(0, -3));
  if (normalizedPattern.endsWith("/*")) {
    const prefix = normalizedPattern.slice(0, -1);
    return normalizedPath.startsWith(prefix) && !normalizedPath.slice(prefix.length).includes("/");
  }
  return normalizedPath === normalizedPattern;
}

export function parsePathRoutes(markdown) {
  const match = ROUTE_BLOCK.exec(String(markdown));
  if (!match) throw new SkillOsError("SKILL_ROUTE_INVALID", "path-routing.md has no canonical route block");
  let routes;
  try { routes = JSON.parse(match[1]); }
  catch (error) { throw new SkillOsError("SKILL_ROUTE_INVALID", `path route JSON is invalid: ${error.message}`); }
  if (!Array.isArray(routes) || !routes.length) throw new SkillOsError("SKILL_ROUTE_INVALID", "path route list is empty");
  for (const [index, route] of routes.entries()) {
    if (!Array.isArray(route.paths) || !route.paths.length || !Array.isArray(route.read) || !route.read.length
      || !Array.isArray(route.run)) throw new SkillOsError("SKILL_ROUTE_INVALID", `route ${index} is invalid`);
    if (![...route.paths, ...route.read, ...route.run].every((value) => typeof value === "string" && value)) {
      throw new SkillOsError("SKILL_ROUTE_INVALID", `route ${index} contains an invalid value`);
    }
  }
  return Object.freeze(routes.map((route) => Object.freeze({ paths: Object.freeze([...route.paths]),
    read: Object.freeze([...route.read]), run: Object.freeze([...route.run]) })));
}

export function routeChangedPaths(routes, changedPaths) {
  if (!Array.isArray(changedPaths) || !changedPaths.length) {
    throw new SkillOsError("SKILL_ROUTE_INVALID", "at least one changed path is required");
  }
  const read = new Set();
  const run = new Set();
  const unknown = [];
  for (const input of changedPaths) {
    const path = slash(input);
    const matched = routes.filter((route) => route.paths.some((pattern) => matches(pattern, path)));
    if (!matched.length) {
      unknown.push(path);
      read.add("develop-pyproc");
      read.add("verify-pyproc");
      continue;
    }
    for (const route of matched) {
      route.read.forEach((value) => read.add(value));
      route.run.forEach((value) => run.add(value));
    }
  }
  return Object.freeze({ read: Object.freeze([...read].sort(utf8Compare)),
    run: Object.freeze([...run].sort(utf8Compare)), unknown: Object.freeze(unknown.sort(utf8Compare)) });
}

export async function routeRepositoryPaths(repositoryRoot, changedPaths) {
  const path = resolve(repositoryRoot, "skills/start-pyproc/references/path-routing.md");
  return routeChangedPaths(parsePathRoutes(await readFile(path, "utf8")), changedPaths);
}
