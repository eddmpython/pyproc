#!/usr/bin/env node
import { resolve } from "node:path";

import { checkSkillCatalog, writeSkillCatalog } from "./skillCatalog.mjs";

const root = resolve(import.meta.dirname, "../..");
const skillsRoot = resolve(root, "skills");
const write = process.argv.slice(2).includes("--write");
const catalog = write ? await writeSkillCatalog(skillsRoot) : await checkSkillCatalog(skillsRoot);
console.log(JSON.stringify({ state: write ? "written" : "valid", skills: catalog.skills.length,
  catalogDigest: catalog.catalogDigest, generatedFromDigest: catalog.generatedFromDigest }));
