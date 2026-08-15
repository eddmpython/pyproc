# actionConvergence - 바뀐 화면에서 잘못된 effect 없이 제한 안에 수렴하는가

## 가설

원래 Situation과 capability가 있는 행동은 대상이 바뀌어도 후보를 최대 2개까지만 확인하고 한 번만
재관찰하면 된다. 첫 effect 전 30초를 넘기지 않고, 유일한 동일 권한 대상에만 한 번 전송하며,
모호하거나 계속 가린 상태에서는 effect를 0번 전송한 채 같은 형식의 거절 영수증을 낼 수 있다.

## 졸업 게이트

설치 tarball의 공개 Control 경로와 Edge headless에서 아래 다섯 시나리오를 연속 실행한다.
viewport는 제품 기본 viewport이며 각 시나리오의 arm 직후와 terminal 상태를 PNG artifact로 확인한다.

1. 같은 문서 stale target은 한 번 재관찰해 유일한 대상에 effect를 정확히 1번 보낸다.
2. 두 개로 늘어난 ambiguous target은 effect를 0번 보낸다.
3. 잠시 가린 target은 가림이 사라진 뒤 effect를 정확히 1번 보낸다.
4. 계속 가린 target은 actionability 제한 안에 effect를 0번 보낸다.
5. navigation replacement는 새 문서의 유일한 대상에 effect를 정확히 1번 보낸다.
6. 성공과 거절 모두 `pyproc.actionConvergence` version 1 영수증으로 후보 최대 2개, 재관찰 최대 1회,
   effect retry 0회, 첫 effect 전 최대 30000 ms와 실제 duration을 보고한다.

실행:

```text
node tests/attempts/actionConvergence/actionConvergenceProbe.mjs
```

`PYPROC_KEEP_ATTEMPT_EVIDENCE=1`이면 눈검수 PNG를 출력 경로에 유지한다.

## 결론 표

| 날짜 | probe | 환경 | 핵심 수치 | 결론 | 다음 |
|---|---|---|---|---|---|
| 2026-08-15 | actionConvergenceProbe | Edge headless, 설치 tarball, 공개 Control, PNG 756x488 | effect 횟수 stale 0, ambiguous 0, transient occlusion 1, persistent occlusion 0, navigation 1 | RED. 첫 불일치는 같은 문서에서 분리된 target을 5.09초 동안 60회 확인한 뒤 actionability timeout으로 끝내고 재관찰하지 않은 것이다. ambiguous도 안전하게 0회였지만 모호함을 판정하지 못했다. transient occlusion과 navigation은 각각 정확히 1회 성공했고 persistent occlusion은 0회였다. 다섯 경우 모두 공통 version 영수증이 없었다 | provider-neutral 제한 원장과 send 직전 actionability를 승격한다 |
| 2026-08-15 | actionConvergenceProbe | Edge headless, 설치 tarball, 공개 Control, PNG 756x488 | first-effect ms: stale 259, ambiguous 172, transient occlusion 1288, persistent occlusion 711, navigation 201. effect 횟수 1, 0, 1, 0, 1 | GREEN. 다섯 경우가 모두 version 1 영수증, 후보 최대 2개, 재관찰 최대 1회, effect retry 0회, 30000 ms 상한을 지켰다. terminal PNG에서 stale, transient, navigation은 `done`, ambiguous와 persistent는 `armed`로 남았다 | `tests/browser/actionConvergenceProduct.mjs`와 FrameSpace 제품 gate로 승격 완료 |

상한을 2에서 3으로 바꾼 음성 변형은 정식 계약 gate에서 `3 !== 2`로 RED였고, 원복 뒤 GREEN이었다.

## 승격 설계

수렴 제한과 영수증은 `scripts/perception/`의 provider-neutral 계약으로 둔다. CDP provider와
FrameSpace provider는 실행 직전 actionability 및 authority 확인 결과만 공급한다. 공개 JS, Python,
MCP 표면은 같은 영수증을 그대로 전달하고 provider 전용 분기나 자동 effect retry를 추가하지 않는다.

## 판정

졸업 -> `scripts/perception/actionConvergence.js`, `tests/browser/actionConvergenceProduct.mjs`
