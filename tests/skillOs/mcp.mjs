import { resolve } from "node:path";

import { createSkillMcpSurface } from "../../scripts/skillOs/skillMcp.mjs";
import { readSkillResource } from "../../scripts/skillOs/skillReader.mjs";

const root = resolve(import.meta.dirname, "../..");
const skillsRoot = resolve(root, "skills");

function assert(condition, message) { if (!condition) throw new Error(message); }
function toolText(result) { return JSON.parse(result.content[0].text); }

async function rejectsCode(action, expected) {
  let code;
  try { await action(); } catch (error) { code = error?.code; }
  assert(code === expected, `expected ${expected}, got ${String(code)}`);
}

export async function assertSkillMcp() {
  const surface = await createSkillMcpSurface({ skillsRoot });
  assert(surface.tools.map((tool) => tool.name).join(",") === "skills.search,skills.read",
    "MCP skill tool names drifted");
  assert(surface.tools.every((tool) => tool.annotations.readOnlyHint === true
    && tool.annotations.destructiveHint === false && tool.annotations.openWorldHint === false),
  "MCP skill tools acquired effect authority");
  const searched = toolText(await surface.invoke("skills.search", { query: "browser screenshot action evidence" }));
  assert(searched.results[0]?.name === "verify-browser-experience"
    && searched.results.length <= 3 && !Object.hasOwn(searched.results[0], "content"),
  "MCP metadata route is wrong or disclosed a body");
  const selected = searched.results[0];
  const mcpBody = toolText(await surface.invoke("skills.read",
    { name: selected.name, expectedSha256: selected.sha256, relativePath: "SKILL.md" }));
  const directBody = await readSkillResource(skillsRoot, surface.catalog,
    { name: selected.name, expectedSha256: selected.sha256, relativePath: "SKILL.md" });
  assert(mcpBody.content === directBody.content && mcpBody.sha256 === directBody.sha256
    && mcpBody.catalogDigest === surface.catalog.catalogDigest,
  "MCP body differs from the source reader");

  const owner = surface.catalog.skills.find((skill) => skill.references.length);
  const reference = owner.references[0];
  const metadata = surface.catalog.resources.find((item) => item.path === `skills/${owner.name}/${reference}`);
  const mcpReference = toolText(await surface.invoke("skills.read",
    { name: owner.name, expectedSha256: metadata.sha256, relativePath: reference }));
  const directReference = await readSkillResource(skillsRoot, surface.catalog,
    { name: owner.name, expectedSha256: metadata.sha256, relativePath: reference });
  assert(mcpReference.content === directReference.content && mcpReference.sha256 === directReference.sha256,
    "MCP reference differs from the source reader");
  await rejectsCode(() => surface.invoke("skills.read",
    { name: selected.name, expectedSha256: `sha256:${"0".repeat(64)}`, relativePath: "SKILL.md" }),
  "SKILL_READ_STALE");
  await rejectsCode(() => surface.invoke("skills.read",
    { name: selected.name, expectedSha256: selected.sha256, relativePath: "../README.md" }),
  "SKILL_REFERENCE_ESCAPE");
  return { tools: surface.tools.length, catalogDigest: surface.catalog.catalogDigest,
    bodySha256: mcpBody.sha256, referenceSha256: mcpReference.sha256 };
}

console.log(JSON.stringify(await assertSkillMcp()));
