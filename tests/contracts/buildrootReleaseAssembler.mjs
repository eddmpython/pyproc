import { readFile, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { ROOT } from "../packageHarness.mjs";
import { createDeterministicZip, resolveLegalInfoPath } from "../../scripts/release/assembleBuildrootRelease.mjs";

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function readStoredEntries(archive) {
  const entries = new Map();
  let offset = 0;
  while (archive.readUInt32LE(offset) === 0x04034b50) {
    const method = archive.readUInt16LE(offset + 8);
    const byteLength = archive.readUInt32LE(offset + 22);
    const nameLength = archive.readUInt16LE(offset + 26);
    const extraLength = archive.readUInt16LE(offset + 28);
    assert(method === 0 && extraLength === 0, "release ZIP이 streaming 저장 방식 계약을 쓰지 않는다");
    const nameStart = offset + 30;
    const dataStart = nameStart + nameLength;
    const name = archive.subarray(nameStart, dataStart).toString("utf8");
    entries.set(name, archive.subarray(dataStart, dataStart + byteLength).toString("utf8"));
    offset = dataStart + byteLength;
  }
  assert(archive.readUInt32LE(offset) === 0x02014b50
    && archive.readUInt32LE(archive.byteLength - 22) === 0x06054b50,
  "release ZIP의 central directory가 완결되지 않았다");
  return entries;
}

export async function assertBuildrootReleaseAssemblerContract() {
  const cache = join(ROOT, ".cache");
  await mkdir(cache, { recursive: true });
  const workspace = await mkdtemp(join(cache, "releaseZipContract-"));
  const source = join(workspace, "legal");
  try {
    await mkdir(join(source, "nested"), { recursive: true });
    await writeFile(join(source, "alpha.txt"), "alpha\n");
    await writeFile(join(source, "nested", "beta.txt"), "beta\n");
    const inputs = ["nested/beta.txt", "alpha.txt"];
    const sourceDateEpoch = 1784143163;
    const first = join(workspace, "first.zip");
    const second = join(workspace, "second.zip");
    await createDeterministicZip({ sourceDirectory: source, target: first, files: inputs, sourceDateEpoch });
    await createDeterministicZip({ sourceDirectory: source, target: second, files: [...inputs].reverse(), sourceDateEpoch });
    const firstBytes = await readFile(first);
    assert(firstBytes.equals(await readFile(second)),
      "Buildroot legal ZIP이 같은 파일을 입력 순서와 무관하게 byte-identical하게 만들지 않았다");
    const entries = readStoredEntries(firstBytes);
    assert(entries.size === 2 && entries.get("alpha.txt") === "alpha\n"
      && entries.get("nested/beta.txt") === "beta\n",
    "Buildroot legal ZIP이 입력 파일의 경로와 byte를 보존하지 않았다");
    await assertRejects(
      createDeterministicZip({ sourceDirectory: source, target: join(workspace, "duplicate.zip"),
        files: ["nested/beta.txt", "nested\\beta.txt"], sourceDateEpoch }),
      "중복",
      "Buildroot legal ZIP이 같은 archive 경로의 별칭을 허용했다",
    );
    await assertRejects(
      createDeterministicZip({ sourceDirectory: source, target: join(workspace, "timestamp.zip"),
        files: ["alpha.txt"], sourceDateEpoch: 1 }),
      "timestamp 범위",
      "Buildroot legal ZIP이 표현할 수 없는 source date를 암묵 변환했다",
    );
    assert(resolveLegalInfoPath(source, "nested", "beta.txt") === join(source, "nested", "beta.txt"),
      "legal-info 정상 자식 경로가 보존되지 않았다");
    await assertRejects(
      Promise.resolve().then(() => resolveLegalInfoPath(source, "..", "outside.txt")),
      "입력 디렉터리 밖",
      "legal-info manifest가 입력 디렉터리 밖 파일을 증거로 인정했다",
    );
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
}

async function assertRejects(promise, pattern, message) {
  try { await promise; }
  catch (error) {
    if (String(error?.message || error).includes(pattern)) return;
    throw new Error(`${message}: ${String(error?.message || error)}`);
  }
  throw new Error(message);
}
