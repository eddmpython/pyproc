// hashSoundness.mjs - [해시 soundness] 절의 본문.
//
// run.mjs에서 나온 이유는 크기가 아니라 책임이다: 이 절은 property/fuzz 판정이고, run.mjs는
// 절을 엮어 돌리는 러너다. 판정 이름과 개수는 그대로다(게이트 층 하한이 그것을 센다).
// check는 러너가 주입한다: 통과/실패의 보고 방식은 러너가 소유한다.
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { mulberry32 } from "./seededRandom.mjs";

const ROOT = join(import.meta.dirname, "..", "..");

export async function assertHashSoundness(check) {
  const { MemoryCapability, PAGE_SIZE } = await import(pathToFileURL(join(ROOT, "src", "runtime", "memoryCapability.js")).href);
  const heapDelta = await import(pathToFileURL(join(ROOT, "src", "runtime", "heapDelta.js")).href);
  // fake engine: pageHashes/slicePage는 heapU8()만 쓴다. heap()이 항상 offset 0의 전량 뷰라는
  // 실엔진 계약(HEAPU8)을 재현해야 한다(비정렬 view면 Uint32Array(buf,0,..)가 어긋난다).
  const hashesOf = (arr) => new MemoryCapability({ heapU8: () => arr }).pageHashes();
  // 시드 고정 PRNG(mulberry32): fuzz 실패는 시드+반복 인덱스로 재현 가능해야 한다.

  // 핵심 주장(reactive.js:4 "완전 해시가 sound의 열쇠 - 샘플링 금지"): 임의 힙 변이 시퀀스에서
  // hashDiffPages가 실제로 바뀐 페이지를 하나도 놓치지 않는다(false-negative 0). 오라클은
  // byteDiffPages(전 바이트 비교) = ground truth. 이 경로는 저널·세션·이미지 export가 신뢰하는
  // 델타의 완전성 그 자체다: 놓친 페이지 = 불완전 델타 = 복원 크래시.
  check("해시 soundness: 임의 변이 false-negative 0 (fuzz 1200회)", () => {
    const rand = mulberry32(0x50554e44); // "PUND" - 시드 고정(재현)
    for (let it = 0; it < 1200; it++) {
      const nPages = 1 + Math.floor(rand() * 4);
      const len = nPages * PAGE_SIZE; // 실힙은 항상 PAGE_SIZE 배수
      const before = new Uint8Array(len);
      // 비자명 배경(전부 0이면 변이 감지가 쉬워 약한 시험이 된다): 성긴 랜덤 채움.
      for (let i = 0; i < len; i += 1 + Math.floor(rand() * 128)) before[i] = Math.floor(rand() * 256);
      const hb = hashesOf(before);
      const after = before.slice();
      const changes = 1 + Math.floor(rand() * (nPages * 3));
      for (let c = 0; c < changes; c++) {
        const idx = Math.floor(rand() * len);
        after[idx] = (after[idx] + 1 + Math.floor(rand() * 255)) & 0xff; // 반드시 다른 값(+1..+255 mod 256)
      }
      const detected = new Set(heapDelta.hashDiffPages(hb, hashesOf(after)));
      const truth = heapDelta.byteDiffPages(after, before, PAGE_SIZE); // ground truth(전 바이트)
      for (const p of truth) {
        if (!detected.has(p)) throw new Error(`시드 0x50554e44 it=${it}: 페이지 ${p} 변이 미감지(false negative)`);
      }
    }
  });

  // 성장(힙이 커진 뒤 복원)의 델타 완전성: to가 더 길면 성장분 페이지 전량이 델타에 포함돼야
  // 한다(reactive.js:101-108 성장 대칭의 전제). fromHashes 짧음 -> 성장 페이지 무조건 포함.
  check("해시 soundness: 힙 성장분 페이지 전량 포함", () => {
    const rand = mulberry32(0x67726f77); // "grow"
    for (let it = 0; it < 400; it++) {
      const fromPages = 1 + Math.floor(rand() * 3);
      const grew = 1 + Math.floor(rand() * 3);
      const before = new Uint8Array(fromPages * PAGE_SIZE);
      const after = new Uint8Array((fromPages + grew) * PAGE_SIZE);
      after.set(before); // 공통 구간 동일 -> 차이는 오직 성장분
      const detected = new Set(heapDelta.hashDiffPages(hashesOf(before), hashesOf(after)));
      for (let p = fromPages; p < fromPages + grew; p++) {
        if (!detected.has(p)) throw new Error(`it=${it}: 성장 페이지 ${p} 누락`);
      }
    }
  });

  // pack/unpack 왕복(델타 직렬화의 배치 규약): packPages로 묶은 bin을 unpackPages로 풀면
  // 정확히 그 페이지 바이트가 재현돼야 한다(저널 blob·세션 델타·이미지 오브젝트가 이 규약 위에 산다).
  check("해시 soundness: packPages/unpackPages 왕복 바이트 동일 (fuzz 400회)", () => {
    const rand = mulberry32(0x7061636b); // "pack"
    for (let it = 0; it < 400; it++) {
      const nPages = 2 + Math.floor(rand() * 4);
      const heap = new Uint8Array(nPages * PAGE_SIZE);
      for (let i = 0; i < heap.length; i += 1 + Math.floor(rand() * 200)) heap[i] = Math.floor(rand() * 256);
      const pages = [...new Set(Array.from({ length: 1 + Math.floor(rand() * nPages) }, () => Math.floor(rand() * nPages)))];
      const readPage = (p) => heap.subarray(p * PAGE_SIZE, (p + 1) * PAGE_SIZE);
      const bin = heapDelta.packPages(readPage, pages, PAGE_SIZE);
      const dst = new Uint8Array(heap.length); // 빈 목적지에 풀어 정확히 그 페이지만 채워지는지
      heapDelta.unpackPages((p, bytes) => dst.set(bytes, p * PAGE_SIZE), bin, pages, PAGE_SIZE);
      for (const p of pages) {
        const a = readPage(p), b = dst.subarray(p * PAGE_SIZE, (p + 1) * PAGE_SIZE);
        for (let i = 0; i < PAGE_SIZE; i++) if (a[i] !== b[i]) throw new Error(`it=${it}: page ${p} byte ${i} 왕복 불일치`);
      }
    }
  });

  // 4바이트 정렬 전제(RG3, 실측 발견): pageHashes는 Uint32 워드 전수라 힙 길이의 마지막
  // len%4 바이트를 해싱하지 않는다. 실WASM 힙은 항상 PAGE_SIZE(=65536, 4의 배수) 배수라
  // 꼬리 미해싱이 발생하지 않지만, 그 전제가 load-bearing임을 고정한다: 전제가 깨지면(비정렬
  // 힙) 마지막 바이트 변화가 델타에서 샌다. 이 경계를 명시로 문다(문서화된 한계).
  check("해시 soundness: PAGE_SIZE 4바이트 정렬 전제(load-bearing) 고정", () => {
    if (PAGE_SIZE % 4 !== 0) throw new Error(`PAGE_SIZE(${PAGE_SIZE})가 4의 배수가 아니다 - 페이지 경계가 워드를 쪼갠다(soundness 붕괴)`);
    // 대조: 비정렬 버퍼(len%4 != 0)면 마지막 워드 밖 꼬리 바이트 변화가 미감지됨을 실증한다.
    // 이것이 "왜 힙 길이가 PAGE_SIZE 배수여야 하는가"의 근거다(전제가 깨지면 이 미감지가 실힙에 새어든다).
    const a = new Uint8Array(PAGE_SIZE + 2); // len%4 = 2
    const b = a.slice(); b[b.length - 1] = 0xff; // 꼬리(워드 밖) 바이트 변경
    const ha = hashesOf(a), hb = hashesOf(b);
    let identical = ha.length === hb.length;
    for (let i = 0; i < ha.length && identical; i++) if (ha[i] !== hb[i]) identical = false;
    if (!identical) throw new Error("비정렬 힙 꼬리 바이트가 이제 해싱된다 - 전제 변경. 이 게이트와 pageHashes 주석을 갱신하라");
  });
}
