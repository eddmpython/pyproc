// contextSwapContract.mjs - Web Computer candidate 교체의 실패 지점별 rollback 기준 suite.
import { swapWebComputerContext } from "../../../apps/webComputer/webComputerContextSwap.js";

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

class FakeContext {
  constructor(name, { active = false, running = [], failPause = false, failResumeAll = false, failActivate = false, failDispose = false } = {}) {
    this.name = name;
    this.active = active;
    this.running = new Set(running);
    this.failPause = failPause;
    this.failResumeAll = failResumeAll;
    this.failActivate = failActivate;
    this.failDispose = failDispose;
    this.disposed = false;
    this.events = [];
  }

  runningMachineIds() {
    return [...this.running];
  }

  async pauseRunning() {
    this.events.push("pause");
    const ids = this.runningMachineIds();
    if (this.failPause) {
      this.running.delete(ids[0]);
      throw new Error("pause failed");
    }
    this.running.clear();
    return ids;
  }

  async resumeMachineIds(ids) {
    this.events.push("resume-current");
    for (const id of ids) this.running.add(id);
  }

  async resumeAll() {
    this.events.push("resume-candidate");
    this.running.add("pythonOs");
    if (this.failResumeAll) throw new Error("candidate resume failed");
    this.running.add("linuxOs");
  }

  activate() {
    this.events.push("activate");
    this.active = true;
    if (this.failActivate) throw new Error("candidate activate failed");
  }

  deactivate() {
    this.events.push("deactivate");
    this.active = false;
  }

  async dispose() {
    this.events.push("dispose");
    this.active = false;
    this.running.clear();
    this.disposed = true;
    if (this.failDispose) throw new Error("dispose failed");
  }
}

async function expectRollback(failurePoint) {
  const current = new FakeContext("current", { active: true, running: ["pythonOs", "linuxOs"], failPause: failurePoint === "pause" });
  let candidate = null;
  let pointer = current;
  let error = null;
  try {
    await swapWebComputerContext({
      current,
      createCandidate: () => {
        if (failurePoint === "create") throw new Error("candidate create failed");
        candidate = new FakeContext("candidate", {
          failResumeAll: failurePoint === "resume",
          failActivate: failurePoint === "activate",
        });
        return candidate;
      },
      stageCandidate: async () => {
        if (["device", "machine1", "machine2"].includes(failurePoint)) throw new Error(`${failurePoint} restore failed`);
      },
      commitCandidate: (value) => {
        if (failurePoint === "commit") throw new Error("pointer commit failed");
        pointer = value;
      },
    });
  } catch (caught) {
    error = caught;
  }
  assert(error, `${failurePoint}: 실패가 성공으로 처리됨`);
  assert(pointer === current, `${failurePoint}: active pointer 변경됨`);
  assert(current.active, `${failurePoint}: 기존 context 비활성 상태`);
  assert(current.running.has("pythonOs") && current.running.has("linuxOs"), `${failurePoint}: 기존 실행 상태 미복구`);
  if (candidate) {
    assert(candidate.disposed, `${failurePoint}: candidate 자원 미정리`);
    assert(!candidate.active && candidate.running.size === 0, `${failurePoint}: candidate가 활성 또는 실행 상태`);
  }
}

export async function runContextSwapContract() {
  for (const failurePoint of ["pause", "create", "device", "machine1", "machine2", "resume", "activate", "commit"]) {
    await expectRollback(failurePoint);
  }

  const current = new FakeContext("current", {
    active: true,
    running: ["pythonOs", "linuxOs"],
    failDispose: true,
  });
  const candidate = new FakeContext("candidate");
  let pointer = current;
  const swapped = await swapWebComputerContext({
    current,
    createCandidate: () => candidate,
    stageCandidate: async () => undefined,
    commitCandidate: (value) => { pointer = value; },
  });
  assert(swapped.context === candidate && pointer === candidate, "성공 candidate pointer 불일치");
  assert(candidate.active && candidate.running.size === 2, "성공 candidate가 active/running 아님");
  assert(!current.active && current.disposed, "성공 뒤 old context 정리 안 됨");
  assert(swapped.cleanupError?.message === "dispose failed", "old cleanup 실패가 별도 결과로 보존되지 않음");
}
