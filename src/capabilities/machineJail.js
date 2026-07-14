// machineJail.js - Layer 1 능력: 권한 감옥(P6). trust:true 이진 게이트가 스코프 승인으로 진화한다.
// 제품 권한 manifest의 permissions{net, clipboard, home, workers}를 두 단으로 집행한다:
//   1. 협조 티어(이 파일의 파이썬 초크포인트): pyprocJail.net(host) 등이 권한을 검사한다.
//      정직: 파이썬 레벨 검사는 `import js`로 우회 가능하다. 그래서 2단이 최종 방어다.
//   2. 브라우저 티어(감옥 컨텍스트의 CSP connect-src): 감옥 머신을 CSP가 걸린 컨텍스트(iframe)에서
//      부팅하면, 파이썬이 `import js; js.fetch(...)`로 우회를 시도해도 그 fetch는 감옥 iframe의
//      CSP를 따르므로 비허용 host면 **브라우저가 차단**한다(우리 코드가 아니라 브라우저의 벽).
// 이 능력은 (1) 협조 초크포인트를 심고 (2) 감옥 컨텍스트용 CSP 문자열을 만든다. 소비 제품이
// 그 CSP를 iframe(<meta> 또는 헤더)에 실어 머신을 부팅한다. 실측: pythonMachine/jailProbe.
//
// 정직한 경계(브라우저 티어의 사각): CSP connect-src는 감옥 컨텍스트 "자신의" 네트워크를 막는다.
// 감옥이 `window.parent`에 닿을 수 있으면(부모와 same-origin) 부모에게 fetch를 시킬 수 있다.
// 그 측면 통로를 닫으려면 감옥을 opaque origin(sandbox 속성, allow-same-origin 없이)으로 둔다.
// 단 opaque origin은 crossOriginIsolated가 아니라 SAB를 잃는다(감옥 머신 = 단일 Runtime, fork 없음).
// 즉 "네트워크 egress 차단"은 same-origin 감옥에서도 성립하고, "부모 격리"까지는 opaque 감옥이다.
const BOOTSTRAP = `
import sys as _pyprocSys, types as _pyprocTypes

_pyprocJailMod = _pyprocTypes.ModuleType('pyprocJail')

def _pyprocJailCheck(perm, arg=''):
    if not _pyprocJailAllows(perm, arg):
        raise PermissionError('jail: ' + perm + ' 권한 없음' + ((' (' + arg + ')') if arg else ''))
    return True

_pyprocJailMod.net = lambda host='': _pyprocJailCheck('net', host)
_pyprocJailMod.clipboard = lambda: _pyprocJailCheck('clipboard')
_pyprocJailMod.home = lambda: _pyprocJailCheck('home')
_pyprocJailMod.workers = lambda: _pyprocJailCheck('workers')
_pyprocSys.modules['pyprocJail'] = _pyprocJailMod
`;

export class MachineJail {
  // permissions: { net: false | true | ["host", ...], clipboard, home, workers: bool }.
  // net=false 전부 차단, true 전부 허용, 배열 허용 목록.
  constructor(permissions = {}) {
    this.net = permissions.net ?? false;
    this.clipboard = !!permissions.clipboard;
    this.home = !!permissions.home;
    this.workers = !!permissions.workers;
  }

  // 협조 티어 판정(우회 가능, 브라우저 티어가 최종 방어). perm: net|clipboard|home|workers.
  allows(perm, arg = "") {
    if (perm === "net") return this.net === true || (Array.isArray(this.net) && this.net.includes(arg));
    return !!this[perm];
  }

  // 브라우저 티어: 감옥 컨텍스트의 CSP connect-src 값. 엔진 자산은 'self'(자가 호스팅)라
  // 항상 허용해야 부팅한다. net 허용 목록만 여기에 더해진다(그 외 host는 브라우저가 차단).
  connectSrc() {
    if (this.net === true) return "*";
    const hosts = Array.isArray(this.net) ? this.net : [];
    return ["'self'", ...hosts].join(" ");
  }

  // 감옥 iframe용 CSP 전체. 엔진(module import + wasm)은 'self'에서 로드되고, connect-src만 좁힌다.
  // wasm-unsafe-eval = WASM 인스턴스화(CSP3), unsafe-eval/inline = pyodide 런타임 요건.
  csp() {
    return [
      "default-src 'self' blob: data:",
      "script-src 'self' 'wasm-unsafe-eval' 'unsafe-eval' 'unsafe-inline' blob:",
      "connect-src " + this.connectSrc(),
    ].join("; ");
  }

  // 협조 초크포인트를 파이썬에 심는다. 감옥 머신 코드가 pyprocJail.net(host) 등으로 권한을
  // 확인한다(정직: import js 우회는 CSP가 잡는다. 이 티어는 실수 방지 + 명시 계약).
  install(rt) {
    rt.setGlobal("_pyprocJailAllows", (perm, arg) => this.allows(perm, arg || ""));
    rt.run(BOOTSTRAP);
    return { permissions: { net: this.net, clipboard: this.clipboard, home: this.home, workers: this.workers }, connectSrc: this.connectSrc() };
  }
}
