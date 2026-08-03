// 전역 패치 창의 중첩 계약을 판정한다.
//
// 창을 연 쪽이 fn(reenter)의 reenter를 내부 패처에 넘기면 그 패처는 바깥 창 위에 얹힌다.
// 넘기지 않으면 공용 체인 뒤에 줄을 서고, 그 줄은 바깥 창이 끝나야 움직인다. 바깥이 그것을
// await하면 자기 창을 기다리는 데드락이다(globalPatch.js 중첩 계약).
//
// 이 suite가 있는 이유는 실제 결함이다: WheelCache 생성자가 주입받은 patchScope를 대입하지
// 않아 bootSession({ wheelDir, packages })가 영영 돌아오지 않았다. 브라우저 게이트에 그 조합이
// 없어서 아무도 못 봤다. WASM 없이 fake rt와 fake dir로 실제 함수를 구동한다.
import { WheelCache } from "../../src/capabilities/wheelCache.js";
import { runWithGlobalPatch } from "../../src/runtime/globalPatch.js";

// 데드락은 실패가 아니라 정지로 나타난다. 유한 예산을 두고 초과를 실패로 판정해야 게이트가
// RED를 낼 수 있다. 값은 넉넉하게 잡는다: 배선이 맞으면 마이크로태스크 몇 번이면 끝난다.
const SCOPED_BUDGET_MS = 2000;

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

function fakeRuntime() {
  const calls = [];
  return { calls, loadPackages: async (packages) => { calls.push(packages); }, install: async () => {} };
}

// fetch 핸들러 안에서만 쓰이므로 실제 파일 시스템 동사는 필요 없다. 생성자 검증만 통과하면 된다.
const fakeDir = Object.freeze({ getFileHandle: async () => { throw new Error("not found"); } });

async function withBudget(promise, label) {
  let timer = null;
  const budget = new Promise((resolve) => { timer = setTimeout(() => resolve("budget"), SCOPED_BUDGET_MS); });
  const outcome = await Promise.race([promise.then(() => "done"), budget]);
  clearTimeout(timer);
  if (outcome !== "done") throw new Error(`${label}: ${SCOPED_BUDGET_MS}ms 안에 끝나지 않았다(중첩 창 데드락)`);
}

export async function assertNestedPatchScopeContract() {
  // 1) cfg 검증은 생성자가 한다. 옵션을 읽는 곳과 검증하는 곳이 같은 자리여야 한다.
  let missingDir = null;
  try { new WheelCache(fakeRuntime(), {}); } catch (error) { missingDir = error?.code; }
  if (missingDir !== "PYPROC_INPUT_INVALID") throw new Error(`dir 없는 cfg를 생성자가 거부하지 않았다: ${missingDir}`);

  const rt = fakeRuntime();
  let queued = null;
  let queuedSettled = false;

  // 2) 열린 창 안에서 patchScope를 받은 캐시는 그 창 안에서 완료된다.
  await runWithGlobalPatch(async (reenter) => {
    const scoped = new WheelCache(rt, { dir: fakeDir, patchScope: reenter });
    await withBudget(scoped.loadPackages(["scoped"]), "patchScope를 받은 WheelCache");

    // 3) 같은 창 안에서 patchScope 없이 만든 캐시는 공용 체인 뒤에 줄을 선다. 창이 열려 있는
    //    동안에는 끝날 수 없다. 이 단정이 fixture가 직렬화를 실제로 재현한다는 증거다.
    queued = new WheelCache(rt, { dir: fakeDir }).loadPackages(["queued"]);
    queued.then(() => { queuedSettled = true; }, () => { queuedSettled = true; });
    await tick();
    await tick();
    if (queuedSettled) throw new Error("patchScope 없는 호출이 열린 창 안에서 완료됐다(직렬화가 재현되지 않는다)");
  });

  // 4) 창이 닫히면 줄 서 있던 호출이 진행된다. 체인을 오염된 채로 두지 않는다.
  await withBudget(queued, "창이 닫힌 뒤의 대기 호출");
  if (rt.calls.length !== 2) throw new Error(`fake runtime 호출 수 불일치: ${rt.calls.length}`);
  return true;
}
