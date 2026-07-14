# 공개키 배포와 권한 UI 계약

`.pymachine`은 살아있는 컴퓨터 파일이다. 서명은 출처를 검증하고, 권한 UI는 실행 범위를 승인한다. 둘은 같은 것이 아니다. 제품은 이 둘을 한 화면에서 보여주되, 내부적으로는 분리된 계약으로 다룬다.

## 신뢰 체인

제품은 다음 원칙을 지킨다.

- 서명된 머신만 자동으로 연다. 기본 import 경로는 `openMachine(file, { trustedPublicKeys, requireSignature: true })`다.
- `{ trust: true }`는 개발자 도구나 로컬 디버그에 한정한다. 일반 사용자 파일 열기 UI에서는 쓰지 않는다.
- 공개키는 `exportMachinePublicKey()`로 JWK를 배포하고, 표시용 fingerprint는 `fingerprintMachinePublicKey()`의 `sha256:<hex>` 값을 쓴다.
- 사용자에게는 최소 16 hex 이상의 짧은 fingerprint를 표시하고, 상세 보기에는 전체 fingerprint와 JWK 출처를 둔다.
- 키 회전은 "현재 키 + 다음 키 + 이전 키" 목록으로 운영한다. 이전 키 제거는 해당 키로 서명된 `.pymachine` 파일의 import 정책 변경이다.
- signature는 sandbox 허가가 아니다. 신뢰된 키로 서명된 파일도 권한 UI를 통과해야 실행 범위가 열린다.

최소 흐름:

```js
import {
  openMachine,
  exportMachinePublicKey,
  fingerprintMachinePublicKey,
} from "pyproc";

const trustedPublicKey = await fetch("/pyproc-trusted-key.json").then((r) => r.json());
const fingerprint = await fingerprintMachinePublicKey(trustedPublicKey);
showTrustBanner({ fingerprint, source: "/pyproc-trusted-key.json" });

const session = await openMachine(file, {
  trustedPublicKeys: [trustedPublicKey],
  requireSignature: true,
});
```

## 권한 UI

권한 UI는 제품이 실행 전에 사용자에게 보여주는 능력 범위다. pyproc의 기본 권한 단위는 `MachineJail`의 `permissions{net, clipboard, home, workers}`다.

| 권한 | 사용자에게 보여줄 의미 | 기본 |
|---|---|---|
| `net` | 외부 네트워크 대상. `false`, `true`, 또는 host allowlist | `false` |
| `clipboard` | 시스템 클립보드 읽기/쓰기 | `false` |
| `home` | `/home/web` 영속 디스크 접근 | 제품 목적에 따라 명시 |
| `workers` | 추가 Worker/프로세스 생성 | `false` |

제품 UI는 다음을 표시한다.

- signer fingerprint
- `.pymachine` 파일 크기와 출처
- permission manifest
- `MachineJail.connectSrc()` 또는 해당 제품의 네트워크 allowlist
- `resume.py`가 다시 열 자원 목록(DB, relay, device handle 등)

`MachineJail.install(rt)`의 협조 티어는 실수 방지와 코드 레벨 명시성이다. 강한 네트워크 차단은 `MachineJail.csp()`를 적용한 감옥 컨텍스트에서 브라우저 CSP가 집행한다. same-origin 감옥은 `window.parent` 측면통로가 남고, opaque origin 감옥은 부모를 막는 대신 SAB 기반 프로세스 기능을 잃는다. 제품은 이 tradeoff를 UI/모드로 분리한다.

## 현재 고정 표면

| 표면 | 계약 |
|---|---|
| `fingerprintMachinePublicKey()` | CryptoKeyPair 또는 JWK에서 같은 `sha256:<hex>` fingerprint를 만든다 |
| `machineImageProbe.html` | WebCrypto signature, trusted public key import, 다른 공개키 거부, fingerprint 안정성을 브라우저에서 검증한다 |
| `examples/machine.html` | signer fingerprint와 `home=yes, net=no, clipboard=no, workers=no` 권한 정책을 데모 UI에 표시하고, signed `.pymachine`만 연다 |
| `MachineJail` | 협조 초크포인트와 CSP `connect-src` 문자열을 제공한다 |

## 제품별 적용

| 제품 | 공개키 배포 | 권한 UI |
|---|---|---|
| codaro | editor build와 함께 trusted key JWK 또는 keyset manifest를 배포하고, build hash와 fingerprint를 quality report에 남긴다 | 프로젝트별 `/home/web/codaro`, ASGI endpoint, 네트워크 allowlist, worker 사용 여부를 실행 전 표시 |
| dartlab | notebook runtime 배포와 keyset을 묶고, shared notebook import 시 fingerprint를 표시한다 | `/pyapi`, 파일/DB connection, package cache, 외부 fetch/relay를 notebook 권한으로 분리 |
| xlpod | workbook별 UDF runtime keyset을 배포한다 | workbook 파일 접근, formula callback bridge, 취소 SAB, 외부 네트워크를 명시 |
| 외부 제품 | 제품 release asset 또는 서버 endpoint로 JWK를 배포한다 | `MachineJail` manifest와 제품 고유 권한을 같은 승인 화면에 둔다 |

## 금지

- 서명 없거나 알 수 없는 키의 `.pymachine`을 자동으로 열지 않는다.
- signature 통과를 권한 승인으로 해석하지 않는다.
- `trust: true`를 일반 사용자 import UI의 기본값으로 쓰지 않는다.
- 권한 화면에 "safe" 같은 추상 문구만 두지 않는다. host, disk, clipboard, worker, resume 대상 자원을 구체적으로 보여준다.
