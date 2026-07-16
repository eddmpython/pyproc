# 02. 단계와 배선

## Phase 0 - 제품 경계

상태: 완료.

- `apps/webComputer/`를 pyproc과 Web Machine package 밖 composition root로 고정한다.
- 완료 조건, 제품 경계, binary 0 정책을 문서화한다.

## Phase 1 - 실제 제품 셸

상태: 완료.

- 두 guest 상태와 control을 한 workspace에 표시한다.
- Python editor, Linux terminal, VGA text display와 PS/2 input을 연결한다.
- loading, owner waiting, running, paused, error 상태를 숨기지 않는다.

## Phase 2 - 영속과 이동

상태: 완료.

- IndexedDB CAS generation Save와 startup recovery를 연결한다.
- device-local signing identity와 `.webmachine` export를 연결한다.
- untrusted header inspection, 명시적 trust, fresh-profile import를 연결한다.

## Phase 3 - 자산과 제품 게이트

상태: 완료.

- hash 고정 asset preparation과 development image 표시를 연결한다.
- 제품 UI의 boot, run, save, process restart restore, export, fresh-profile import를 하나의 E2E로 검증한다.
- `npm test`, package consumer, 제품 E2E를 통과한다.

## Phase 4 - 완료

상태: 완료.

- 제품 README와 공개 진입 링크를 갱신한다.
- 실측과 잔여 배포 경계를 원장에 고정한다.
- 완료 폴더를 `_done`으로 이관한다.
