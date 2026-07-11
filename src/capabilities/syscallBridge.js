// syscallBridge.js - Layer 1 능력: 빌린 시스템콜 브리지 (계약 단계).
// 브라우저에는 socket/subprocess/blocking input이 없다. 이 능력이 그 부재를
// 각각 프록시·자식 워커·JSPI로 "빌려" 파이썬 코드가 그대로 돌게 한다.
//
// 현재 상태(정직): 계약만 노출하는 스텁이다. install()은 무엇이 배선될지의 선언을 반환할 뿐
// 아직 실제 몽키패치를 수행하지 않는다. 실제 배선은 tests/attempts에서 실측으로 졸업한 뒤
// 승격한다. 소비 제품(codaro 등)은 자신의 프록시/워커 엔드포인트를 cfg로 채운다.
export class SyscallBridge {
  constructor(rt, cfg) { this._rt = rt; this._cfg = cfg; }
  // subprocess -> 자식 워커, socket -> 프록시 fetch, input() -> JSPI 블로킹.
  async install() {
    return {
      installed: ["subprocess->childWorker", "socket->proxy", "input->JSPI"],
      proxyUrl: this._cfg.proxyUrl || null,
    };
  }
}
