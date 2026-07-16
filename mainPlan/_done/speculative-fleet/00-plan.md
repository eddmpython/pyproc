# 00. 계약과 배선

## 계약

```text
forkMany(srcPid, dstPids) -> { pages, mb, harvestMs, lanes: [{ pid, reverted, applyMs }] }
fork(srcPid, dstPid)      -> forkMany(srcPid, [dstPid])의 1:1 위임(반환 형태 불변)
```

- 전제는 fork와 같다: 같은 replay 매니페스트로 부팅한 대칭 풀(워커끼리만 바이트 동일).
  위반은 `PYPROC_FORK_UNAVAILABLE`.
- 입력 위반(빈 배열, 중복 pid, src가 dst에 포함)은 `PYPROC_INPUT_INVALID`.
  준비되지 않은 pid는 `PYPROC_PROCESS_UNAVAILABLE`.
- `harvestMs`는 레인 수와 무관한 1회 비용이다(이 계약의 존재 이유). 레인별 비용은
  `lanes[].applyMs`, 정화 증거는 `lanes[].reverted`.
- 델타 바이트는 SharedArrayBuffer로 방송한다(레인당 복사 0). SAB이므로 `crossOriginIsolated`가
  전제인데, PyProc.boot가 이미 그것을 요구하므로 새 전제는 없다.

왜 Fleet 클래스를 만들지 않는가: 함대 루프(prepare -> explore -> adopt)는 이 프리미티브 위
3줄이다(`forkMany` + `Promise.all(repl)` + `fork(winner, main)`). 소비자가 하나뿐인 시점에
루프를 클래스로 굳히는 것은 거짓 공통화이고, 강함은 깎아서 나온다.

## 영향 파일

- `src/processOs/pyProc.js` - forkMany 신설, fork 위임.
- `index.d.ts` - forkMany 선언.
- `tests/run.mjs` - PyProc 메서드 목록.
- `tests/browser/gate.html` - 방송 팬아웃 정확성/격리 시나리오.
- `docs/reference/api.md`, `docs/consuming/capabilityMatrix.md`, `CHANGELOG.md`.

## 게이트

- 구조: PyProc 메서드 목록에 forkMany, d.ts 선언 존재.
- 브라우저: 본선 준비 -> forkMany로 2 레인 팬아웃 -> 레인별 상태 격리 확인 ->
  본선 불변 확인 -> 승계(fork) 뒤 본선이 승자와 일치. harvestMs 1회 반환 확인.
- 기존 fork/forkLive 게이트 전부 GREEN(반환 계약 불변의 증거).

## 롤백

- forkMany는 additive이고 fork는 위임이라 커밋 revert로 즉시 복귀한다.
