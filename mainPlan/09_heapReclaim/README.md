# heapReclaim

포맷을 안 바꾸고 되찾을 수 있는 메모리를 되찾는다. h0 지문에 닿는 것은 전부 10으로 보내고, 여기서는
사본과 해제 경로만 다룬다.

## Outcome brief

- 주 축: 메모리
- 관측된 손실 지점: replay 부팅한 워커는 자기 힙을 통째로 한 벌 더 들고 있다. 스냅샷 SAB는 `terminate()`
  후에도 남는다. fork 델타는 transfer로 받은 직후 SAB로 다시 복사된다. 죽은 프로세스 엔트리가 상한 없이
  쌓인다.
- 기대 변화: 프로세스 풀의 메모리 배수가 내려가고, 회수 동사가 실제로 회수한다.
- 롤백 반경: 항목마다 독립이고, 가장 큰 항목(워커 cp0)은 정확성 판정 근거를 바꾸므로 실측 없이는 하지 않는다.

## 근거

- `src/processOs/worker.js:67` `if (replay) cp0 = mem().sliceAll();` - replay 워커마다 힙 전체 사본 1벌.
  워커 N개면 2NH다. 소비처는 둘뿐이다: 수확(`:116 byteDiffPages`)과 드리프트 정화(`:141-142 samePage`).
- **수확은 바이트가 필요 없다.** `byteDiffPages`는 바뀐 페이지 번호만 낸다. 같은 답을 페이지 해시 배열
  비교로 낼 수 있고 그 비용은 페이지당 8바이트다.
- `src/runtime/heapDelta.js:36-42` `samePage`는 성긴 8바이트 stride 기각 뒤 **전 바이트 확정 비교**를 한다.
  미변경 페이지가 최악이고(페이지당 약 73,728회 인덱싱), 미변경 페이지가 힙의 대부분이다.
- `src/processOs/pyProc.js:317-322` `terminate()`는 워커만 죽이고 `this._snapshot`(SAB)을 놓지 않는다.
  `src/machine/composition/pyprocMachine.js:206`의 `dispose()`가 `pool.terminate()`만 부르므로 dispose 후에도
  스냅샷이 산다. 동형 결함이 `src/processOs/machineContainer.js:145-147`에도 있다.
- `src/processOs/pyProc.js:54-62` `_makeSnapshot`은 **메인 스레드에 여분의 Pyodide를 통째로 부팅**하고
  스냅샷을 `snap -> SAB`로 복사한다. 워커측은 `worker.js:50-53`에서 SAB -> 로컬로 한 번 더 복사한다
  (Pyodide 내부 TextDecoder가 shared buffer를 거부해서라고 주석이 밝힌다).
- `src/processOs/pyProc.js:136-142`: 워커가 `bin.buffer`를 transfer로 넘겨 복사 0을 달성한 직후, 커널이
  그것을 SAB로 memcpy한다(`postMessage`는 SAB를 transfer하지 않는다).
- `src/processOs/pyProc.js:229-255`: `kill`과 `_replace`가 dead 엔트리를 테이블에 남긴다. 상한이 없다.
  각 엔트리가 terminate된 Worker, SAB 뷰, `createRpcPort` 클로저(리스너 3건)를 붙잡는다. 대조군:
  `src/session/kernelElection.js:346-347`은 같은 문제를 `SERVED_CACHE_MAX` FIFO evict로 이미 해결했다.
- `src/capabilities/reactive.js:134` `collectDelta`가 `slicePage`(복사) 결과를 `packPages`가 다시 복사한다.
  대조군이 바로 옆에 있다: `worker.js:117`은 `subarray`를 넘겨 복사 1회다.
- `src/machine/host/machineHandle.js:25,58,65,126-132,212`의 `_history`가 상한 없이 자란다. `history` getter는
  매번 전체를 얕은 복사하고 `inspectNow()`가 그것을 포함한다.

## 입장 조건

- 03의 메모리 예산이 서 있다. "줄었다"를 주장이 아니라 측정으로 말하려면 예산이 먼저다.
- **워커 cp0 강등은 실측이 선결이다.** 수확 판정을 바이트 동일성에서 64비트 해시로 바꾸는 것은 정확성
  근거의 강도를 낮추는 일이다. reactive 경로는 이미 그 트레이드를 수용했지만 fork 경로는 아직 아니다.
  `tests/attempts/runtimeParity` 안에서 probe로 먼저 재고, 두 경로의 판정 강도를 통일할지 결정한 뒤 착수한다.

## 범위

포함

- 스냅샷 SAB와 부모 인터프리터 회수
- fork 델타의 커널측 재복사 제거
- dead 엔트리 상한과 `createRpcPort` 해제
- `collectDelta`의 이중 복사 제거
- `samePage` 확정 비교의 워드화(정확성 무변경)
- `MachineHandle._history` 상한
- (실측 통과 시) 워커 cp0의 해시 강등

제외

- `reactive`의 base 상주 해소와 보존 정책 rebase는 10이다(h0 앵커에 닿는다).
- 노드당 해시의 희소화도 10이다(h0 입력 표현이 바뀐다).
- WASM 힙 축소 불가는 고칠 수 없는 사실이라 `docs/operations/contractReality.md`에 계약 실태로 적는다.

## 구현 계약

1. `PyProc.terminate()`에 `this._snapshot = null`을 더한다. `MachineContainer`도 같이. `_replace`가
   `!!this._snapshot`을 읽으므로 terminate 후 respawn은 콜드가 되는데, terminate된 풀에서 respawn하지 않는
   계약상 무해하다.
2. `_makeSnapshot`을 전용 워커에서 돌린다. 스냅샷 바이트를 transfer로 커널에 넘긴 뒤 SAB에 한 번만 싣는다.
   메인스레드 long task와 전역 오염이 함께 사라진다. **선결**: 메인에서 만든 스냅샷과 워커에서 만든
   스냅샷이 바이트 동일한지 attempts probe로 확인한다(`worker.js:10-12`가 메인과 워커의 리플레이는 바이트가
   다르다는 실측을 기록하고 있다).
3. 커널이 harvest 요청에 SAB를 실어 보내고 워커의 `packPages`가 그 뷰에 직접 쓰게 한다. 크기를 모르면
   2단계로 나눈다(1차는 페이지 목록만, 2차는 정확한 SAB로 pack). 커널측 memcpy가 사라지고 SAB 재사용
   풀도 자연스럽게 생긴다.
4. `PyProc`에 `DEAD_ENTRY_MAX`를 두고 초과 시 가장 오래된 dead 엔트리의 `worker`, `port`, `interrupt`
   참조를 끊는다. `pid`, `state`, `parentPid`만 남기면 `ps()` 계약이 유지된다. `createRpcPort`에
   `dispose()`를 더해 리스너 3건 제거와 `pending.clear()`를 명시한다.
5. `MemoryCapability`에 `viewPage(p)`(subarray, 복사 없음)를 더하고 `collectDelta`가 그것을 쓴다. `slicePage`는
   보관용으로 남긴다. 뷰는 성장 시 detach되므로 내부 전용으로 두거나 이름에 위험을 담는다.
6. `samePage`의 확정 비교를 `Uint32Array` 뷰로 바꾼다. 페이지가 4의 배수이고 `cp0`은 byteOffset 0이라
   정렬이 성립한다. 결과는 바이트 비교와 동일하다.
7. `MachineHandle`에 `HISTORY_MAX`를 두고 `_note(entry)` 한 함수로 push 지점을 모은다. 초과 시 오래된 것을
   자르고 `truncated` 카운터를 남긴다. `created` 엔트리는 보존한다. `inspectNow()`는 최근 N개와 `truncated`를
   낸다.
8. (실측 통과 시) src 역할 워커는 해시만 들고 dst 역할만 바이트 cp0을 유지한다. `forkMany`가 src 1 : dst N
   구조이므로 이것만으로 풀 전체가 2NH에서 (N+1)H 근처로 내려간다.

## 성능과 메모리 계약

- replay 풀의 총 메모리가 워커 수 N에 대해 갖는 기울기가 내려가야 한다. 지표는 "WASM 힙 대 총 프로세스
  바이트"의 비(현재 기대 2.0, 8 적용 시 1.0 근처).
- `terminate()` 후 스냅샷 크기만큼 실제로 반환되는지 03의 회수 단정이 판정한다.
- `harvestMs`가 델타 크기를 고정한 채 힙 크기에 비례하는 정도가 6 적용 후 줄어야 한다.

## 영향 파일

기존: `src/processOs/pyProc.js`, `src/processOs/worker.js`, `src/processOs/machineContainer.js`,
`src/processOs/ipc.js`(rpc port 해제), `src/runtime/heapDelta.js`, `src/runtime/memoryCapability.js`,
`src/capabilities/reactive.js`, `src/machine/host/machineHandle.js`, `tests/browser/gate.js`,
`tests/browser/perfBudget.json`

신규: 스냅샷 생성 전용 워커(2를 채택할 경우)

## 검증

- `npm run test:browser`(fork, map, 풀 소진, mid-flight 사망 경로 전부), `npm test`, `npm run test:types`

음성 시험

- 회수: `terminate()` 후 스냅샷 SAB가 놓였는지 단정하고, `_snapshot = null`을 지우면 RED가 되게 한다.
- dead 엔트리: 짧은 타임아웃으로 태스크를 반복해 `ps()`의 dead 수가 상한 이하인지 단정한다. 상한 로직을
  지우면 RED.
- `samePage` 워드화: 워드화 전후로 같은 페이지 집합을 내는지 대조하는 property 시험을 넣는다. 정렬 가정을
  깬 입력(byteOffset이 0이 아닌 뷰)에서 명시적으로 실패하는지도 본다.
- cp0 강등(8): 해시 강등판과 바이트 판정판이 같은 페이지 집합을 내는지 fuzz로 대조한다. 한 페이지만 다른
  힙 쌍을 만들어 둘 다 그것을 잡는지 확인하고, 강등판이 놓치는 입력이 있으면 8을 채택하지 않는다.

## 롤백

여덟 항목 전부 독립이다. 8이 가장 위험하고 나머지는 정확성 무변경이므로, 8만 별도 커밋으로 마지막에 낸다.

## 커밋 분할

1. 스냅샷 SAB 회수 + dead 엔트리 상한 + `createRpcPort.dispose()`
2. `collectDelta` 이중 복사 제거 + `samePage` 워드화 + property 시험
3. `MachineHandle._history` 상한
4. fork 델타 SAB 직접 수확
5. 스냅샷 생성의 워커 이관(선결 probe 통과 시)
6. 워커 cp0 해시 강등(선결 fuzz 통과 시)
