# legacySunset

죽은 포맷 리더 두 벌을 실제로 지운다. 은퇴 결정은 이미 내려졌고 writer도 지웠는데 코드에는 절반만 반영됐다.
적대 입력 파서가 아무도 안 부르는 채로 유지 비용과 취약면만 남긴다.

## Outcome brief

- 주 축: 클린코드
- 관측된 손실 지점: `src/session`에 미사용 import와 호출부 0인 메서드가 남아 있고, `MachineJournal`은 상시
  경로가 일몰 경로를 매번 밟는다. 05의 증분화 대상 파일이 그만큼 넓어진다.
- 기대 변화: 포맷을 지울 때 파일 하나 삭제가 되고, 05의 diff가 절반이 된다.
- 롤백 반경: 삭제만 하므로 되돌리기는 revert 하나다.

## 근거

**PYMACHINE2 봉투 리더**

- `src/session/session.js:139` 주석이 은퇴를 선언한다. `:145-154` `openMachine`은 `isStateBundle`이 아니면 무조건
  throw한다. 즉 구 포맷은 이미 못 읽는다.
- 미사용 import 3개: `session.js:27 decodeMachineEnvelope`, `:31 verifyMachineSignature`, `:46 validateMachineHomeMeta`.
- 죽은 메서드: `session.js:261 _applyHome(home, bin)` - 저장소 전체 호출부 0.
- `src/session/machineSignature.js:56-86`의 "구 signature v1 reader" 블록 전체가 프로덕션 미참조.
- `src/session/machineImage.js`의 `MACHINE_MAGIC`, `MACHINE_MAGIC_V1`, `toBytesWithHead`는 `tests/`에서만 참조된다
  (`tests/browser/gate.js:969,982`, `tests/support/envelopeBoundary.mjs`).
- `src/capabilities/journal/machineJournal.js:32 applyMachineHome`도 미사용 import다(`_applyHome` 연쇄).
- `src/state/bundleFormat.js:4-6`이 현재 상태를 스스로 선언한다: "이 포맷이 단일 writer 계약이다".

**저널의 구 세대 리더(다른 legacy다)**

- `src/capabilities/journal/machineJournal.js`의 `_readGeneration:387`, `_applyGeneration:400`,
  `_readLiveHeads:326`, `_legacyLiveKeys:336`, `_cleanupLegacyRefs:282`.
- 도달 조건은 `recover():495-519`에서 "커널 refs가 전무할 때"뿐인데, `_liveKeys:347`이 pack/prune마다 무조건
  `_readLiveHeads()`를 부른다. **일몰 경로가 상시 경로에 얹혀 있다.**
- `_liveKeys()`가 05(커밋 증분화)와 이 캠페인의 교차점이다. 여기를 먼저 갈라야 05가 `_kernelLiveKeys` 한
  갈래만 증분화한다.
- 중복 판정: `_readMarker:175-191`과 `_readGeneration:387-396`이 "파일 읽기 -> NotFound면 missing -> 그 외면
  corrupt -> JSON.parse -> 실패면 corrupt"를 각자 구현한다.

## 입장 조건

- 02가 끝나 있다(게이트 파일을 건드리므로 판정자를 먼저 믿을 수 있어야 한다).
- 저널 legacy 삭제 전에 **live 판정 게이트가 먼저 있어야 한다.** `_liveKeys`가 legacy 세대를 놓치면 아직
  이관 안 된 저널에서 살아 있는 blob을 prune이 지운다(데이터 유실). 이 게이트가 없으면 착수하지 않는다.

## 범위

포함

- `src/session`의 PYMACHINE2 잔재 제거(미사용 import 3, `_applyHome`, signature v1 reader, 봉투 상수와 인코더)
- 그 상수에 의존하던 테스트 fixture 정리
- 저널 legacy 리더를 별도 파일로 **분리**(삭제가 아니라 분리. 삭제 시점은 아래 제외 참조)
- `readJsonFile` 통합

제외

- 저널 legacy 리더의 **삭제**는 하지 않는다. 아직 이관 안 된 사용자 저널이 있을 수 있고, 그 판정 근거가
  없다. 분리해서 "지울 때 파일 하나 삭제"인 상태까지만 만든다. 삭제 기한은 `docs/operations/contractReality.md`에
  적는다.
- `pack`/`prune`/`delete`를 별도 파일로 빼는 것은 08이다.

## 구현 계약

1. `src/session/session.js`에서 미사용 import 3개와 `_applyHome`을 제거한다. `Session.load`가 쓰는
   `validateMeta`는 남긴다.
2. `src/capabilities/journal/machineJournal.js:32`의 `applyMachineHome` import를 제거한다(1의 연쇄).
3. `src/session/machineSignature.js`에서 구 reader 절(56-86)을 삭제하고 `createMachineKeyPair`,
   `exportMachinePublicKey`, `fingerprintMachinePublicKey`, `machineSigningMaterial` 넷만 남긴다.
4. `src/session/machineImage.js`에서 `decodeMachineEnvelope`, `unsignedEnvelope`, `toBytesWithHead`,
   `MACHINE_MAGIC*`을 삭제하고 살아 있는 `validateMeta`와 `validateManifest`만 남긴다.
5. `tests/support/envelopeBoundary.mjs`와 `tests/browser/gate.js:969,982`의 v2 봉투 fixture를 삭제한다.
   포맷이 없어졌으므로 그 검사는 더 이상 계약을 지키지 않는다. `tests/gateFloor.json`의 해당 하한을 같은
   커밋에서 내리고, 내린 이유를 커밋 메시지에 적는다.
6. `src/capabilities/journal/journalJsonFile.js`를 신설하고 `readJsonFile(dir, name)`이
   `{ value } | { missing: true } | { corrupt: reason }`을 내게 한다. `_readMarker`와 `_readGeneration`은
   형식 검사만 각자 남긴다.
7. `src/capabilities/journal/journalLegacyGeneration.js`를 신설하고 `_readGeneration`, `_applyGeneration`,
   `_readLiveHeads`, `_legacyLiveKeys`, `_cleanupLegacyRefs`를 옮긴다. `machineJournal`은 `recover()`의 폴백
   지점과 `_liveKeys`에서만 그것을 부른다.
8. `_liveKeys`의 합집합 의미(커널 live + legacy live)를 그대로 유지한다. 이 함수는 prune의 안전선이다.

## 영향 파일

기존: `src/session/session.js`, `src/session/machineImage.js`, `src/session/machineSignature.js`,
`src/capabilities/journal/machineJournal.js`, `tests/browser/gate.js`, `tests/support/envelopeBoundary.mjs`,
`tests/gateFloor.json`

신규: `src/capabilities/journal/journalJsonFile.js`, `src/capabilities/journal/journalLegacyGeneration.js`

## 검증

- `npm test`, `npm run test:browser`, `npm run test:types`
- 새 live 판정 게이트 green

음성 시험

- **live 판정 게이트를 먼저 낸다.** fake 저널에 legacy 세대 하나와 커널 세대 하나를 두고, `_liveKeys`가
  둘의 합집합을 내는지 단정한다. legacy 갈래를 반환에서 빼면 prune이 그 blob을 지우는 것까지 재현해 RED를
  확인한다. 이 음성 시험이 이 캠페인 전체의 안전망이다.
- 삭제한 심볼을 다시 import하는 사본이 파스 게이트나 죽은 export 검사에서 RED가 되는지 확인한다.

## 롤백

삭제 커밋이므로 revert 하나로 원상복구된다. 분리 커밋(7)은 동작 변경이 0이어야 하고, 변경이 생기면 그것이
곧 회귀 신호다.

## 커밋 분할

1. 저널 live 판정 게이트 신설(음성 시험 포함) - **삭제보다 먼저**
2. `readJsonFile` 통합
3. 저널 legacy를 별도 파일로 분리
4. PYMACHINE2 잔재 제거 + fixture 정리 + 하한 조정
