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
        ctrl.liveIdx = P; ctrl.prevHashes = ctrl.hashes[P]; ctrl._seqAt = execSeq;
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
      const gotoNode = (P) => { heap.set(model[P]); ctrl.liveIdx = P; ctrl.prevHashes = ctrl.hashes[P]; ctrl._seqAt = execSeq; };
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
