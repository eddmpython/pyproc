import { resolve } from "node:path";

import { readSkillCatalog } from "./skillCatalog.mjs";
import { readSkillResource } from "./skillReader.mjs";
import { searchSkills } from "./skillSearch.mjs";

export const SKILL_MCP_TOOLS = Object.freeze([
  Object.freeze({
    name: "skills.search",
    description: "Search the built-in PyProc skill catalog without reading skill bodies.",
    inputSchema: Object.freeze({ type: "object", properties: Object.freeze({
      query: Object.freeze({ type: "string", minLength: 1, maxLength: 4096 }),
      limit: Object.freeze({ type: "integer", minimum: 1, maximum: 3 }),
    }), required: Object.freeze(["query"]), additionalProperties: false }),
    annotations: Object.freeze({ readOnlyHint: true, destructiveHint: false, idempotentHint: true,
      openWorldHint: false }),
  }),
  Object.freeze({
    name: "skills.read",
    description: "Read one digest-bound built-in skill body or declared direct resource.",
    inputSchema: Object.freeze({ type: "object", properties: Object.freeze({
      name: Object.freeze({ type: "string", minLength: 1, maxLength: 63 }),
      relativePath: Object.freeze({ type: "string", minLength: 1, maxLength: 4096 }),
      expectedSha256: Object.freeze({ type: "string", pattern: "^sha256:[0-9a-f]{64}$" }),
    }), required: Object.freeze(["name", "expectedSha256"]), additionalProperties: false }),
    annotations: Object.freeze({ readOnlyHint: true, destructiveHint: false, idempotentHint: true,
      openWorldHint: false }),
  }),
]);

function toolResult(output) {
  return Object.freeze({
    content: Object.freeze([{ type: "text", text: JSON.stringify(output) }]),
    _meta: Object.freeze({ pyprocSkill: Object.freeze({ readOnly: true,
      catalogDigest: output.catalogDigest }) }),
  });
}

function assertArguments(tool, input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw Object.assign(new TypeError(`${tool} arguments must be an object`), { code: "SKILL_READ_INVALID" });
  }
  if (tool === "skills.search" && (typeof input.query !== "string" || !input.query.trim()
    || input.query.length > 4096)) {
    throw Object.assign(new TypeError("skills.search query must be 1 to 4096 characters"),
      { code: "SKILL_SEARCH_INVALID" });
  }
}

export async function createSkillMcpSurface({
  skillsRoot = resolve(import.meta.dirname, "../..", "skills"),
} = {}) {
  const catalog = await readSkillCatalog(skillsRoot);
  const names = new Set(SKILL_MCP_TOOLS.map((tool) => tool.name));
  return Object.freeze({
    catalog,
    tools: SKILL_MCP_TOOLS,
    hasTool: (name) => names.has(name),
    async invoke(name, input = {}) {
      assertArguments(name, input);
      if (name === "skills.search") return toolResult(searchSkills(catalog, input.query,
        input.limit === undefined ? {} : { limit: input.limit }));
      if (name === "skills.read") return toolResult(await readSkillResource(skillsRoot, catalog, input));
      throw Object.assign(new TypeError(`unknown skill tool: ${String(name)}`), { code: "SKILL_NOT_FOUND" });
    },
  });
}
