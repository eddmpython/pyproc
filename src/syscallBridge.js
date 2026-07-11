// syscallBridge.js - Layer 1 능력: 빌린 시스템콜 브리지 (계약).
// 브라우저에는 socket/subprocess/blocking input이 없다. 이 능력이 그 부재를
// 각각 프록시·자식 워커·JSPI로 "빌려" 파이썬 코드가 그대로 돌게 한다.
// 여기서는 계약(install 시 무엇을 배선하는지)만 노출한다. 실제 몽키패치 로직은
// 소비 제품(codaro 등)이 자신의 프록시/워커 엔드포인트로 채운다.
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
