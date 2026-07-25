# 모듈 경계 운영

pyproc의 모듈화 기준은 파일 수가 아니라 변경 이유와 의존 방향이다. 공개 표면을 늘리지 않고
구현, 조립, 정책, 검증의 소유권을 분리한다.

## Runtime 조립

- `src/runtime/`은 엔진과 최소 Runtime 계약만 소유한다.
- `src/capabilities/`은 선택 기능을 소유하며 composition을 import하지 않는다.
- `src/composition/runtimeBindings/`의 cluster가 capability 생성 규칙을 소유한다.
- `src/composition/runtimeBindings.js`는 cluster 병합, 중복 차단, prototype 설치만 담당한다.
- 새 capability를 추가할 때 중앙 installer에 class import를 추가하지 않는다.

현재 cluster는 다음과 같다.

| cluster | 책임 |
|---|---|
| `state` | reactive checkpoint와 durable journal |
| `service` | syscall, ASGI, virtual origin, terminal |
| `environment` | wheel cache, device filesystem, init |

## 정책과 메커니즘

상태를 직접 변경하는 메커니즘과 입력 검증·초과 판정 같은 순수 정책을 분리한다.
리액티브 retention의 정규화와 budget 초과 판정은
`src/capabilities/reactive/retentionPolicy.js`가 소유하고, `ReactiveController`는 관측,
prune 실행, pressure event 전달만 담당한다.

## 계약 검증

- `tests/contracts/`의 suite는 `assert*` 함수를 정확히 하나 export한다.
- `tests/contracts/run.mjs`가 suite를 자동 발견한다.
- 공용 fixture와 helper는 runner의 helper allowlist에 두며 suite로 위장하지 않는다.
- 동기 검사는 Promise를 받을 수 없다. 비동기 계약은 `checkAsync`를 사용한다.
- `tests/browser/gate.html`은 문서 shell이고 실행 코드는 `tests/browser/gate.js`가 소유한다.

## 공개 표면

내부 모듈 분리는 package export 추가의 근거가 아니다. 새 subpath나 root value는
[Experimental 동결 정책](experimentalFreeze.md)의 해제 조건을 먼저 충족해야 한다.
타입은 각 공개 subpath의 형제 `.d.ts`가 소유하며 root 선언에 ambient module을 쌓지 않는다.

## 실행 자산

Buildroot guest는 `scripts/buildroot/`의 공식 release archive SHA-256, 대응 revision, config,
legal-info, SBOM 계약으로 재현한다.
`.github/workflows/buildroot-guest.yml`은 Linux 빌드와 artifact 보존을 담당한다. 생성 artifact를
development catalog에 승격하는 행위는 해시와 provenance 대조 후 별도 리뷰로 수행한다.
