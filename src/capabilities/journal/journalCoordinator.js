// journalCoordinator.js - Layer 2: Runtime과 저널 디렉터리 하나의 연산 순서와 캐시 수명.
//
// Reactive heap은 Runtime당 하나다. 같은 Runtime과 directory handle을 쓰는 여러 journal
// facade가 독립 lock과 주소 cache를 가지면 한쪽 pack이 지운 주소를 다른 쪽 commit이 다시
// 단언하거나, recover가 commit의 lazy page 복사 중 heap을 바꿀 수 있다. 이 coordinator가
// heap, ref, CAS를 만지는 연산을 한 줄로 세우고 주소 cache와 storage epoch를 함께 소유한다.

import { PyProcError } from "../../runtime/errors.js";

const RUNTIME_COORDINATORS = new WeakMap();

class JournalCoordinator {
  constructor(reactive) {
    this.reactive = reactive || null;
    this.addressCache = new Map();
    this.storageEpoch = 0;
    this._tail = Promise.resolve();
    this._pending = 0;
  }

  assertReactive(reactive) {
    if (!this.reactive) this.reactive = reactive || null;
    if (reactive && this.reactive !== reactive) {
      throw new PyProcError(
        "PYPROC_INPUT_INVALID",
        "journal: one Runtime and directory must share one ReactiveController",
      );
    }
  }

  get busy() { return this._pending > 0; }

  run(operation) {
    this._pending++;
    const result = this._tail.then(async () => {
      try { return await operation(); }
      finally { this._pending--; }
    });
    // 실패한 작업도 다음 작업의 줄을 끊지 않는다. 오류는 result를 받은 호출자에게만 전달한다.
    this._tail = result.then(() => undefined, () => undefined);
    return result;
  }

  async settle() { await this._tail; }

  invalidateAddresses() { this.addressCache.clear(); }

  resetStorage() {
    this.addressCache.clear();
    this.storageEpoch++;
    return this.storageEpoch;
  }
}

export function journalCoordinatorFor(rt, dir, reactive) {
  // cfg 검증은 MachineJournal.start가 소유한다. 불완전한 수동 구성은 공유할 key가 없으므로
  // 독립 coordinator를 받고, 실제 연산 전에 기존과 같은 입력 오류가 난다.
  if (!rt || !dir || (typeof dir !== "object" && typeof dir !== "function")) {
    return new JournalCoordinator(reactive);
  }
  let byDirectory = RUNTIME_COORDINATORS.get(rt);
  if (!byDirectory) {
    byDirectory = new WeakMap();
    RUNTIME_COORDINATORS.set(rt, byDirectory);
  }
  let coordinator = byDirectory.get(dir);
  if (!coordinator) {
    coordinator = new JournalCoordinator(reactive);
    byDirectory.set(dir, coordinator);
  } else {
    coordinator.assertReactive(reactive);
  }
  return coordinator;
}
