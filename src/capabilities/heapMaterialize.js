// heapMaterialize.js - Layer 2: "저장된 세대를 힙에 물질화한다"는 법의 단일 보관소.
//
// 왜 한 곳인가: 이 순서 자체가 부활의 정확성이다. 성장 -> 경계 되감기 -> 페이지 쓰기 ->
// 스택 복원 -> 홈 적용 -> 새 경계. 예전에는 같은 순서가 네 곳에 각자 구현돼 있었고
// (session.load / openMachine / journal.recover 구포맷 / journal.recover 커널) MB 계산까지
// 복제돼 있었다. 네 사본이 독립적으로 표류할 수 있는 자리가 정확성 임계 경로였다.
//
// 경계 되감기를 무조건 하는 이유: 부팅 이후의 모든 드리프트(재시드, 성장 루프, 소비자 실행
// 흔적)를 cp0으로 지운 위에 델타를 덮어야 결과가 정확히 저장 시점 상태가 된다. 델타만 덮으면
// 델타 밖의 드리프트가 남아 "저장 상태 + 지금 흔적" 혼합이 조용히 생긴다(fork 정화와 같은 원리).
//
// 성장을 파이썬 할당으로 태우는 이유: JS에서 wasm Memory.grow를 직접 호출하면 Emscripten
// 글루의 클로저 뷰가 갱신되지 않아 런타임이 파손된다(sessionGrowProbe 실측). 초과 성장은
// 무해하다: 델타가 복원하는 저장 시점 할당자 상태가 힙 끝을 정하고 잉여 페이지는 미사용이다.
import { PAGE_SIZE, bytesToMb } from "../runtime/memoryLayout.js";
import { growHeapTo } from "../runtime/heapGrow.js";
import { applyMachineHome, validateMachineHomeMeta } from "./machineHome.js";

// 세대 하나를 힙에 물질화한다.
//   rt        : Runtime(memory/fs/run을 계약으로 제공)
//   reactive  : ReactiveController(경계 되감기와 새 경계)
//   label     : 성장 실패 메시지에 실릴 호출 맥락(예: "journal.recover")
//   heapLen   : 저장 시점 힙 길이
//   sp        : 저장 시점 스택 포인터(null이면 계약이 흡수)
//   pages     : [pageIndex, bytes] 순회 가능(Map 또는 배열). 전량 준비된 뒤 들어와야 한다
//               (부분 적용 상태 방지는 호출자의 검증 단계에서 끝낸다)
//   home      : { meta, bytes } 또는 null
//   wrapHomeError : home 메타 파손을 이 층의 오류 코드로 감싸는 함수(층마다 어휘가 다르다)
export function materializeHeapGeneration({ rt, reactive, label, heapLen, sp, pages, home = null, wrapHomeError = null }) {
  const mem = rt.memory;
  growHeapTo((code) => rt.run(code), () => mem.byteLength(), heapLen, label);
  reactive.restore(0, sp);
  let pageCount = 0;
  let writtenBytes = 0;
  for (const [index, bytes] of pages) {
    mem.writePage(index, bytes);
    pageCount++;
    writtenBytes += bytes.length;
  }
  mem.stackRestore(sp);
  let appliedHome = null;
  if (home) {
    try { validateMachineHomeMeta(home.meta, home.bytes.length); }
    catch (error) { throw wrapHomeError ? wrapHomeError(error) : error; }
    appliedHome = applyMachineHome(rt.fs, home.meta, home.bytes);
  }
  reactive.checkpoint(); // 부활 상태를 새 경계로
  return { pages: pageCount, mb: bytesToMb(writtenBytes || pageCount * PAGE_SIZE), home: appliedHome };
}
