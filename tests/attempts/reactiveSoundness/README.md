# reactiveSoundness - 페이지 해시를 64비트급으로 올려도 체크포인트가 여전히 싼가

## 가설

32비트 FNV-1a 단일 해시는 페이지 충돌 시 변경을 조용히 놓친다(복원 오염). 서로 다른 32비트 해시 2개(실효 64비트)를 같은 루프에서 계산하면 soundness를 확률적으로 2^-64 수준까지 올리면서 비용은 2배 미만일 것이다(메모리 대역폭이 지배하므로).

## 졸업 게이트

1. 실측: 부팅 직후 실제 힙 전체에 대해 단일 vs 이중 해시 시간 비교. **이중이 단일의 2.2배 이하**이고 절대치가 실행 경계 비용으로 수용 가능(수십 ms대)이면 통과.
2. 승격 형태: `MemoryCapability.pageHashes()`가 페이지당 2워드(interleaved)를 반환, `ReactiveController`가 두 워드 모두 비교. 승격 후 브라우저 게이트(restoreLive/restore 정확성) GREEN.

## 결론 표

| 날짜 | probe | 환경 | 핵심 수치 | 결론 | 다음 |
|---|---|---|---|---|---|
| 2026-07-11 | probe.html | Edge headless | 30MB 힙: 단일 9.3ms, 이중 14.3ms(1.54x). 1바이트 변경을 두 해시 모두 감지 | 가설 입증(대역폭 지배, 2배 미만) | src 승격 |
| 2026-07-11 | tests/browser/gate.html | Edge headless | 승격 후 restoreLive 1.06ms, restore/restoreLive 정확성 GREEN(13/13) | 승격 완료. soundness ~2^-64 | 종결 |

## 판정

졸업 -> `src/runtime/memoryCapability.js`(pageHashes interleaved 2워드) + `src/capabilities/reactive.js`(두 워드 비교). 브라우저 게이트가 상시 검증.
