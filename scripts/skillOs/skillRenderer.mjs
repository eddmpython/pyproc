import { readSkillResource } from "./skillReader.mjs";

export async function createPublicSkillRenderModel(skillsRoot, catalog, request) {
  const resource = await readSkillResource(skillsRoot, catalog, request);
  return Object.freeze({
    format: "pyproc-public-skill.v1",
    skill: resource.name,
    path: resource.path,
    sourceSha256: resource.sha256,
    catalogDigest: resource.catalogDigest,
    mediaType: resource.mediaType,
    content: resource.content,
  });
}
