// reactiveTree.mjs - [reactive 나무] 절의 본문.
//
// run.mjs에서 나온 이유는 크기가 아니라 책임이다: 이 절은 property/fuzz 판정이고, run.mjs는
// 절을 엮어 돌리는 러너다. 판정 이름과 개수는 그대로다(게이트 층 하한이 그것을 센다).
// check는 러너가 주입한다: 통과/실패의 보고 방식은 러너가 소유한다.
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { mulberry32 } from "./seededRandom.mjs";

const ROOT = join(import.meta.dirname, "..", "..");

export async function assertReactiveTree(check) {
  const { MemoryCapability, PAGE_SIZE: RPAGE } = await import(pathToFileURL(join(ROOT, "src", "runtime", "memoryCapability.js")).href);
  const { ReactiveController } = await import(pathToFileURL(join(ROOT, "src", "capabilities", "reactive.js")).href);
  const equalBytes = (a, b) => {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
    return true;
  };

  check("reactive 나무: 임의 트리 참조 무결성 (property, restore/restoreLive 독립 오라클)", () => {
    const rand = mulberry32(0x74726565); // "tree"
    for (let trial = 0; trial < 24; trial++) {
      const nPages = 2 + Math.floor(rand() * 4);
      let heap = new Uint8Array(nPages * RPAGE);
      for (let i = 0; i < heap.length; i += 1 + Math.floor(rand() * 300)) heap[i] = Math.floor(rand() * 256);
      let sp = 4096, execSeq = 0;
      const engine = { heapU8: () => heap, stackSave: () => sp, stackRestore: (v) => { sp = v; } };
      const rt = { memory: new MemoryCapability(engine), get execSeq() { return execSeq; }, noteStateMutation() { execSeq++; } };
      const ctrl = new ReactiveController(rt);
      const model = []; // model[node] = 그 노드 체크포인트 시점의 전 힙 바이트(독립 진실)

      ctrl.checkpoint();          // node 0 = base
      model.push(heap.slice());
      // 힙과 컨트롤러 포인터를 노드 P로 강제 이동(restore 정확성에 의존하지 않음).
      const gotoNode = (P) => {
        heap.set(model[P]);
        ctrl.prevHashes = ctrl.hashesAt(P); ctrl.liveIdx = P; ctrl._seqAt = execSeq;
      };
      const nNodes = 6 + Math.floor(rand() * 8);
      for (let n = 1; n < nNodes; n++) {
        const parent = Math.floor(rand() * model.length); // 임의 기존 노드에서 분기
        gotoNode(parent);
        const changes = 1 + Math.floor(rand() * nPages);
        for (let c = 0; c < changes; c++) {
          const p = Math.floor(rand() * nPages), off = Math.floor(rand() * RPAGE);
          heap[p * RPAGE + off] = (heap[p * RPAGE + off] + 1 + Math.floor(rand() * 255)) & 0xff;
        }
        const snap = heap.slice();
        ctrl.checkpoint(); // parent = liveIdx = parent, delta = diff(hashes[parent], 현재)
        if (ctrl.parents[n] !== parent) throw new Error(`trial ${trial} node ${n}: parent 기록 오류 ${ctrl.parents[n]}!=${parent}`);
        model.push(snap);
      }

      // 오라클 A: 전체 복원(restore, 경로 델타 누적 경로)이 모든 노드에서 모델과 바이트 동일.
      const order = model.map((_, i) => i).sort(() => rand() - 0.5);
      for (const j of order) {
        ctrl.restore(j);
        if (!equalBytes(heap, model[j])) throw new Error(`trial ${trial}: restore(${j}) != model (형제 델타 오염 의심)`);
      }
      // 오라클 B: 라이브-차분 복원(restoreLive, _targetBytes 부모 체인 경로)이 임의 전이에서 동일.
      for (let t = 0; t < model.length * 2; t++) {
        const from = Math.floor(rand() * model.length), to = Math.floor(rand() * model.length);
        gotoNode(from); // 경계 닫힌 상태로 from에 위치
        ctrl.restoreLive(to);
        if (!equalBytes(heap, model[to])) throw new Error(`trial ${trial}: restoreLive(${from}->${to}) != model`);
      }
    }
  });

  // 노드별 해시의 저장 표현이 희소(변경 페이지의 [page,a,b] 3워드)로 내려간 뒤, 전량이 필요한
  // 소비자는 hashesAt으로 되접는다. 되접기가 틀리면 라이브-차분 복원이 "안 바뀐 페이지"를
  // 잘못 판정해 조용히 오염된다. 독립 오라클(그 노드 힙을 직접 해시)과 대조한다.
  check("reactive 나무: hashesAt 되접기 = 그 노드 힙의 전량 해시 (property)", () => {
    const rand = mulberry32(0x686f6c64); // "hold"
    for (let trial = 0; trial < 20; trial++) {
      const nPages = 2 + Math.floor(rand() * 4);
      const heap = new Uint8Array(nPages * RPAGE);
      let sp = 512, execSeq = 0;
      const engine = { heapU8: () => heap, stackSave: () => sp, stackRestore: (v) => { sp = v; } };
      const rt = { memory: new MemoryCapability(engine), get execSeq() { return execSeq; }, noteStateMutation() { execSeq++; } };
      const ctrl = new ReactiveController(rt);
      const model = [];
      ctrl.checkpoint(); model.push(heap.slice());
      const gotoNode = (P) => { heap.set(model[P]); ctrl.prevHashes = ctrl.hashesAt(P); ctrl.liveIdx = P; ctrl._seqAt = execSeq; };
      for (let n = 1; n < 8 + Math.floor(rand() * 6); n++) {
        gotoNode(Math.floor(rand() * model.length)); // 임의 기존 노드에서 분기
        for (let c = 0, k = 1 + Math.floor(rand() * nPages); c < k; c++) {
          const at = Math.floor(rand() * nPages) * RPAGE + Math.floor(rand() * RPAGE);
          heap[at] = (heap[at] + 1 + Math.floor(rand() * 255)) & 0xff;
        }
        model.push(heap.slice());
        ctrl.checkpoint();
      }
      // 오라클: 그 노드의 힙 바이트를 직접 해시한 전량 배열.
      for (let j = 0; j < model.length; j++) {
        const truth = new MemoryCapability({ heapU8: () => model[j] }).pageHashes();
        gotoNode(0); // 라이브 지름길을 피해 되접기 경로를 강제한다
        const folded = ctrl.hashesAt(j);
        if (folded.length !== truth.length) throw new Error(`trial ${trial} node ${j}: 길이 ${folded.length}!=${truth.length}`);
        for (let i = 0; i < truth.length; i++) {
          if (folded[i] !== truth[i]) throw new Error(`trial ${trial} node ${j}: 워드 ${i} 되접기 불일치(가까운 조상 우선 규칙 위반 의심)`);
        }
      }
    }
  });

  // 저장 비용이 힙 크기가 아니라 변경분에 비례한다. 이것이 희소화의 목적이고, 전량 배열로
  // 되돌리면 노드마다 힙 전량의 해시가 다시 상주한다(512MB 힙이면 노드당 64KB).
  check("reactive 나무: 노드 해시가 변경 페이지에 비례한다(희소 저장)", () => {
    const nPages = 64;
    const heap = new Uint8Array(nPages * RPAGE);
    let sp = 0, execSeq = 0;
    const engine = { heapU8: () => heap, stackSave: () => sp, stackRestore: (v) => { sp = v; } };
    const rt = { memory: new MemoryCapability(engine), get execSeq() { return execSeq; }, noteStateMutation() { execSeq++; } };
    const ctrl = new ReactiveController(rt);
    ctrl.checkpoint();
    const full = ctrl.hashes[0].byteLength; // 경계는 전량이다(h0의 입력이므로 희소화 대상 아님)
    for (let n = 1; n <= 12; n++) {
      heap[(n % nPages) * RPAGE] ^= 0xff; // 매번 페이지 하나만 더럽힌다
      ctrl.checkpoint();
      const overlay = ctrl.hashes[n];
      if (overlay.byteLength !== 12) throw new Error(`노드 ${n}: 겹침 ${overlay.byteLength}B (변경 1페이지면 [page,a,b] 3워드 = 12B여야 한다)`);
    }
    // 노드 12개의 합은 12 * 12B다. 전량 저장이면 12 * (경계 크기)였다.
    const nodeBytes = ctrl.stats().hashBytes - full - ctrl.prevHashes.byteLength;
    if (nodeBytes !== 12 * 12) throw new Error(`노드 12개의 해시 합 ${nodeBytes}B (변경 1페이지씩이면 144B여야 한다)`);
    if (nodeBytes >= 12 * full) throw new Error(`노드 합 ${nodeBytes}B가 전량 저장(${12 * full}B) 이상 - 희소 저장이 아니다`);
  });

  check("reactive 나무: pruneTo 생존자 정확 + 해제 노드 거부 + off-path 거부", () => {
    const rand = mulberry32(0x7072756e); // "prun"
    for (let trial = 0; trial < 20; trial++) {
      const nPages = 2 + Math.floor(rand() * 3);
      let heap = new Uint8Array(nPages * RPAGE);
      let sp = 2048, execSeq = 0;
      const engine = { heapU8: () => heap, stackSave: () => sp, stackRestore: (v) => { sp = v; } };
      const rt = { memory: new MemoryCapability(engine), get execSeq() { return execSeq; }, noteStateMutation() { execSeq++; } };
      const ctrl = new ReactiveController(rt);
      const model = [];
      ctrl.checkpoint(); model.push(heap.slice());
      const gotoNode = (P) => { heap.set(model[P]); ctrl.prevHashes = ctrl.hashesAt(P); ctrl.liveIdx = P; ctrl._seqAt = execSeq; };
      const nNodes = 6 + Math.floor(rand() * 6);
      for (let n = 1; n < nNodes; n++) {
        const parent = Math.floor(rand() * model.length);
        gotoNode(parent);
        const p = Math.floor(rand() * nPages);
        heap[p * RPAGE + Math.floor(rand() * RPAGE)] ^= 0xff;
        model.push(heap.slice());
        ctrl.checkpoint();
      }
      // 임의 목표 j로 prune. 먼저 j로 복원(liveIdx가 keep 경로 위에 있어야 함).
      const j = 1 + Math.floor(rand() * (model.length - 1));
      const keep = new Set([0]);
      for (let k = j; k >= 1; k = ctrl.parents[k]) keep.add(k);
      ctrl.restore(j);
      const info = ctrl.pruneTo(j);
      if (info.keptNodes !== keep.size) throw new Error(`trial ${trial}: keptNodes ${info.keptNodes}!=${keep.size}`);
      // 생존 노드: 여전히 모델과 바이트 동일하게 복원.
      for (const m of keep) {
        ctrl.restore(m);
        if (!equalBytes(heap, model[m])) throw new Error(`trial ${trial}: prune 후 생존 노드 ${m} 복원 오류`);
      }
      // 해제 노드: 복원이 PYPROC_CHECKPOINT_PRUNED로 거부.
      for (let k = 1; k < model.length; k++) {
        if (keep.has(k)) continue;
        let code = "";
        try { ctrl.restore(k); } catch (e) { code = e.code; }
        if (code !== "PYPROC_CHECKPOINT_PRUNED") throw new Error(`trial ${trial}: 해제 노드 ${k} 거부 코드 ${code}`);
      }
    }
    // off-path liveIdx로 pruneTo는 PYPROC_INPUT_INVALID(조용한 오염 대신 명시 거부).
    let heap = new Uint8Array(3 * RPAGE);
    let sp = 0, execSeq = 0;
    const engine = { heapU8: () => heap, stackSave: () => sp, stackRestore: (v) => { sp = v; } };
    const rt = { memory: new MemoryCapability(engine), get execSeq() { return execSeq; }, noteStateMutation() { execSeq++; } };
    const ctrl = new ReactiveController(rt);
    ctrl.checkpoint();                        // 0
    heap[0] = 1; ctrl.checkpoint();           // 1 (parent 0)
    ctrl.restore(0); heap[RPAGE] = 2; ctrl.checkpoint(); // 2 (parent 0, 1의 형제)
    // liveIdx=2인데 pruneTo(1): 2는 루트->1 경로 밖 -> 거부.
    let offCode = "";
    try { ctrl.pruneTo(1); } catch (e) { offCode = e.code; }
    if (offCode !== "PYPROC_INPUT_INVALID") throw new Error(`off-path pruneTo 거부 코드 ${offCode}`);
  });
}
