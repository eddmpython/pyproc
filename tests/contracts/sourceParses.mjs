// src의 모든 .js가 ESM으로 파스되는지 본다.
//
// 이 게이트가 없으면 구문 오류와 미정의 식별자의 정적 방어가 0이다. 타입 게이트는
// `allowJs: false`라 .js를 한 줄도 안 보고, 구조 게이트는 텍스트와 그래프 검사다. 그리고
// package exports 정적 그래프에서 도달하지 않는 파일이 있다(워커 커널, Service Worker, wasi
// 레인, 미참조 모듈). 그 파일들의 구문 오류는 브라우저 게이트가 그 코드 경로를 실제로 밟을
// 때만 드러나고, 안 밟는 분기(오류 처리, 폴백)는 게시까지 간다.
//
// 파스만 한다(평가하지 않는다). vm.SourceTextModule은 플래그가 필요하므로 자식 하나를 띄운다.
// 파일별 `node --check` spawn은 채택하지 않았다: Windows 실측 22.7초로 게이트 예산을 두 배로
// 만든다. 자식 하나 + 126 파스는 1초 미만이다.
import { spawnSync } from "node:child_process";
import { readdirSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
// 죽은 검사 방지 하한. 파서를 no-op으로 만들면 "0개 파스"가 되므로 이 하한이 그것을 잡는다.
// 값은 신설 시점 실측(126)의 여유 아래다. 내리려면 왜 소스가 줄었는지 같은 커밋에 적어야 한다.
const MIN_PARSED = 100;
const CHILD = `
const fs = require("node:fs");
const vm = require("node:vm");
const files = JSON.parse(process.argv[1]);
let parsed = 0;
const failures = [];
for (const file of files) {
  try { new vm.SourceTextModule(fs.readFileSync(file, "utf8"), { identifier: file }); parsed++; }
  catch (error) { failures.push(file + ": " + (error && error.message)); }
}
let poisonCaught = false;
try { new vm.SourceTextModule("const = ;"); } catch (error) { poisonCaught = true; }
console.log(JSON.stringify({ parsed, failures, poisonCaught }));
`;

function collectSources(dir, acc = []) {
  for (const entry of readdirSync(dir)) {
    if (entry === "assets" || entry.startsWith(".")) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) collectSources(full, acc);
    else if (entry.endsWith(".js")) acc.push(full);
  }
  return acc;
}

export function assertSourceParsesContract() {
  const files = collectSources(join(ROOT, "src"));
  if (files.length < MIN_PARSED) throw new Error(`src 파일 수가 하한 아래다: ${files.length} < ${MIN_PARSED}`);
  const child = spawnSync(process.execPath, ["--experimental-vm-modules", "-e", CHILD, JSON.stringify(files)], {
    encoding: "utf8",
    timeout: 120000,
  });
  if (child.status !== 0) throw new Error(`파서 자식이 실패했다: ${(child.stderr || "").slice(-400)}`);
  const report = JSON.parse(child.stdout.trim().split("\n").pop());
  // 파서가 실제로 판정하는지 매 실행마다 본다. 오염 fixture를 못 잡으면 통과 수는 의미가 없다.
  if (!report.poisonCaught) throw new Error("파서가 깨진 소스를 통과시켰다(검사가 죽었다)");
  if (report.failures.length) throw new Error(`ESM 파스 실패: ${report.failures.slice(0, 5).join(" / ")}`);
  if (report.parsed < MIN_PARSED) throw new Error(`파스 성공 수가 하한 아래다: ${report.parsed} < ${MIN_PARSED}`);
  return true;
}
