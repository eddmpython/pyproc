# 01. 진행 원장 - kernel-product

위가 과거, 아래가 최신. 재개 지점(NEXT)은 항상 마지막 줄.

## 2026-07-18 - 개설

- state-kernel 잔여 4건(bundle header-target, machine generation 커널 스키마, .webmachine
  bundle 통합, VirtualOrigin 재노출)의 해소와 통합 제품(Web Computer v2)을 한 이니셔티브로
  개설. 단계·게이트·기각 기준은 [00-plan.md](00-plan.md).

## 2026-07-18 - P1 완료: bundle header-target 서명

- probe 5(headerTagProbe) GREEN 5/5: 미신뢰 거부 접두 슬라이스 2회(payload 접촉 0), 오브젝트
  치환 = verify-on-read 거부, 색인 조작 = 서명 대상 불일치, tag 변조 = 검증 실패. 가설 채택.
- 본진 전환: tag.target = canonical 헤더(tag=null) 다이제스트(`stateBundleHeaderDigest` -
  색인만으로 계산 가능해 서명에 오브젝트 바이트가 불필요), 접두 판독기
  `readStateBundleHeader`(Uint8Array/Blob/{read} 소스, 신뢰 preflight 프리미티브) 신설.
  세션 서명·검증, 배럴·d.ts, run.mjs bundle 시험, 레이아웃 문서 동시 개정.
- 게이트: npm test 1321, test:browser 84/84(서명 신뢰 부활·변조 거부·독립 재파싱·구 봉투 호환) 전부 green.

NEXT: P2 - machine generation = 커널 commit 스키마 통일. payloadTree 엔트리 meta 확장 ->
coordinator가 커널 오브젝트(blob/tree/commit)로 저장하고 store 단일 트랜잭션 CAS는 backend
원자성으로 유지. retention은 commit->tree 걷기로.
