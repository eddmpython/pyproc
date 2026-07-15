// benchCompare.mjs - benchmark JSON artifact들을 검증하고 비교 Markdown 표로 합친다.
// 입력 artifact schema는 docs/operations/benchmarking.md의 raw output 계약을 따른다.
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { normalizeBenchArtifactFile, renderBenchCompareMarkdown } from "./benchArtifacts.mjs";

function takeArg(name) {
  const idx = process.argv.indexOf(name);
  if (idx >= 0 && process.argv[idx + 1]) {
    const value = process.argv[idx + 1];
    process.argv.splice(idx, 2);
    return value;
  }
  const i = process.argv.findIndex((a) => a.startsWith(name + "="));
  if (i >= 0) {
    const value = process.argv[i].slice(name.length + 1);
    process.argv.splice(i, 1);
    return value;
  }
  return null;
}

function fail(msg) {
  console.error("benchCompare: " + msg);
  process.exit(1);
}

const outPath = takeArg("--out");
const files = process.argv.slice(2).filter((a) => !a.startsWith("-"));
if (!files.length) fail("입력 JSON artifact가 필요하다");

let rows;
try {
  rows = files.map(normalizeBenchArtifactFile);
} catch (e) {
  fail(e.message);
}
const markdown = renderBenchCompareMarkdown(rows);
if (outPath) {
  await mkdir(dirname(resolve(outPath)), { recursive: true });
  await writeFile(resolve(outPath), markdown);
}
process.stdout.write(markdown);
